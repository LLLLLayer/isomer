import { describe, expect, it } from 'vitest'
import { parseHunkPatch, sideBySideRows } from './diff'

// Captured from real `ism show hunk` output shape.
const PATCH = '@@ -2,1 +2,2 @@\n-old line\n+new line one\n+new line two\n'

describe('parseHunkPatch', () => {
  it('reads header ranges and line bodies', () => {
    const h = parseHunkPatch(PATCH)
    expect(h).not.toBeNull()
    expect(h!.oldStart).toBe(2)
    expect(h!.newLen).toBe(2)
    expect(h!.removed).toEqual(['old line'])
    expect(h!.added).toEqual(['new line one', 'new line two'])
  })

  it('returns null for whole-file (degraded) descriptions', () => {
    expect(parseHunkPatch('whole-file unit: img.png -> blob 1234')).toBeNull()
  })

  it('keeps lines whose content starts with - or + intact', () => {
    const h = parseHunkPatch('@@ -1,1 +1,1 @@\n--- sql comment\n+++ still sql\n')
    expect(h!.removed).toEqual(['-- sql comment'])
    expect(h!.added).toEqual(['++ still sql'])
  })
})

describe('sideBySideRows', () => {
  it('pairs lines and pads the shorter side', () => {
    const rows = sideBySideRows(parseHunkPatch(PATCH)!)
    expect(rows).toHaveLength(2)
    expect(rows[0].left).toEqual({ lineNo: 2, text: 'old line' })
    expect(rows[0].right).toEqual({ lineNo: 2, text: 'new line one' })
    expect(rows[1].left).toBeNull()
    expect(rows[1].right).toEqual({ lineNo: 3, text: 'new line two' })
  })
})

import { parseUnifiedDiff, splitRows } from './diff'

const SHOW = `diff --git a/shop.py b/shop.py
index 1111111..2222222 100644
--- a/shop.py
+++ b/shop.py
@@ -1,4 +1,5 @@
 def checkout(cart):
     total = sum(cart)
-    return total
+    total *= 0.9
+    return total
@@ -9,2 +10,2 @@
-old
+new
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 3333333..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
diff --git a/img.png b/img.png
index 4444444..5555555 100644
Binary files a/img.png and b/img.png differ
`

describe('parseUnifiedDiff', () => {
  it('splits files and numbers context/del/add rows', () => {
    const files = parseUnifiedDiff(SHOW)
    expect(files.map((f) => f.path)).toEqual(['shop.py', 'gone.txt', 'img.png'])
    const rows = files[0].rows
    // Every hunk opens with a header-carrying gap row.
    expect(rows[0]).toEqual({ kind: 'gap', oldNo: null, newNo: null, text: '@@ -1,4 +1,5 @@' })
    expect(rows[1]).toEqual({ kind: 'context', oldNo: 1, newNo: 1, text: 'def checkout(cart):' })
    expect(rows[3]).toEqual({ kind: 'del', oldNo: 3, newNo: null, text: '    return total' })
    expect(rows[4]).toEqual({ kind: 'add', oldNo: null, newNo: 3, text: '    total *= 0.9' })
    // The second hunk's header row restarts numbering after it.
    expect(rows[6].kind).toBe('gap')
    expect(rows[7]).toEqual({ kind: 'del', oldNo: 9, newNo: null, text: 'old' })
    expect(rows[8]).toEqual({ kind: 'add', oldNo: null, newNo: 10, text: 'new' })
    // Deleted file keeps its old-side path; binary carries a note.
    expect(files[1].rows[1].kind).toBe('del')
    expect(files[2].note).toContain('Binary')
  })
})

describe('splitRows', () => {
  it('pairs del/add runs and passes context through', () => {
    const files = parseUnifiedDiff(SHOW)
    const split = splitRows(files[0].rows)
    // The hunk header passes through as a gap row.
    expect(split[0].gap).toBe('@@ -1,4 +1,5 @@')
    expect(split[1].left?.kind).toBe('context')
    expect(split[1].right?.text).toBe('def checkout(cart):')
    // del "return total" pairs with add "total *= 0.9"
    expect(split[3].left?.kind).toBe('del')
    expect(split[3].right?.kind).toBe('add')
    // surplus add gets an empty left cell
    expect(split[4].left).toBeNull()
    expect(split[4].right?.text).toBe('    return total')
  })
})

import { emphasisRanges, intraline } from './diff'

describe('intraline', () => {
  it('emphasizes the changed middle of an edited line', () => {
    const e = intraline('    return total', '    return total * 0.9')
    expect(e).not.toBeNull()
    // Common prefix "    return total" — only the appended tail differs.
    expect(e!.a).toEqual([16, 16])
    expect(e!.b).toEqual([16, 22])
  })

  it('returns null for full rewrites and identical lines', () => {
    expect(intraline('abc', 'abc')).toBeNull()
    expect(intraline('foo', 'qux')).toBeNull()
    // Indentation alone is not shared shape.
    expect(intraline('    return total', '    total *= 0.9')).toBeNull()
  })

  it('never lets prefix and suffix overlap', () => {
    const e = intraline('aaaa', 'aa')
    expect(e).not.toBeNull()
    const [ba, ea] = e!.a
    const [bb, eb] = e!.b
    expect(ba).toBeLessThanOrEqual(ea)
    expect(bb).toBeLessThanOrEqual(eb)
  })
})

describe('emphasisRanges', () => {
  it('pairs del/add runs index-by-index and maps ranges to row indexes', () => {
    const files = parseUnifiedDiff(SHOW)
    const ranges = emphasisRanges(files[0].rows)
    // rows[3] del "    return total" pairs with rows[4] add "    total *= 0.9"
    // (a rewrite → no emphasis); the second hunk's old/new pair is a rewrite
    // too, so nothing is emphasized in this fixture.
    expect(ranges.get(3)).toBeUndefined()
    const edited = parseUnifiedDiff(
      'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-const a = 1\n+const a = 2\n',
    )
    const r2 = emphasisRanges(edited[0].rows)
    expect(r2.get(1)).toEqual([10, 11])
    expect(r2.get(2)).toEqual([10, 11])
  })
})

describe('parseUnifiedDiff header guard', () => {
  it('keeps in-hunk SQL-comment lines and never rebinds the path', () => {
    const raw =
      'diff --git a/q.sql b/q.sql\n' +
      '--- a/q.sql\n' +
      '+++ b/q.sql\n' +
      '@@ -1,2 +1,1 @@\n' +
      '--- a/tmp cleanup\n' + // deleted line whose CONTENT is "-- a/tmp cleanup"
      '-select 1\n' +
      '+select 2\n'
    const files = parseUnifiedDiff(raw)
    expect(files[0].path).toBe('q.sql')
    const rows = files[0].rows.filter((r) => r.kind !== 'gap')
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ['del', '-- a/tmp cleanup'],
      ['del', 'select 1'],
      ['add', 'select 2'],
    ])
    // Old-side numbering stays contiguous.
    expect(rows[0].oldNo).toBe(1)
    expect(rows[1].oldNo).toBe(2)
  })
})

describe('intraline surrogate safety', () => {
  it('never slices between a surrogate pair', () => {
    const a = 'x = "\u{1F642}"'
    const b = 'x = "\u{1F643}"'
    const e = intraline(a, b)
    expect(e).not.toBeNull()
    for (const [str, [lo, hi]] of [
      [a, e!.a],
      [b, e!.b],
    ] as const) {
      for (const i of [lo, hi]) {
        if (i > 0 && i < str.length) {
          // Boundary must not sit between a high and a low surrogate.
          const high = (str.charCodeAt(i - 1) & 0xfc00) === 0xd800
          const low = (str.charCodeAt(i) & 0xfc00) === 0xdc00
          expect(high && low).toBe(false)
        }
      }
    }
  })
})

import { extractHunkPatches } from './diff'

describe('extractHunkPatches', () => {
  it('yields apply-able verbatim patches, one per hunk', () => {
    const raw =
      'diff --git a/x.ts b/x.ts\n' +
      'index 1111111..2222222 100644\n' +
      '--- a/x.ts\n' +
      '+++ b/x.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-const a = 1\n' +
      '+const a = 2\n' +
      '@@ -9,1 +9,2 @@\n' +
      ' keep\n' +
      '+added\n'
    const files = extractHunkPatches(raw)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('x.ts')
    expect(files[0].patches).toHaveLength(2)
    // Each patch carries the full header and exactly its own hunk.
    expect(files[0].patches[0]).toContain('--- a/x.ts')
    expect(files[0].patches[0]).toContain('-const a = 1')
    expect(files[0].patches[0]).not.toContain('added')
    expect(files[0].patches[1]).toContain('@@ -9,1 +9,2 @@')
    expect(files[0].patches[1].endsWith('+added\n')).toBe(true)
  })
})
