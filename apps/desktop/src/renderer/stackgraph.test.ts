import { describe, expect, it } from 'vitest'
import { changeDeps } from './stackdeps'
import { lineage, railLayout } from './stackgraph'

/** Build the change-level dep map from a compact fixture. */
const depsOf = (
  commits: [string, string[]][],
  deps: [string, string][],
): ReturnType<typeof changeDeps> =>
  changeDeps({ commits: commits.map(([sha, hunks]) => ({ sha, hunks })), deps })

const chain = depsOf(
  [
    ['A', ['f:1#a']],
    ['B', ['f:2#b']],
    ['C', ['f:3#c']],
  ],
  [
    ['f:2#b', 'f:1#a'],
    ['f:3#c', 'f:2#b'],
  ],
)

const diamond = depsOf(
  [
    ['A', ['f:1#a']],
    ['B', ['f:2#b']],
    ['C', ['g:1#c']],
    ['D', ['f:3#d', 'g:2#e']],
  ],
  [
    ['f:2#b', 'f:1#a'],
    ['g:1#c', 'f:1#a'],
    ['f:3#d', 'f:2#b'],
    ['g:2#e', 'g:1#c'],
  ],
)

describe('railLayout', () => {
  it('orders cards head-first, like the list', () => {
    const l = railLayout([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], chain.bySha)
    expect(l.order).toEqual(['C', 'B', 'A'])
  })

  it('folds a pure chain onto a single lane', () => {
    const l = railLayout([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], chain.bySha)
    expect(l.edges).toEqual([
      { from: 'B', to: 'C', via: 1, lane: 0 },
      { from: 'A', to: 'B', via: 1, lane: 0 },
    ])
    expect(l.lanes).toBe(1)
  })

  it('gives properly overlapping spans distinct lanes', () => {
    const l = railLayout(
      [{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }, { sha: 'D' }],
      diamond.bySha,
    )
    // Display rows: D=0 C=1 B=2 A=3. Spans: B→D [0,2] and C→D [0,1]
    // overlap; A→B [2,3] and A→C [1,3] overlap.
    const rowOf = new Map(l.order.map((sha, i) => [sha, i]))
    const span = (e: { from: string; to: string }): [number, number] => {
      const a = rowOf.get(e.from) as number
      const b = rowOf.get(e.to) as number
      return [Math.min(a, b), Math.max(a, b)]
    }
    for (const x of l.edges) {
      for (const y of l.edges) {
        if (x === y || x.lane !== y.lane) continue
        const [xl, xh] = span(x)
        const [yl, yh] = span(y)
        // Same lane ⇒ the spans may only touch at a single shared card.
        expect(Math.max(xl, yl)).toBeGreaterThanOrEqual(Math.min(xh, yh))
      }
    }
    expect(l.lanes).toBe(2)
    expect(l.edges).toHaveLength(4)
  })

  it('yields no edges and zero lanes for independent changes', () => {
    const free = depsOf(
      [
        ['A', ['f:1#a']],
        ['B', ['g:1#b']],
      ],
      [],
    )
    const l = railLayout([{ sha: 'A' }, { sha: 'B' }], free.bySha)
    expect(l.edges).toEqual([])
    expect(l.lanes).toBe(0)
  })

  it('drops edges whose endpoint is not in the commits', () => {
    // Malformed input: the dep map knows a change the commit list lacks.
    const l = railLayout([{ sha: 'B' }], chain.bySha)
    expect(l.order).toEqual(['B'])
    expect(l.edges).toEqual([])
  })

  it('carries the evidence weight on every edge', () => {
    const heavy = depsOf(
      [
        ['A', ['f:1#a', 'f:5#b']],
        ['B', ['f:9#c']],
      ],
      [
        ['f:9#c', 'f:1#a'],
        ['f:9#c', 'f:5#b'],
      ],
    )
    const l = railLayout([{ sha: 'A' }, { sha: 'B' }], heavy.bySha)
    expect(l.edges).toEqual([{ from: 'A', to: 'B', via: 2, lane: 0 }])
  })
})

describe('lineage', () => {
  it('walks the transitive closure both ways', () => {
    const d = lineage('D', diamond.bySha)
    expect(d.up).toEqual(new Set(['A', 'B', 'C']))
    expect(d.down).toEqual(new Set())
    const a = lineage('A', diamond.bySha)
    expect(a.up).toEqual(new Set())
    expect(a.down).toEqual(new Set(['B', 'C', 'D']))
  })

  it('keeps middle nodes out of their own lineage', () => {
    const b = lineage('B', diamond.bySha)
    expect(b.up).toEqual(new Set(['A']))
    expect(b.down).toEqual(new Set(['D']))
    expect(b.up.has('B')).toBe(false)
    expect(b.down.has('B')).toBe(false)
  })

  it('returns empty sets for an unknown change', () => {
    const x = lineage('nope', diamond.bySha)
    expect(x.up.size).toBe(0)
    expect(x.down.size).toBe(0)
  })
})
