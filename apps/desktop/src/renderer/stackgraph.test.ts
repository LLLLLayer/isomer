import { describe, expect, it } from 'vitest'
import { changeDeps } from './stackdeps'
import { lineage, stackGraphLayout } from './stackgraph'

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

describe('stackGraphLayout', () => {
  it('lays a pure chain on one row, one column per change', () => {
    const l = stackGraphLayout([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], chain.bySha)
    expect(l.nodes).toEqual([
      { sha: 'A', layer: 0, row: 0 },
      { sha: 'B', layer: 1, row: 0 },
      { sha: 'C', layer: 2, row: 0 },
    ])
    expect(l.columns).toBe(3)
    expect(l.rows).toBe(1)
  })

  it('stacks independent changes in one column, in stack order', () => {
    const free = depsOf(
      [
        ['A', ['f:1#a']],
        ['B', ['g:1#b']],
        ['C', ['h:1#c']],
      ],
      [],
    )
    const l = stackGraphLayout([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], free.bySha)
    expect(l.nodes.map((n) => [n.layer, n.row])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ])
    expect(l.edges).toEqual([])
  })

  it('spreads a diamond over rows and layers by longest path', () => {
    const l = stackGraphLayout(
      [{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }, { sha: 'D' }],
      diamond.bySha,
    )
    const at = new Map(l.nodes.map((n) => [n.sha, n]))
    expect(at.get('A')).toMatchObject({ layer: 0, row: 0 })
    // B and C both depend on A: same column, distinct rows.
    expect(at.get('B')?.layer).toBe(1)
    expect(at.get('C')?.layer).toBe(1)
    expect(at.get('B')?.row).not.toBe(at.get('C')?.row)
    // D joins both arms one column right, pulled between their rows.
    expect(at.get('D')?.layer).toBe(2)
    expect(l.columns).toBe(3)
    expect(l.rows).toBe(2)
  })

  it('emits one edge per dependency with its evidence weight', () => {
    const l = stackGraphLayout([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], chain.bySha)
    expect(l.edges).toEqual([
      { from: 'A', to: 'B', via: 1 },
      { from: 'B', to: 'C', via: 1 },
    ])
  })

  it('drops edges whose target is not in the laid-out commits', () => {
    // Malformed input: the dep map knows a change the commit list lacks.
    const l = stackGraphLayout([{ sha: 'B' }], chain.bySha)
    expect(l.nodes).toEqual([{ sha: 'B', layer: 0, row: 0 }])
    expect(l.edges).toEqual([])
  })

  it('never assigns a negative row when pulled toward row 0', () => {
    const l = stackGraphLayout(
      [{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }, { sha: 'D' }],
      diamond.bySha,
    )
    for (const n of l.nodes) expect(n.row).toBeGreaterThanOrEqual(0)
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
