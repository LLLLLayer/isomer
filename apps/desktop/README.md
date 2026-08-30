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
```

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
  download, no updater daemon).
- **Renderer** — React + zustand. Views: Local Changes (hunk-level staging,
  conflict flow), All Commits (topology graph, search), Change Stack
  (review with inline, line-anchored comments), Organize (the stack editor:
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
