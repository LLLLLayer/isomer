/** Parse one U0 hunk's patch text (as emitted by ism) into line rows. */

export interface ParsedHunk {
  oldStart: number
  oldLen: number
  newStart: number
  newLen: number
  removed: string[]
  added: string[]
}

export function parseHunkPatch(patch: string): ParsedHunk | null {
  const lines = patch.split('\n')
  const m = lines[0]?.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/)
  if (!m) return null
  const removed: string[] = []
  const added: string[] = []
  for (const l of lines.slice(1)) {
    if (l.startsWith('-')) removed.push(l.slice(1))
    else if (l.startsWith('+')) added.push(l.slice(1))
  }
  return {
    oldStart: Number(m[1]),
    oldLen: Number(m[2]),
    newStart: Number(m[3]),
    newLen: Number(m[4]),
    removed,
    added,
  }
}

export interface DiffCell {
  lineNo: number
  text: string
}

export interface DiffRow {
  left: DiffCell | null
  right: DiffCell | null
}

/** Pair removed/added lines into side-by-side rows. */
export function sideBySideRows(h: ParsedHunk): DiffRow[] {
  const rows: DiffRow[] = []
  const n = Math.max(h.removed.length, h.added.length)
  for (let i = 0; i < n; i++) {
    rows.push({
      left: i < h.removed.length ? { lineNo: h.oldStart + i, text: h.removed[i] } : null,
      right: i < h.added.length ? { lineNo: h.newStart + i, text: h.added[i] } : null,
    })
  }
  return rows
}

/* ==== full unified diffs (git diff / git show output) ==================== */

export type UnifiedRowKind = 'context' | 'del' | 'add' | 'gap'

export interface UnifiedRow {
  kind: UnifiedRowKind
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface FileDiff {
  path: string
  /** binary or otherwise unrenderable entries carry a note instead of rows */
  note: string | null
  rows: UnifiedRow[]
}

/** Parse multi-file `git diff`/`git show -p` output into renderable rows. */
export function parseUnifiedDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = []
  let cur: FileDiff | null = null
  let oldNo = 0
  let newNo = 0
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      // Provisional path from the header (binary entries never get ---/+++;
      // ambiguous only for paths containing " b/", which those lines fix).
      const idx = line.lastIndexOf(' b/')
      cur = { path: idx >= 0 ? line.slice(idx + 3) : '', note: null, rows: [] }
      files.push(cur)
      continue
    }
    if (!cur) continue
    // Real ---/+++ headers only appear between `diff --git` and the first
    // hunk. Inside a hunk, a deleted `-- foo` line arrives as `--- foo` —
    // an SQL/Lua comment, not a header — and must fall through to content.
    if (cur.rows.length === 0 && line.startsWith('+++ ')) {
      const p = line.slice(4)
      if (p.startsWith('b/')) cur.path = p.slice(2)
      continue
    }
    if (cur.rows.length === 0 && line.startsWith('--- ')) {
      const p = line.slice(4)
      // Deletions have +++ /dev/null; the old-side path wins then.
      if (p.startsWith('a/')) cur.path = p.slice(2)
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      cur.note = line
      continue
    }
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (header) {
      // Hunk boundary: a gap row that carries the header text (incl. the
      // function context git appends after the second @@).
      cur.rows.push({ kind: 'gap', oldNo: null, newNo: null, text: line })
      oldNo = Number(header[1])
      newNo = Number(header[2])
      continue
    }
    if (cur.rows.length === 0 && !line.startsWith('+') && !line.startsWith('-') && !line.startsWith(' ')) {
      continue // index/mode metadata before the first hunk
    }
    if (line.startsWith('+')) {
      cur.rows.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      cur.rows.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) })
    } else if (line.startsWith(' ')) {
      cur.rows.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) })
    }
    // "\ No newline" markers and trailing metadata are skipped.
  }
  return files.filter((f) => f.path !== '' || f.note !== null)
}

export interface SplitRow {
  left: (DiffCell & { kind: 'context' | 'del' }) | null
  right: (DiffCell & { kind: 'context' | 'add' }) | null
  /** Set on hunk-boundary rows: the @@ header text. */
  gap?: string
}

/** Align unified rows into two columns: context lines pair with themselves,
 * consecutive del/add runs pair index-by-index (classic split view). */
export function splitRows(rows: UnifiedRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.kind === 'gap') {
      out.push({ left: null, right: null, gap: r.text })
      i++
      continue
    }
    if (r.kind === 'context') {
      out.push({
        left: { kind: 'context', lineNo: r.oldNo as number, text: r.text },
        right: { kind: 'context', lineNo: r.newNo as number, text: r.text },
      })
      i++
      continue
    }
    const dels: UnifiedRow[] = []
    const adds: UnifiedRow[] = []
    while (i < rows.length && rows[i].kind === 'del') dels.push(rows[i++])
    while (i < rows.length && rows[i].kind === 'add') adds.push(rows[i++])
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) {
      out.push({
        left:
          k < dels.length
            ? { kind: 'del', lineNo: dels[k].oldNo as number, text: dels[k].text }
            : null,
        right:
          k < adds.length
            ? { kind: 'add', lineNo: adds[k].newNo as number, text: adds[k].text }
            : null,
      })
    }
  }
  return out
}

/* ==== intraline (word-level) emphasis ==================================== */

export type EmphRange = [number, number]

/**
 * Emphasis ranges for a del/add line pair: strip the common prefix and
 * suffix, emphasize what actually changed. Returns null when the whole
 * line changed (emphasis would just repaint the row) or nothing did.
 */
export function intraline(a: string, b: string): { a: EmphRange; b: EmphRange } | null {
  if (a === b) return null
  let p = 0
  const max = Math.min(a.length, b.length)
  while (p < max && a[p] === b[p]) p++
  let sa = a.length
  let sb = b.length
  while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) {
    sa--
    sb--
  }
  // Never split a surrogate pair: snap boundaries outward to code points.
  const isHigh = (str: string, i: number): boolean =>
    (str.charCodeAt(i) & 0xfc00) === 0xd800
  if (p > 0 && isHigh(a, p - 1)) p--
  if (sa < a.length && sa > 0 && isHigh(a, sa - 1)) sa++
  if (sb < b.length && sb > 0 && isHigh(b, sb - 1)) sb++
  // Whitespace-only common ground (indentation) → the pair is a rewrite,
  // not an edit; emphasizing everything after the indent is just noise.
  const common = a.slice(0, p) + a.slice(Math.max(sa, p))
  if (common.trim() === '') return null
  return { a: [p, Math.max(sa, p)], b: [p, Math.max(sb, p)] }
}

/**
 * Pair del/add runs of a unified row list index-by-index (the same pairing
 * splitRows uses) and compute each paired row's own emphasis range.
 */
export function emphasisRanges(rows: UnifiedRow[]): Map<number, EmphRange> {
  const out = new Map<number, EmphRange>()
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind !== 'del') {
      i++
      continue
    }
    const dels: number[] = []
    while (i < rows.length && rows[i].kind === 'del') dels.push(i++)
    const adds: number[] = []
    while (i < rows.length && rows[i].kind === 'add') adds.push(i++)
    const n = Math.min(dels.length, adds.length)
    for (let k = 0; k < n; k++) {
      const e = intraline(rows[dels[k]].text, rows[adds[k]].text)
      if (e) {
        out.set(dels[k], e.a)
        out.set(adds[k], e.b)
      }
    }
  }
  return out
}

/* ==== verbatim hunk extraction (index surgery) =========================== */

export interface FileHunkPatches {
  path: string
  /** Full single-hunk patches: file header + one @@ block, verbatim. */
  patches: string[]
}

/**
 * Split raw `git diff` output into per-hunk patches that `git apply` accepts.
 * Text is kept verbatim (headers included) — re-serialization would corrupt
 * `\ No newline` markers and mode lines.
 */
export function extractHunkPatches(raw: string): FileHunkPatches[] {
  const out: FileHunkPatches[] = []
  const lines = raw.split('\n')
  let header: string[] = []
  let hunk: string[] = []
  let path = ''
  let sawHunk = false

  const flushHunk = (): void => {
    while (hunk.length > 0 && hunk[hunk.length - 1] === '') hunk.pop()
    if (hunk.length > 0 && path !== '') {
      const entry = out.find((f) => f.path === path)
      const patch = [...header, ...hunk].join('\n') + '\n'
      if (entry) entry.patches.push(patch)
      else out.push({ path, patches: [patch] })
    }
    hunk = []
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushHunk()
      header = [line]
      sawHunk = false
      const idx = line.lastIndexOf(' b/')
      path = idx >= 0 ? line.slice(idx + 3) : ''
      continue
    }
    if (line.startsWith('@@')) {
      flushHunk()
      sawHunk = true
      hunk = [line]
      continue
    }
    if (!sawHunk) {
      // index/mode/---/+++ metadata belongs to the reusable header.
      if (line !== '') header.push(line)
      if (line.startsWith('+++ b/')) path = line.slice(6)
      continue
    }
    hunk.push(line)
  }
  flushHunk()
  return out
}
