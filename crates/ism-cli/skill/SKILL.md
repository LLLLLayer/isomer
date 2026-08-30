---
name: ism
description: >-
  Reorganize messy git commits into a clean, dependency-aware stack of
  reviewable changes with a tree-hash proof that no code changed, using the
  `ism` CLI (Isomer). Use this skill whenever the user wants to clean up,
  split, squash, reorder, or "tell a better story" with their commits before
  review or a PR; whenever they mention messy WIP commits, stacked changes,
  commit hygiene, or reorganizing a branch; and whenever they ask to act on
  ism review comments. Also use it proactively after a long coding session
  produces tangled commits worth restructuring.
---

# ism — reorganize git changes with proof

`ism` rebuilds a `base..head` commit range into a new commit chain according
to a declarative plan you write. It never touches the worktree or index, and
it enforces bit-for-bit tree equality: the final tree hash after `apply`
equals the hash before it, so reorganization provably changes zero bytes of
code. The worst possible outcome is a badly told story, never broken code.

You are the planner; `ism` is the executor. It makes no semantic judgments —
you read the raw material, decide which hunks form which logical change, and
`ism` validates and executes the plan atomically.

## The loop

```
ism inspect                 # 1. facts: hunks, hard deps, anomalies (JSON)
<write plan.json>           # 2. you group hunks into narrative changes
ism check plan.json         # 3. R1–R8 validation; pass ⇒ apply will succeed
ism apply plan.json         # 4. atomic rebuild + identity trailers + op log
ism verify                  # 5. the proof: old tree hash == new tree hash
```

Every command emits JSON on stdout. Errors are
`{"ok":false,"errors":[{code,message,hint,...}]}` — parse the `code`, follow
the `hint`. Nothing is ever interactive.

## Step 1 — inspect

Run `ism inspect`. Key fields of the snapshot:

- `snapshot_digest` — copy it into the plan verbatim; it anchors the plan to
  this exact repository state.
- `hunks[]` — atomic units, ids like `src/app.py:42#9f3a`. Each belongs to
  exactly one commit today and must belong to exactly one node in your plan.
- `deps[]` — hard dependency edges `[dependent, dependency]` computed from
  line identity. A dependent hunk can never be ordered before its dependency.
- `anomalies[]` — read them. `merge_in_stack` means stop (reorganization is
  undefined across merges); `untracked` is normal for never-organized commits.

The stack is `merge-base(branch, trunk)..HEAD`. When working ON the trunk
itself (e.g. organizing fresh commits on `main`), pass the previous head
explicitly: `ism inspect --base <sha>`, and set `"base"` in the plan.

To see actual patch text: `ism show hunk <id>...` or `ism inspect --full`.

## Step 2 — write the plan

```json
{
  "version": 1,
  "snapshot_digest": "<from inspect>",
  "base": "<sha, only when you used --base>",
  "nodes": [
    {"name": "extract-service", "summary": "Extract the export service",
     "body": "Optional longer rationale for the commit body.",
     "from": ["src/service.py:1#ab12", "src/app.py:7#cd34"]},
    {"name": "fix-labels", "summary": "Fix util labels",
     "from": "commit:9fa8c21", "deps": ["extract-service"]}
  ],
  "order": ["extract-service", "fix-labels"]
}
```

- `from` is either an explicit hunk-id list or `"commit:<sha>"` (all hunks of
  that commit — use for pure reordering).
- Every hunk appears in exactly one node; `order` lists every node once.
- `deps` are *soft* (semantic) dependencies for narrative ordering; hard
  dependencies from `inspect` are enforced regardless.
- To preserve an existing change identity, set `"change": "i-xxxxxxxx"`.
  Identity is otherwise inherited only when a node owns ALL hunks of one
  source commit; splitting a commit mints fresh ids for both halves.
- Hygiene rules (E001): `summary` is a single line; never write an
  `Isomer-Change:` line inside `summary`/`body` (quote ids inline instead);
  every node must resolve to at least one hunk.

Craft the narrative like a reviewer will read it commit by commit:
independent concerns in separate nodes, mechanical churn separated from
behavior changes, summaries in imperative mood, bodies explaining *why*.

## Steps 3–5 — check, apply, verify

Run `ism check plan.json` until it returns `"ok": true`. Passing check is a
constructive guarantee (it fully replays the plan in memory), so a later
`apply` failure indicates external interference, not a planning mistake.

`ism apply plan.json` rebuilds the chain, stamps each commit with an
`Isomer-Change: i-...` trailer (stable identity that survives rebase and
cherry-pick), and records the operation on `refs/isomer/data`.

`ism verify` prints the proof. Quote it to the user, including the bare-git
reproduction they can run themselves:
`git rev-parse <old-head>^{tree}` vs `git rev-parse <new-head>^{tree}`.

`ism undo` reverts the latest operation (append-only op log; redo = undo of
undo). If the branch was already pushed, warn about `--force-with-lease`.

## Error recovery

| code | meaning | do this |
|---|---|---|
| E002 | unknown hunk/change ref | re-run inspect; use ids from its output |
| E003 | hunk digest mismatch | content moved; re-run inspect, rebuild plan |
| E010 | snapshot stale | history changed; re-run inspect, rebuild plan |
| E020/E021 | hunk unassigned / duplicated | fix the `from` lists |
| E030 | order violates a hard dep | merge the two hunks into one node, or reorder |
| E031 | soft deps cyclic / contradict order | fix `deps` or `order` |
| E050 | commit signing failed | ask the user about their gpg setup |
| E101 | precondition (raced ref, etc.) | re-run inspect and retry once |

Never work around an error by falling back to raw `git rebase` — surface the
error and hint instead.

## Review comments

`ism comment list --unresolved` returns review comments as JSON, each
anchored to a change id (`change`), optionally to `path` + `line`, threaded
via `parent`. To act on review feedback:

1. List unresolved comments; group them by `change`.
2. Make the fixes the comments ask for (new commits, or a new ism plan).
3. `ism comment resolve <c-id>` for each addressed comment.
4. Reply when useful: `ism comment add --change <id> --reply-to <c-id> -m "..."`.

## Safety facts you can rely on

- `apply`/`undo` never touch the worktree or index — a dirty worktree is
  fine and will be byte-identical afterwards.
- All new objects are invisible until one atomic compare-and-swap ref update;
  any failure before that leaves the repository externally unchanged.
- The op log on `refs/isomer/data` is append-only and auditable; it does not
  push by default (`git push origin refs/isomer/data` to share it).
