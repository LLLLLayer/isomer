/** Stacked-PR planning, pure and testable. ism's change stack maps onto a
 * PR chain: one branch per change, each PR based on the one below, the
 * bottom on the trunk. PRs are matched across syncs by the change id
 * embedded in an HTML comment marker — names, summaries, and even commit
 * shas may all change on re-apply; the identity survives. */

export interface StackChange {
  /** Isomer change id (i-xxxxxxxx) — the durable identity. */
  id: string
  name: string
  summary: string
  description?: string
  sha: string
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
  /** Base branch of this PR: the trunk for the bottom, else the branch below. */
  base: string
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

const MARKER = /<!-- isomer-stack:(i-[a-z0-9]+) -->/

export function stackMarker(id: string): string {
  return `<!-- isomer-stack:${id} -->`
}

export function markerIdOf(body: string): string | null {
  return MARKER.exec(body)?.[1] ?? null
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
 * with the current PR highlighted, and the identity marker. */
export function prBody(change: StackChange, stack: StackChange[], prefix: string): string {
  const names = branchNames(stack, prefix)
  const table = stack
    .map((c, i) => {
      const here = c.id === change.id ? ' ← **this PR**' : ''
      return `${i + 1}. \`${names[i]}\` — ${c.summary}${here}`
    })
    .join('\n')
  const description = change.description?.trim()
  return [
    ...(description ? [description, ''] : []),
    '---',
    '**Stack** (bottom → top):',
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
    if (stack.some((c) => c.id === id)) byId.set(id, pr)
    else orphans.push(pr)
  }

  const names = branchNames(stack, opts.prefix)
  const pushes: BranchPush[] = stack.map((change, i) => ({
    change,
    branch: names[i],
    base: i === 0 ? opts.trunk : names[i - 1],
  }))

  const actions: PrAction[] = pushes.map((push) => {
    const existing = byId.get(push.change.id)
    const body = prBody(push.change, stack, opts.prefix)
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
