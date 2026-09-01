import { describe, expect, it } from 'vitest'
import { changeDeps } from './stackdeps'
import { lineage, stackTree } from './stacktree'

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

describe('stackTree', () => {
  it('nests a chain one level per link, keeping landing positions', () => {
    const rows = stackTree([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], chain.bySha)
    expect(rows).toEqual([
      { sha: 'A', depth: 0, pos: 1, guides: [], last: true, extraNeeds: [] },
      { sha: 'B', depth: 1, pos: 2, guides: [], last: true, extraNeeds: [] },
      { sha: 'C', depth: 2, pos: 3, guides: [false], last: true, extraNeeds: [] },
    ])
  })

  it('keeps independent changes at the top level in git order', () => {
    const free = depsOf(
      [
        ['A', ['f:1#a']],
        ['B', ['g:1#b']],
        ['C', ['h:1#c']],
      ],
      [],
    )
    const rows = stackTree([{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }], free.bySha)
    expect(rows.map((r) => [r.sha, r.depth, r.pos])).toEqual([
      ['A', 0, 1],
      ['B', 0, 2],
      ['C', 0, 3],
    ])
  })

  it('hangs a diamond under its nearest deepest arm and annotates the rest', () => {
    const rows = stackTree(
      [{ sha: 'A' }, { sha: 'B' }, { sha: 'C' }, { sha: 'D' }],
      diamond.bySha,
    )
    expect(rows.map((r) => r.sha)).toEqual(['A', 'B', 'C', 'D'])
    const at = new Map(rows.map((r) => [r.sha, r]))
    // B and C tie on depth; D nests under C (nearest in git order).
    expect(at.get('D')?.depth).toBe(2)
    expect(at.get('D')?.extraNeeds).toEqual([{ target: 'B', via: 1 }])
    // B is A's first child (has a sibling), C is the last.
    expect(at.get('B')?.last).toBe(false)
    expect(at.get('C')?.last).toBe(true)
    // D's guide column reflects that C is the last child — no line.
    expect(at.get('D')?.guides).toEqual([false])
  })

  it('draws a guide line while an earlier sibling subtree is open', () => {
    // A has children B (with child D) and C: D's row must carry a line for
    // the still-open level of B.
    const t = depsOf(
      [
        ['A', ['f:1#a']],
        ['B', ['f:2#b']],
        ['D', ['f:3#d']],
        ['C', ['g:1#c']],
      ],
      [
        ['f:2#b', 'f:1#a'],
        ['f:3#d', 'f:2#b'],
        ['g:1#c', 'f:1#a'],
      ],
    )
    const rows = stackTree(
      [{ sha: 'A' }, { sha: 'B' }, { sha: 'D' }, { sha: 'C' }],
      t.bySha,
    )
    expect(rows.map((r) => r.sha)).toEqual(['A', 'B', 'D', 'C'])
    const d = rows[2]
    expect(d.depth).toBe(2)
    expect(d.guides).toEqual([true])
    expect(rows[1].last).toBe(false)
    expect(rows[3].last).toBe(true)
  })

  it('drops malformed forward and unknown deps instead of cycling', () => {
    // The dep map knows a change the commit list lacks.
    const rows = stackTree([{ sha: 'B' }], chain.bySha)
    expect(rows).toEqual([
      { sha: 'B', depth: 0, pos: 1, guides: [], last: true, extraNeeds: [] },
    ])
    // A forward edge (dependency later in git order) is not structure.
    const forward = depsOf(
      [
        ['X', ['f:1#x']],
        ['Y', ['f:2#y']],
      ],
      [['f:1#x', 'f:2#y']],
    )
    const fRows = stackTree([{ sha: 'X' }, { sha: 'Y' }], forward.bySha)
    expect(fRows.map((r) => [r.sha, r.depth])).toEqual([
      ['X', 0],
      ['Y', 0],
    ])
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
