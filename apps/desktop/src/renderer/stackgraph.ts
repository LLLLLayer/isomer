/** Layered DAG layout for the change stack, pure and renderer-agnostic.
 *
 * Columns are longest dependency paths: a change sits one column right of
 * its deepest dependency, so every edge points strictly left→right
 * (upstream → downstream). Rows start from stack order and pull toward the
 * mean row of the dependencies, which keeps diamonds compact without a
 * full crossing-minimization pass.
 */
import type { ChangeDeps } from './stackdeps'

export interface GraphNode {
  sha: string
  /** Column index, 0 = deepest upstream. */
  layer: number
  /** Row within the column. */
  row: number
}

export interface GraphEdge {
  /** Dependency (upstream, drawn left). */
  from: string
  /** Dependent (downstream, drawn right). */
  to: string
  /** Pinned hunk-dependency pairs — the edge's evidence weight. */
  via: number
}

export interface StackGraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  columns: number
  rows: number
}

/** Lay out `commits` (git order, base→head) against the change-level dep
 * map from `changeDeps`. Dependencies always point at earlier commits, so
 * a single pass resolves every layer; an edge whose target is not laid
 * out (malformed input) is dropped rather than drawn dangling. */
export function stackGraphLayout(
  commits: { sha: string }[],
  bySha: Map<string, ChangeDeps>,
): StackGraphLayout {
  const layerOf = new Map<string, number>()
  const rowOf = new Map<string, number>()
  const taken = new Map<number, Set<number>>()
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (const c of commits) {
    const needs = (bySha.get(c.sha)?.needs ?? []).filter((n) => layerOf.has(n.target))
    let layer = 0
    for (const n of needs) layer = Math.max(layer, (layerOf.get(n.target) ?? 0) + 1)
    layerOf.set(c.sha, layer)

    const rows = taken.get(layer) ?? new Set<number>()
    taken.set(layer, rows)
    // Aim at the mean row of the dependencies (stack order for roots),
    // then take the nearest free slot: desired, +1, -1, +2, -2, …
    const desired =
      needs.length === 0
        ? rows.size
        : Math.round(needs.reduce((a, n) => a + (rowOf.get(n.target) ?? 0), 0) / needs.length)
    let row = -1
    for (let off = 0; row === -1; off++) {
      for (const cand of off === 0 ? [desired] : [desired + off, desired - off]) {
        if (cand >= 0 && !rows.has(cand)) {
          row = cand
          break
        }
      }
    }
    rows.add(row)
    rowOf.set(c.sha, row)
    nodes.push({ sha: c.sha, layer, row })
    for (const n of needs) edges.push({ from: n.target, to: c.sha, via: n.via.length })
  }

  return {
    nodes,
    edges,
    columns: nodes.reduce((a, n) => Math.max(a, n.layer + 1), 0),
    rows: nodes.reduce((a, n) => Math.max(a, n.row + 1), 0),
  }
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
