/** Rail layout for the change-stack dependency graph, pure and
 * renderer-agnostic.
 *
 * Graph mode keeps the list's full-width, readable cards (head first, base
 * at the bottom) and draws dependency edges as brackets in a left gutter —
 * the same shape every commit-graph rail uses, so it stays legible at any
 * pane width. Edges spanning overlapping row ranges get distinct lanes;
 * edges that merely touch at a shared card may share one, so a chain reads
 * as a single continuous line.
 */
import type { ChangeDeps } from './stackdeps'

export interface RailEdge {
  /** Dependency (the lower card — closer to base). */
  from: string
  /** Dependent (the upper card). */
  to: string
  /** Pinned hunk-dependency pairs — the edge's evidence weight. */
  via: number
  /** Gutter lane, 0 = nearest the cards. */
  lane: number
}

export interface RailLayout {
  /** Display order: head first (top), base last — same as the list. */
  order: string[]
  edges: RailEdge[]
  lanes: number
}

/** Lay out `commits` (git order, base→head) against the change-level dep
 * map from `changeDeps`. An edge whose endpoint is not in the commits
 * (malformed input) is dropped rather than drawn dangling. */
export function railLayout(
  commits: { sha: string }[],
  bySha: Map<string, ChangeDeps>,
): RailLayout {
  const order = commits.map((c) => c.sha).reverse()
  const rowOf = new Map(order.map((sha, row) => [sha, row]))

  const raw: { from: string; to: string; via: number; lo: number; hi: number }[] = []
  for (const c of commits) {
    for (const n of bySha.get(c.sha)?.needs ?? []) {
      const a = rowOf.get(n.target)
      const b = rowOf.get(c.sha)
      if (a === undefined || b === undefined || a === b) continue
      raw.push({
        from: n.target,
        to: c.sha,
        via: n.via.length,
        lo: Math.min(a, b),
        hi: Math.max(a, b),
      })
    }
  }

  // Greedy interval partitioning over row spans: smallest lane whose last
  // edge ends at or above this one's start (touching = sharing one card).
  raw.sort((x, y) => x.lo - y.lo || x.hi - y.hi)
  const laneEnd: number[] = []
  const edges: RailEdge[] = raw.map((e) => {
    let lane = laneEnd.findIndex((end) => end <= e.lo)
    if (lane === -1) {
      lane = laneEnd.length
      laneEnd.push(e.hi)
    } else {
      laneEnd[lane] = e.hi
    }
    return { from: e.from, to: e.to, via: e.via, lane }
  })

  return { order, edges, lanes: laneEnd.length }
}

/** Transitive upstream (dependencies) and downstream (dependents) of one
 * change — the sets the graph lights up on hover. Excludes `start`. */
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
