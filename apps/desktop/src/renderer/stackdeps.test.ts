import { describe, expect, it } from 'vitest'
import { changeDeps } from './stackdeps'

const snap = {
  commits: [
    { sha: 'A', hunks: ['f.ts:1#aaaa', 'f.ts:9#aaab'] },
    { sha: 'B', hunks: ['f.ts:20#bbbb'] },
    { sha: 'C', hunks: ['g.ts:1#cccc'] },
  ],
  deps: [
    // B's hunk removes/touches lines created by both of A's hunks.
    ['f.ts:20#bbbb', 'f.ts:1#aaaa'],
    ['f.ts:20#bbbb', 'f.ts:9#aaab'],
    // Intra-change dep must not become an edge.
    ['f.ts:9#aaab', 'f.ts:1#aaaa'],
  ] as [string, string][],
}

describe('changeDeps', () => {
  it('lifts hunk deps to change edges with evidence', () => {
    const { bySha } = changeDeps(snap)
    const b = bySha.get('B')
    expect(b?.needs).toHaveLength(1)
    expect(b?.needs[0].target).toBe('A')
    expect(b?.needs[0].via).toEqual([
      ['f.ts:20#bbbb', 'f.ts:1#aaaa'],
      ['f.ts:20#bbbb', 'f.ts:9#aaab'],
    ])
    expect(bySha.get('A')?.neededBy).toEqual(['B'])
  })

  it('ignores intra-change deps and marks untouched commits independent', () => {
    const { bySha, independent } = changeDeps(snap)
    expect(bySha.get('A')?.needs).toHaveLength(0)
    expect(independent).toEqual(new Set(['C']))
    expect(independent.has('B')).toBe(false)
  })

  it('ignores deps whose hunks fall outside the stack', () => {
    const { bySha } = changeDeps({
      commits: [{ sha: 'A', hunks: ['f.ts:1#aaaa'] }],
      deps: [['f.ts:1#aaaa', 'gone.ts:1#dead']],
    })
    expect(bySha.get('A')?.needs).toHaveLength(0)
  })
})
