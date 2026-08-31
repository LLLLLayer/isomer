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

## Desktop app

`apps/desktop` is a full Electron client built on the same contract — it
talks to ism exclusively by spawning the CLI and parsing its JSON:

- A Fork-class git client: staging down to the hunk, stash management,
  merge/rebase with a dedicated three-pane conflict editor (ours | result |
  theirs, per-block or hand-edited), cherry-pick/revert, tags, branch
  compare, file history and blame, repo-wide search, reflog, a real commit
  graph, a repository manager (pin, group, clone, per-repo health badges),
  and a Cmd+P quick launcher.
- The **stack editor**: draft changes seeded from your pending commits, hunks
  dragged between them, validated by the CLI's full R1–R8 check ("check
  passed ⇒ apply succeeds"), applied with the tree-equality proof shown
  in the UI — provably safe interactive rebase.
- The stack shows its **evidence**: change-level dependency edges derived
  from line identities (an `independent` chip is a proof the change can
  land alone), a graph view that draws the dependency DAG bottom-up with
  upstream/downstream lineage highlighting, a proof strip with copyable
  bare-git verification commands, and per-change review state.
- **Stacked PRs**: one click maps the stack onto a GitHub PR chain through
  your own `gh` (one branch per change, each PR based on the one below);
  re-running syncs the same PRs by change identity even after a reorganize
  rewrites every sha.
- Review built in: select code to comment in place; comments anchor to
  change identities (not shas) and feed agent fix loops via
  `ism comment list --unresolved`.

Download the latest build from
[Releases](https://github.com/LLLLLayer/isomer/releases) (macOS arm64 dmg/zip
plus the CLI tarball); the app checks for new releases and offers the
download itself.

## Status

The core engine and CLI are implemented with end-to-end tests: the
reorganization loop, review comments anchored to change identities
(`ism comment add/list/resolve`), the op-log reader (`ism ops`), and the
embedded agent skill (`ism skill install`). The desktop app above ships from
this repo's release pipeline, including stacked-PR submit/sync (the app-side
take on `submit`). Out of scope by choice: LFS, bisect, worktree management,
multi-window.

## License

MIT
