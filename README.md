# Isomer

> Same code, new structure.

**Isomer (`ism`) reorganizes a messy pile of git changes into a clean,
dependency-aware stack of reviewable changes — with a mathematical proof that
not a single byte of your code was modified.**

AI agents write code; humans review structure. `ism` is the deterministic tool
between them: your agent reads the raw material, writes a declarative plan
(which hunks form which change, in what order, and why), and `ism` validates
and executes it atomically. The final tree hash is bit-for-bit identical
before and after — the worst case of any reorganization is a badly told story,
never broken code.

## The loop

```
ism inspect                 # facts: hunks, hard dependencies, anomalies (JSON)
<your agent writes plan.json>
ism check plan.json         # R1–R8 validation; passing check guarantees apply succeeds
ism apply plan.json         # atomic rebuild; embeds identity trailers; auto-verifies
ism verify                  # the proof: old tree hash == new tree hash
ism undo                    # append-only op log; one step back, any time
```

Verify independently, with bare git — don't take our word for it:

```
git rev-parse <old-head>^{tree}
git rev-parse <new-head>^{tree}     # equal ⇒ code untouched
```

## Principles

- **Agent-native.** JSON in, JSON out, structured errors with stable codes,
  never interactive. The plan format is the contract: [schema/plan.v1.json](schema/plan.v1.json).
- **Guest, not landlord.** No hooks, no locks, no daemon. Bare git remains a
  first-class citizen; `ism` re-reads reality on every invocation and detects
  (never blocks) external changes.
- **Plumbing only.** Commits are forged in the object database and made
  visible by a single compare-and-swap ref update. The working tree and index
  are never touched — a dirty worktree is completely unaffected by apply/undo.
- **Deterministic.** No LLM calls inside; all semantic judgment belongs to
  your agent. Every ism command is testable and reproducible.

## Honest boundaries

- The proof covers the **final** tree; intermediate commits are guaranteed
  replayable, not guaranteed buildable.
- Squash-merge teams get review-time benefits only; the narrative lands with
  rebase/merge workflows (stacked-PR publishing is on the roadmap).
- Narrative quality depends on your agent; `ism` guarantees invalid plans
  cannot execute, not that valid plans are wise.

## Status

The core engine and CLI are implemented with end-to-end tests: the
reorganization loop, review comments anchored to change identities
(`ism comment add/list/resolve`), and the embedded agent skill
(`ism skill install`). An Electron desktop app scaffold lives in
`apps/desktop`. Publishing (`submit`) and trunk sync (`sync`) are on the
roadmap.

## License

MIT
