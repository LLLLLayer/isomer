import { describe, expect, it } from 'vitest'
import { dayKey, graphLayout } from './graph'

describe('graphLayout', () => {
  it('keeps a linear chain on one lane', () => {
    const rows = graphLayout([
      { sha: 'c', parents: ['b'] },
      { sha: 'b', parents: ['a'] },
      { sha: 'a', parents: [] },
    ])
    expect(rows.map((r) => r.dot)).toEqual([0, 0, 0])
    expect(rows[0].out).toEqual([0])
    expect(rows[2].out).toEqual([]) // root has no parent edge
  })

  it('fans a merge out to two lanes and joins the branch back in', () => {
    // m merges f into the main line: m -> [b, f]; f -> a; b -> a; a root.
    const rows = graphLayout([
      { sha: 'm', parents: ['b', 'f'] },
      { sha: 'f', parents: ['a'] },
      { sha: 'b', parents: ['a'] },
      { sha: 'a', parents: [] },
    ])
    expect(rows[0].merge).toBe(true)
    expect(rows[0].out).toEqual([0, 1]) // first parent lane + merge lane
    expect(rows[1].dot).toBe(1) // f sits on the merge lane
    // f continues to a, but b's lane already expects a first — f converges.
    expect(rows[2].dot).toBe(0)
    expect(rows[3].dot).toBe(0)
    expect(rows[3].into).toEqual([1]) // the branch lane collapses into a
    expect(rows[3].bottomCount).toBe(0)
  })

  it('opens a new lane for an unrelated branch tip', () => {
    const rows = graphLayout([
      { sha: 'x', parents: ['a'] },
      { sha: 'y', parents: ['a'] },
      { sha: 'a', parents: [] },
    ])
    expect(rows[0].dot).toBe(0)
    expect(rows[1].dot).toBe(1)
    // Both lanes converge on a.
    expect(rows[2].dot).toBe(0)
    expect(rows[2].into).toEqual([1])
  })
})

describe('dayKey', () => {
  it('buckets by local calendar day', () => {
    expect(dayKey(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dayKey(1700000000)).toBe(dayKey(1700000000 + 30))
  })
})
