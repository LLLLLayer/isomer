/** Outline layout for the change stack, pure and renderer-agnostic.
 *
 * The stack is a proven linearization, so the view keeps landing order as
 * the spine (base first) and shows dependency structure the way stacked-PR
 * tools settled on: indentation. A change nests under its deepest
 * dependency; a diamond keeps one tree edge and carries its remaining
 * dependencies as annotations. Every row keeps its landing position, so
 * grouping by structure never loses the linearization.
 */
import type { ChangeDeps } from './stackdeps'

export interface TreeRow {
  sha: string
  /** Indentation level, 0 = depends on nothing in the stack. */
  depth: number
  /** 1-based landing position (git order — what apply will produce). */
  pos: number
  /** Guide columns for levels 0..depth-2: true = draw a vertical line
   * (that ancestor has more children below this row). */
  guides: boolean[]
  /** True when this row is its parent's last child (└ vs ├). */
  last: boolean
  /** Dependencies not covered by the tree edge (diamond arms). */
  extraNeeds: { target: string; via: number }[]
}

/** Build the outline from `commits` (git order, base→head) and the
 * change-level dep map. Malformed deps (unknown targets, forward or self
 * references) are dropped rather than trusted — the tree must never cycle. */
export function stackTree(
  commits: { sha: string }[],
  bySha: Map<string, ChangeDeps>,
): TreeRow[] {
  const index = new Map(commits.map((c, i) => [c.sha, i]))
  const depth = new Map<string, number>()
  const parentOf = new Map<string, string | null>()
  const extraOf = new Map<string, { target: string; via: number }[]>()

  for (const c of commits) {
    const mine = index.get(c.sha) as number
    // Only backward edges are structure; anything else is malformed input.
    const needs = (bySha.get(c.sha)?.needs ?? []).filter((n) => {
      const t = index.get(n.target)
      return t !== undefined && t < mine
    })
    let parent: string | null = null
    for (const n of needs) {
      if (
        parent === null ||
        (depth.get(n.target) as number) > (depth.get(parent) as number) ||
        ((depth.get(n.target) as number) === (depth.get(parent) as number) &&
          (index.get(n.target) as number) > (index.get(parent) as number))
      ) {
        parent = n.target
      }
    }
    parentOf.set(c.sha, parent)
    depth.set(c.sha, parent === null ? 0 : (depth.get(parent) as number) + 1)
    extraOf.set(
      c.sha,
      needs
        .filter((n) => n.target !== parent)
        .map((n) => ({ target: n.target, via: n.via.length })),
    )
  }

  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const c of commits) {
    const p = parentOf.get(c.sha) ?? null
    if (p === null) roots.push(c.sha)
    else children.set(p, [...(children.get(p) ?? []), c.sha])
  }

  const rows: TreeRow[] = []
  const visit = (sha: string, d: number, guides: boolean[], isLast: boolean): void => {
    rows.push({
      sha,
      depth: d,
      pos: (index.get(sha) as number) + 1,
      guides,
      last: isLast,
      extraNeeds: extraOf.get(sha) ?? [],
    })
    const kids = children.get(sha) ?? []
    kids.forEach((k, i) =>
      visit(k, d + 1, d === 0 ? [] : [...guides, !isLast], i === kids.length - 1),
    )
  }
  for (const r of roots) visit(r, 0, [], true)
  return rows
}

/** Transitive upstream (dependencies) and downstream (dependents) of one
 * change — the sets the outline lights up on hover. Excludes `start`. */
export function lineage(
  start: string,
  bySha: Map<string, ChangeDeps>,
): { up: Set<string>; down: Set<string> } {
  const walk = (next: (sha: string) => string[]): Set<string> => {
    const seen = new Set<string>()
    const queue = [start]
    while (queue.length > 0) {
      const sha = queue.pop() as string
      for (const t of next(sha)) {
        if (t !== start && !seen.has(t)) {
          seen.add(t)
          queue.push(t)
        }
      }
    }
    return seen
  }
  return {
    up: walk((sha) => (bySha.get(sha)?.needs ?? []).map((n) => n.target)),
    down: walk((sha) => bySha.get(sha)?.neededBy ?? []),
  }
}
