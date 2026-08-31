# Isomer Desktop

An Electron client for [ism](../../README.md). It speaks to ism **only** by
spawning the CLI and parsing its JSON (design D23) — there is no second
semantic channel, no napi/FFI, and the app never links ism-core.

## Develop

```sh
npm install                     # lockfile resolves against registry.npmjs.org
npm run dev                     # electron-vite dev server
npm run typecheck && npm test   # tsc + vitest (node + happy-dom projects)
npm run build                   # bundle main/preload/renderer into out/
npm run package                 # electron-builder → release/ (dmg + zip)
```

Headless proofs and visual checks:

```sh
ISOMER_SMOKE=1 npx electron .                     # boot proof, prints ISOMER_SMOKE_OK
ISOMER_SHOT=shot.png npx electron .               # self-screenshot + layout probe, exits
ISOMER_SHOT_VIEW=organize ISOMER_SHOT=s.png …     # force a landing view
ISOMER_SHOT_JS=drive.js ISOMER_SHOT=s.png …       # run an interaction script pre-capture
ISOMER_SHOT_DELAY=9000 …                          # move the capture point (watchdog scales)
```

Drive scripts run inside an async wrapper: sequence steps with
`await new Promise(r => setTimeout(r, ms))` — bare `setTimeout` callbacks
that outlive the script's promise are unreliable. The shot window never
has OS focus, so `.focus()`/`.blur()` won't fire React `onBlur`; dispatch
`focusout` or use a keyboard path (inputs that matter also commit on Enter).

## Architecture

Three processes, strict contracts:

- **`src/shared/ipc.ts`** — the single typed IPC table. Adding a channel means
  adding the contract *and* the entry in `INVOKE_CHANNELS`/`PUSH_CHANNELS`
  (a compile-time assertion fails typecheck otherwise); the preload runtime
  allowlist follows automatically. `src/shared/ism-types.ts` mirrors
  ism-core's serde types.
- **`src/main/services/`** — `git.ts` (porcelain wrapper, always
  `--no-optional-locks`), `ism.ts` (spawns the CLI, auto-detects the binary),
  `pty.ts` (node-pty with a spawn-helper chmod self-heal), `watcher.ts`
  (debounced `.git` watcher), `updates.ts` (GitHub releases check — guided
  download, no updater daemon), `stackplan.ts`/`stack.ts` (stacked-PR
  planner + executor through the user's own `gh`; the app holds no tokens),
  `projects.ts` (repo registry with pin/group metadata).
- **Renderer** — React + zustand. Views: Local Changes (hunk-level staging,
  conflict flow), All Commits (topology graph, search), Change Stack
  (review with inline, line-anchored comments; a List | Graph toggle draws
  the change-level dependency DAG bottom-up with upstream/downstream
  lineage highlighting), Organize (the stack editor:
  drafts → R1–R8 check → apply → tree-equality proof), plus a full-page
  Settings and a Cmd+P quick launcher. All colors come from
  `src/renderer/theme/tokens.css`; a test rejects raw hex anywhere else.
  i18n (en / zh-CN) has a key-parity test.

Gotchas that cost real time once (do not relearn them):

- `git rev-parse --git-path=X` (equals form) is echoed back verbatim with
  exit 0 — always pass `--git-path X` as two arguments.
- The terminal pty session lives outside the React tree; dock switches
  remount the drawer across parents and must not kill the shell.
- node-pty ships NAPI prebuilds; never let electron-builder rebuild it
  (`npmRebuild: false`) — the vendored node-gyp breaks on Python ≥ 3.12.
- A GitHub PR's head branch is immutable: stacked-PR sync must keep pushing
  to the PR's existing head, whatever the change is named today.
- `gh pr edit` fails hard on the Projects-classic deprecation notice; PR
  edits go through `gh api -X PATCH .../pulls/N` instead.
- CRLF checkouts end conflict-marker lines with `\r` — the parser's marker
  regexes carry `\r?$`, and content lines keep their `\r` so reassembly
  reproduces the original bytes.
