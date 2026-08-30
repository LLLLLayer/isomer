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
    expect(rows[0]).toEqual({ kind: 'context', oldNo: 1, newNo: 1, text: 'def checkout(cart):' })
    expect(rows[2]).toEqual({ kind: 'del', oldNo: 3, newNo: null, text: '    return total' })
    expect(rows[3]).toEqual({ kind: 'add', oldNo: null, newNo: 3, text: '    total *= 0.9' })
    // A gap row separates hunks; the second hunk restarts numbering.
    expect(rows[5].kind).toBe('gap')
    expect(rows[6]).toEqual({ kind: 'del', oldNo: 9, newNo: null, text: 'old' })
    expect(rows[7]).toEqual({ kind: 'add', oldNo: null, newNo: 10, text: 'new' })
    // Deleted file keeps its old-side path; binary carries a note.
    expect(files[1].rows[0].kind).toBe('del')
    expect(files[2].note).toContain('Binary')
  })
})

describe('splitRows', () => {
  it('pairs del/add runs and passes context through', () => {
    const files = parseUnifiedDiff(SHOW)
    const split = splitRows(files[0].rows)
    expect(split[0].left?.kind).toBe('context')
    expect(split[0].right?.text).toBe('def checkout(cart):')
    // del "return total" pairs with add "total *= 0.9"
    expect(split[2].left?.kind).toBe('del')
    expect(split[2].right?.kind).toBe('add')
    // surplus add gets an empty left cell
    expect(split[3].left).toBeNull()
    expect(split[3].right?.text).toBe('    return total')
  })
})
