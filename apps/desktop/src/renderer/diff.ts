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
    if (line.startsWith('+++ ')) {
      const p = line.slice(4)
      if (p.startsWith('b/')) cur.path = p.slice(2)
      continue
    }
    if (line.startsWith('--- ')) {
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
      if (cur.rows.length > 0) {
        cur.rows.push({ kind: 'gap', oldNo: null, newNo: null, text: '' })
      }
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
}

/** Align unified rows into two columns: context lines pair with themselves,
 * consecutive del/add runs pair index-by-index (classic split view). */
export function splitRows(rows: UnifiedRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.kind === 'gap') {
      out.push({ left: null, right: null })
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
