/** Commit-graph lane layout (Fork-style rail), pure and renderer-agnostic.
 *
 * Walks the log top-down keeping a list of active lanes, where each lane
 * holds the sha it expects to meet next. A commit lands on the first lane
 * expecting it (or opens a new one), consumes every lane that was waiting
 * for it (merge-ins), continues on its first parent, and fans out one lane
 * per extra parent (merge-outs).
 */

export interface RowGraph {
  /** Lane index of this commit's dot. */
  dot: number
  /** True when the commit has 2+ parents (drawn hollow). */
  merge: boolean
  /** Straight pass-through edges: [top lane, bottom lane]. */
  through: [number, number][]
  /** Lanes (top x) that terminate in this commit's dot. */
  into: number[]
  /** Lanes (bottom x) that emanate from this commit's dot. */
  out: number[]
  /** Lane count entering the row (for continuity fillers above). */
  topCount: number
  /** Lane count leaving the row. */
  bottomCount: number
}

export function graphLayout(entries: { sha: string; parents: string[] }[]): RowGraph[] {
  let lanes: string[] = []
  const rows: RowGraph[] = []
  for (const e of entries) {
    const top = [...lanes]
    // Lanes truly entering from above — a brand-new tip's lane starts AT
    // this row, so headers above it must not draw a stub for it.
    const topCount = top.length
    let dot = top.indexOf(e.sha)
    if (dot === -1) {
      dot = top.length
      top.push(e.sha)
    }

    const next: string[] = []
    const through: [number, number][] = []
    const into: number[] = []
    const out: number[] = []
    const first = e.parents[0]

    for (let j = 0; j < top.length; j++) {
      if (top[j] === e.sha) {
        if (j === dot) {
          if (first !== undefined) {
            // Continue on the first parent. Duplicate expectations are
            // fine — lanes waiting for the same sha run in parallel and
            // collapse at that commit's dot (canonical client look).
            out.push(next.length)
            next.push(first)
          }
        } else {
          into.push(j) // a lane waiting for this commit collapses into it
        }
      } else {
        through.push([j, next.length])
        next.push(top[j])
      }
    }

    for (const p of e.parents.slice(1)) {
      const existing = next.indexOf(p)
      if (existing !== -1) out.push(existing)
      else {
        out.push(next.length)
        next.push(p)
      }
    }

    rows.push({
      dot,
      merge: e.parents.length > 1,
      through,
      into,
      out,
      topCount,
      bottomCount: next.length,
    })
    lanes = next
  }
  return rows
}

/** Day bucket for history grouping (local time). */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
