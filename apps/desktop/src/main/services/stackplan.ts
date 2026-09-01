/** Stacked-PR planning, pure and testable. ism's change stack maps onto a
 * FOREST of PRs: hard deps (line identities) decide the bases. Weakly
 * connected components submit in parallel; inside a component a change
 * bases on its single dependency (a tree of PRs), and a component holding
 * a diamond — a change with two or more deps, which branch topology
 * cannot express — degrades to a chain in landing order, which respects
 * every dep. Changes nothing about identity: PRs are matched across syncs
 * by the change id embedded in an HTML comment marker — names, summaries,
 * and even commit shas may all change on re-apply; the identity survives.
 *
 * KNOWN LIMITATION: only HARD deps (line identities) shape the forest.
 * A semantic build dependency with no line overlap (change B calls a
 * function change A introduced in another file) is invisible here — such
 * changes plan as parallel components whose sibling CI can fail, where
 * the old always-cumulative chain was constructively buildable. Soft
 * deps joining this computation is the designated follow-up. */

export interface StackChange {
  /** Isomer change id (i-xxxxxxxx) — the durable identity. */
  id: string
  name: string
  summary: string
  description?: string
  sha: string
  /** In-stack change ids this change hard-depends on (line identities). */
  needs?: string[]
}

/** The subset of a GitHub PR the planner needs (from `gh pr list`). */
export interface PrRecord {
  number: number
  headRefName: string
  baseRefName: string
  body: string
}

export interface BranchPush {
  change: StackChange
  branch: string
  /** Base branch of this PR: its dependency's branch, or the trunk. */
  base: string
  /** Change ids that must exist in this branch's history (the base-link
   * chain, landing order, self last) — exactly what `ism slice` forges.
   * Sibling pushes share prefixes; deterministic forging makes the shared
   * mirrors literally the same commits, so the branches truly fork. */
  history: string[]
}

export type PrAction =
  | { kind: 'create'; push: BranchPush; title: string; body: string }
  | {
      kind: 'update'
      push: BranchPush
      number: number
      title: string
      body: string
      /** Set when the PR's recorded base differs and must be retargeted. */
      retarget: string | null
    }

export interface StackPlan {
  pushes: BranchPush[]
  actions: PrAction[]
  /** Open stack PRs whose change no longer exists in the stack. */
  orphans: PrRecord[]
}

const MARKER = /<!-- isomer-stack:(i-[a-z0-9]+) -->/g

export function stackMarker(id: string): string {
  return `<!-- isomer-stack:${id} -->`
}

/** The LAST marker wins: prBody appends the identity after the (possibly
 * quoted, possibly marker-bearing) description, so a stale marker pasted
 * into a commit body can never hijack the PR's identity. */
export function markerIdOf(body: string): string | null {
  const all = [...body.matchAll(MARKER)]
  return all.length > 0 ? all[all.length - 1][1] : null
}

/** Lift ism's hunk-level deps to change-id level for the planner.
 * Intra-change and out-of-stack pairs are dropped. */
export function changeNeeds(
  commits: { change_id: string; hunks: string[] }[],
  deps: [string, string][],
): Map<string, string[]> {
  const owner = new Map<string, string>()
  for (const c of commits) for (const h of c.hunks) owner.set(h, c.change_id)
  const out = new Map<string, Set<string>>(commits.map((c) => [c.change_id, new Set()]))
  for (const [dependent, dependency] of deps) {
    const a = owner.get(dependent)
    const b = owner.get(dependency)
    if (a === undefined || b === undefined || a === b) continue
    out.get(a)?.add(b)
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

export function branchNameFor(change: StackChange, prefix: string): string {
  const slug = change.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${prefix}${slug || change.id}`
}

/** Branch per change, deduplicated: equal titles get -2, -3, … suffixes
 * (deterministic by stack position, so re-runs name the same branches). */
export function branchNames(stack: StackChange[], prefix: string): string[] {
  const used = new Set<string>()
  return stack.map((c) => {
    const base = branchNameFor(c, prefix)
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`
    used.add(name)
    return name
  })
}

/** PR body: the change's own description plus a stack table (bottom → top)
 * with the current PR highlighted, and the identity marker. `names` are the
 * FINAL branch names (existing PR heads preserved) aligned with `stack`.
 * Stray markers inside the description are stripped — they would otherwise
 * shadow the appended identity for older parsers. */
export function prBody(
  change: StackChange,
  stack: StackChange[],
  names: string[],
  bases: string[],
): string {
  const table = stack
    .map((c, i) => {
      const here = c.id === change.id ? ' ← **this PR**' : ''
      return `${i + 1}. \`${names[i]}\` ← \`${bases[i]}\` — ${c.summary}${here}`
    })
    .join('\n')
  const description = change.description?.replace(/<!-- isomer-stack:[^>]*-->/g, '').trim()
  return [
    ...(description ? [description, ''] : []),
    '---',
    '**Stack** (landing order; ← = based on):',
    table,
    '',
    `Isomer-Change: ${change.id}`,
    stackMarker(change.id),
  ].join('\n')
}

/** Compute the full submit/sync plan. `stack` is bottom → top (git order).
 * `openPrs` are the currently open PRs of the repo (any base). */
export function planStack(
  stack: StackChange[],
  openPrs: PrRecord[],
  opts: { trunk: string; prefix: string },
): StackPlan {
  const byId = new Map<string, PrRecord>()
  const orphans: PrRecord[] = []
  for (const pr of openPrs) {
    const id = markerIdOf(pr.body)
    if (id === null) continue
    if (!stack.some((c) => c.id === id)) {
      orphans.push(pr)
      continue
    }
    const dup = byId.get(id)
    if (dup === undefined) {
      byId.set(id, pr)
    } else if (pr.number < dup.number) {
      // Duplicate markers (should not happen, but GitHub allows a second
      // PR from another base): keep the lowest number, surface the rest.
      orphans.push(dup)
      byId.set(id, pr)
    } else {
      orphans.push(pr)
    }
  }

  // A GitHub PR's head branch is immutable: a matched change MUST keep
  // pushing to its existing head, whatever the change is named today.
  // Only unmatched changes get generated names, deduplicated against the
  // reserved heads and each other.
  const used = new Set<string>()
  for (const c of stack) {
    const pr = byId.get(c.id)
    if (pr) used.add(pr.headRefName)
  }
  const names = stack.map((c) => {
    const pr = byId.get(c.id)
    if (pr) return pr.headRefName
    const base = branchNameFor(c, opts.prefix)
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`
    used.add(name)
    return name
  })

  // Forest: hard deps decide the bases. Only backward, in-stack deps are
  // structure; anything else is malformed input and ignored.
  const idx = new Map(stack.map((c, i) => [c.id, i]))
  const needsIn = stack.map((c, i) =>
    [...new Set(c.needs ?? [])].filter((n) => {
      const t = idx.get(n)
      return t !== undefined && t < i
    }),
  )
  const comp = stack.map((_, i) => i)
  const find = (i: number): number => (comp[i] === i ? i : (comp[i] = find(comp[i])))
  stack.forEach((_, i) => {
    for (const n of needsIn[i]) comp[find(i)] = find(idx.get(n) as number)
  })
  const diamonds = new Set<number>()
  stack.forEach((_, i) => {
    if (needsIn[i].length >= 2) diamonds.add(find(i))
  })
  const lastInComp = new Map<number, number>()
  const bases = stack.map((_, i) => {
    const root = find(i)
    let base: string
    if (diamonds.has(root)) {
      const prev = lastInComp.get(root)
      base = prev === undefined ? opts.trunk : names[prev]
    } else {
      base = needsIn[i].length === 1 ? names[idx.get(needsIn[i][0]) as number] : opts.trunk
    }
    lastInComp.set(root, i)
    return base
  })

  // Base links only ever point at earlier entries, so one forward pass
  // resolves every branch's required history.
  const branchIndex = new Map(names.map((n, i) => [n, i]))
  const histories: string[][] = []
  stack.forEach((c, i) => {
    const parent = branchIndex.get(bases[i])
    histories.push(parent === undefined ? [c.id] : [...histories[parent], c.id])
  })

  const pushes: BranchPush[] = stack.map((change, i) => ({
    change,
    branch: names[i],
    base: bases[i],
    history: histories[i],
  }))

  const actions: PrAction[] = pushes.map((push) => {
    const existing = byId.get(push.change.id)
    const body = prBody(push.change, stack, names, bases)
    if (!existing) {
      return { kind: 'create', push, title: push.change.summary, body }
    }
    return {
      kind: 'update',
      push,
      number: existing.number,
      title: push.change.summary,
      body,
      retarget: existing.baseRefName === push.base ? null : push.base,
    }
  })

  return { pushes, actions, orphans }
}
