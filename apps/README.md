# apps/

## desktop — the Isomer desktop app (Electron + React + TypeScript)

A visualization and review shell over `ism` and `git` (design D23–D25):

- All ism semantics arrive through the **ism CLI's JSON contract** (spawned
  subprocess) — the app is the first graphical consumer of the same agent
  contract, so it can never drift from the CLI.
- Plain git operations spawn the system `git` (plumbing, machine formats).
- The integrated terminal (xterm.js + node-pty) is where users summon their
  own coding agent; the app itself makes no LLM calls.

```sh
cd apps/desktop
npm install
npm run typecheck && npm test   # unit tests (vitest, node + happy-dom)
npm run dev                     # develop
npm run build                   # bundle main/preload/renderer
ISOMER_SMOKE=1 npx electron .   # headless boot proof (prints ISOMER_SMOKE_OK)
```

Layout follows the four-way split (`src/main` privileged services,
`src/preload` the typed contextBridge, `src/renderer` sandboxed React UI,
`src/shared` the IPC + ism type contracts shared by both worlds).
