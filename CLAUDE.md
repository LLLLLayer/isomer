# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Isomer (`ism`) is an agent-native CLI that reorganizes a `base..head` commit range into a clean stack of changes according to a declarative `plan.json`, with a bit-for-bit tree-equality proof that no code changed. It contains **zero LLM calls** — semantic judgment belongs to the user's agent; ism is the deterministic executor. Code and comments are written in English.

## Commands

```sh
cargo test --workspace                        # all tests (unit + E2E; E2E needs git in PATH)
cargo test -p ism-core algebra                # unit tests of one module, by name filter
cargo test -p ism-cli --test e2e full_loop    # a single E2E test
cargo fmt --check                             # CI-gated
cargo clippy --all-targets -- -D warnings     # CI-gated
./scripts/check-sync.sh                       # CI-gated: embed-source/convention-copy byte equality
cargo run -p ism-cli -- inspect               # run the CLI
```

Desktop app (`apps/desktop`, Electron + React + TS — see its README):

```sh
cd apps/desktop && npm install
npm run typecheck && npm test                 # vitest (node + happy-dom projects)
npm run build                                 # bundle main/preload/renderer
ISOMER_SMOKE=1 npx electron .                 # headless boot proof
ISOMER_SHOT=shot.png npx electron .           # boot, self-screenshot, print layout probe, exit
```

`ISOMER_SHOT_VIEW=<view>` forces the landing view (`changes|history|stack|organize|settings`); `ISOMER_SHOT_JS=<file>` runs an interaction script (selections, clicks) before the capture so flows are verifiable, not just layouts; `ISOMER_SHOT_DELAY=<ms>` moves the capture point for driven flows that need network time (the watchdog scales with it). Drive scripts must sequence with `await`-sleeps, not bare `setTimeout` callbacks, and cannot rely on focus/blur (the shot window is never OS-focused). Use ISOMER_SHOT to verify UI changes visually — never screen-capture the whole display. `package-lock.json` must resolve against registry.npmjs.org (CI `npm ci` fails on mirror URLs).

The app talks to ism ONLY by spawning the CLI and parsing its JSON (design
D23) — never add a second semantic channel (no napi/FFI).

CI (`.github/workflows/ci.yml`) runs exactly these five checks on ubuntu + macos. Run all of them before committing. Releasing = push a `v*` tag: `release.yml` builds the CLI tarball and the mac app (version stamped from the tag, ad-hoc signed) and publishes a GitHub release, which is what the app's in-app update check reads.

## Architecture

Two-crate workspace, strict split:

- **`crates/ism-core`** — all domain logic. Its serde types (`model.rs`) *are* the public JSON contract; renaming a serialized field is a breaking API change.
- **`crates/ism-cli`** — thin clap shell: parses args, calls core, prints JSON. Never put logic here. The desktop app deliberately does *not* link ism-core — the CLI's JSON is the only interface (D23).

Data flows through ism-core as a pipeline:

1. **`gitio.rs`** — plumbing-only Git wrapper (`hash-object`, `update-index --index-info` against a temp index, `write-tree`, `commit-tree`, `update-ref` CAS). Never porcelain, and never touches the user's worktree or index — that is a core product guarantee (dirty worktrees are unaffected by apply/undo).
2. **`parse.rs`** — `git diff -U0` output → `FileDiff`/`RawHunk`. Binary, mode-change, no-trailing-newline, and deleted files degrade to atomic whole-file units (conservative correctness).
3. **`algebra.rs`** — the heart. Line-identity model: file lines get stable identities; a hunk's hard deps are derived from which other hunk's created lines it removes or sits adjacent to (no offset arithmetic). `Replay` re-applies hunks in any dependency-legal order by locating identities, not line numbers.
4. **`analyze.rs`** — snapshot of `base..head`: hunk IDs (`path:newStart#digest4`), anomaly detection, trunk detection, and `snapshot_digest` — the staleness anchor plans must match (E010).
5. **`plancheck.rs`** — validation rules R1–R8. R8 is a *full read-only replay* with hash comparison, which is why "check passed ⇒ apply succeeds" holds constructively. Don't weaken R8 to heuristics.
6. **`engine.rs`** — apply/undo. Forges all commits in the object database, asserts final tree == old head tree, then flips the branch with a single CAS ref update. Mints/preserves `Isomer-Change: i-<8×base32>` trailers (change identity that survives bare rebase/cherry-pick).
7. **`oplog.rs`** — `refs/isomer/data` metadata commit chain. **Append-only**: undo appends a new op record (redo = undo of undo); never rewind or rewrite the chain. Ops are branch-scoped.
8. **`comment.rs`** — review comments anchored to change ids (never commit shas), stored under `comments/` on the data ref; `add`/`resolve`/`list` feed both the desktop app and agent fix loops.
9. **`verify.rs`** — deliberately independent code path that re-derives the tree-equality proof; keep it decoupled from engine.rs so it stays a real check.

**`error.rs`** defines stable error codes (E001–E900) and exit codes (1 business / 2 usage / 3 precondition / 9 internal). These codes are public API consumed by agents — never renumber or reuse a code; add new ones.

## Desktop app (`apps/desktop`)

Electron three-process split; all real logic lives in `src/main/services/` and the renderer store:

- **`src/shared/ipc.ts`** is the single IPC contract table. Adding a channel means: add the typed contract, add it to `INVOKE_CHANNELS`/`PUSH_CHANNELS` (a compile-time assertion fails typecheck if you forget), and the preload runtime allowlist picks it up automatically. `src/shared/ism-types.ts` mirrors ism-core's serde types — keep it in sync with `model.rs`.
- **`src/main/services/`** — `git.ts` (porcelain wrapper; every command runs with `--no-optional-locks`), `ism.ts` (spawns the ism CLI, parses JSON), `pty.ts` (node-pty; re-chmods the prebuilt spawn-helper before every spawn — npm drops its exec bit), `watcher.ts` (debounced `.git` watcher → `repo:changed` push), `updates.ts` (GitHub releases check — guided download, no updater daemon), `stackplan.ts` + `stack.ts` (stacked-PR planner/executor via the user's own `gh`; PR identity = the LAST `<!-- isomer-stack:… -->` marker, matched PRs keep their immutable head branch, PR edits use REST because `gh pr edit` dies on the Projects-classic notice), `projects.ts` (repo registry incl. pin/group metadata).
- **Renderer**: zustand store (`store/store.ts`) with stale-project guards after every await; all colors come from `theme/tokens.css` design tokens (a test rejects raw hex elsewhere); i18n locales en / zh-CN have a key-parity test. The terminal pty session is a module-level singleton in `TerminalDrawer.tsx` — dock switches remount the component across parents and must not kill the shell. The Organize view is the stack editor: plans are built in the renderer and serialized to a temp file by main (`ism:check`/`ism:apply` take plan objects). The Change Stack has a List | Tree toggle: `stacktree.ts` derives the outline (indent = builds-on, `#n` = landing order) and `StackTree.tsx` renders it — grep `app.css` before naming a new renderer class; it is one global sheet.
- Tests are vitest with two projects (node for main/shared, happy-dom for renderer); `npm test` runs both.

## Invariants to preserve

- Final tree hash must equal the old head tree hash — engine aborts before the ref flip if not.
- Never touch worktree/index; never install hooks/locks/daemons ("guest, not landlord"). Detect external git activity and reject with a structured error; never block it.
- All CLI output is JSON on stdout; errors are `{"ok":false,"errors":[{code,message,hint,context}]}`. Never interactive, never prompts.
- `plan.json` is declarative end-state (see `schema/plan.v1.json`), not an operation script.

## Repo conventions

- `schema/plan.v1.json` and `skills/ism/SKILL.md` at the root are **convention copies**; the embed sources live inside the crates (`crates/ism-core/schema/`, `crates/ism-cli/skill/`) because `cargo publish` can't include files outside the crate dir. Edit the crate copy, mirror to the root copy, and `./scripts/check-sync.sh` enforces byte equality.
- `design/` and `research/` are gitignored, local-only folders. If `design/` is present, read it before architectural changes: `design/01-decisions.md` is an append-only ADR log (D01–D20) — record reversals as new entries, never edit old ones.
- E2E tests (`crates/ism-cli/tests/e2e.rs`) build throwaway repos with the `Repo` helper. Write plan files to a tempdir *outside* the test repo — a plan file inside it dirties `git status` and breaks assertions.
- This repo dogfoods itself: history is organized into ism changes with `Isomer-Change` trailers, and `refs/isomer/data` is pushed. Prefer `ism` for reorganizing your own messy WIP commits before committing/pushing. When dogfooding ON the trunk, the plan must carry `base`/`head` copied from the snapshot (`ism inspect --base <prev-head>`) — the default analysis sees an empty stack there and an unanchored plan fails E010.
