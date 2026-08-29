# apps/ (reserved)

Future home of the Isomer desktop app (Tauri).

Architecture contract (design/07): the app consumes `ism-core` directly —
same typed results, same JSON shapes as the CLI. No logic lives here that
the CLI cannot also reach; both are shells over the core.
