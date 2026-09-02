import { describe, expect, it } from 'vitest'
import type { HunkMeta } from '../shared/ism-types'
import { fileGroups, groupDiff, hunkDeps, hunkHeader, pathOf } from './organize'

const hunk = (
  id: string,
  over: Partial<HunkMeta> = {},
): HunkMeta => ({
  id,
  commit: 'c1',
  kind: 'mod',
  old_range: [1, 1],
  new_range: [Number(id.split(':').pop()?.split('#')[0] ?? 1), 1],
  lines: { add: 1, del: 1 },
  ...over,
})

describe('fileGroups', () => {
  it('keeps files in first-touch order and sorts hunks by post-image line', () => {
    const groups = fileGroups([
      hunk('b.ts:40#0001'),
      hunk('a.ts:9#0002'),
      hunk('b.ts:5#0003'),
      hunk('a.ts:1#0004'),
    ])
    expect(groups.map((g) => g.path)).toEqual(['b.ts', 'a.ts'])
    expect(groups[0].hunks.map((h) => h.id)).toEqual(['b.ts:5#0003', 'b.ts:40#0001'])
    expect(groups[1].hunks.map((h) => h.id)).toEqual(['a.ts:1#0004', 'a.ts:9#0002'])
  })

  it('breaks equal start lines by stack order', () => {
    const groups = fileGroups([hunk('f.ts:7#aaaa'), hunk('f.ts:7#bbbb')])
    expect(groups[0].hunks.map((h) => h.id)).toEqual(['f.ts:7#aaaa', 'f.ts:7#bbbb'])
  })

  it('splits the path off at the LAST colon', () => {
    expect(pathOf('c:/odd:name.txt:12#abcd')).toBe('c:/odd:name.txt')
    expect(fileGroups([hunk('c:/odd:name.txt:12#abcd')])[0].path).toBe('c:/odd:name.txt')
  })
})

describe('hunkDeps', () => {
  it('builds both directions without duplicates', () => {
    const deps = hunkDeps([
      ['f.ts:9#b', 'f.ts:1#a'],
      ['f.ts:9#b', 'f.ts:1#a'],
      ['f.ts:20#c', 'f.ts:1#a'],
    ])
    expect(deps.get('f.ts:9#b')?.needs).toEqual(['f.ts:1#a'])
    expect(deps.get('f.ts:1#a')?.neededBy).toEqual(['f.ts:9#b', 'f.ts:20#c'])
    expect(deps.get('f.ts:20#c')?.neededBy).toEqual([])
  })
})

describe('groupDiff', () => {
  const group = {
    path: 'f.ts',
    hunks: [
      hunk('f.ts:1#a', { old_range: [1, 1], new_range: [1, 2], context: 'fn one()' }),
      hunk('f.ts:9#b', { old_range: [8, 0], new_range: [9, 1] }),
    ],
  }

  it('renders the header with the function heading and numbered rows', () => {
    const d = groupDiff(group, {
      'f.ts:1#a': '@@ -1,1 +1,2 @@\n-old\n+new1\n+new2\n',
      'f.ts:9#b': '@@ -8,0 +9,1 @@\n+tail\n',
    })
    expect(d.hunkIds).toEqual(['f.ts:1#a', 'f.ts:9#b'])
    expect(d.rows.map((r) => [r.kind, r.oldNo, r.newNo, r.text])).toEqual([
      ['gap', null, null, '@@ -1,1 +1,2 @@ fn one()'],
      ['del', 1, null, 'old'],
      ['add', null, 1, 'new1'],
      ['add', null, 2, 'new2'],
      ['gap', null, null, '@@ -8,0 +9,1 @@'],
      ['add', null, 9, 'tail'],
    ])
  })

  it('shows a header alone while the patch is still loading', () => {
    const d = groupDiff(group, { 'f.ts:9#b': '@@ -8,0 +9,1 @@\n+tail\n' })
    expect(d.rows.map((r) => r.kind)).toEqual(['gap', 'gap', 'add'])
    expect(d.hunkIds).toHaveLength(2)
  })

  it('turns whole-file units into the note, one line each, with no ordinals', () => {
    // A degraded path yields one unit per commit that touches it.
    const units = {
      path: 'img.png',
      hunks: [
        hunk('img.png:0#ffff', { kind: 'file' }),
        hunk('img.png:0#eeee', { kind: 'file', commit: 'c2' }),
      ],
    }
    const d = groupDiff(units, {
      'img.png:0#ffff': 'whole-file unit: img.png -> blob 1234\n',
      'img.png:0#eeee': 'whole-file unit: img.png -> blob 5678\n',
    })
    expect(d.note).toBe(
      'whole-file unit: img.png -> blob 1234\nwhole-file unit: img.png -> blob 5678',
    )
    expect(d.rows).toEqual([])
    expect(d.hunkIds).toEqual([])
    // Still loading: no note rather than a made-up one.
    expect(groupDiff(units, {}).note).toBeNull()
  })

  it('hunkHeader omits the heading when git found none', () => {
    expect(hunkHeader(hunk('f.ts:3#c', { old_range: [3, 2], new_range: [3, 0] }))).toBe(
      '@@ -3,2 +3,0 @@',
    )
  })
})
