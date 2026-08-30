/** Parsing and resolving git conflict markers, pure and testable.
 * Handles both merge styles: the default (ours/theirs) and diff3 (with a
 * `|||||||` common-ancestor section). The editor works on these segments;
 * git only sees the final resolved text. */

export interface TextSegment {
  kind: 'text'
  lines: string[]
}

export interface ConflictSegment {
  kind: 'conflict'
  ours: string[]
  /** Common ancestor lines when merge.conflictStyle=diff3, else null. */
  base: string[] | null
  theirs: string[]
  oursLabel: string
  theirsLabel: string
}

export type Segment = TextSegment | ConflictSegment

export interface ParsedConflicts {
  segments: Segment[]
  /** Number of conflict segments. */
  conflicts: number
  trailingNewline: boolean
}

// \r? — CRLF checkouts end marker lines with \r; labels stay clean
// because `.` cannot match \r. Content lines keep their \r, so joining
// with \n reproduces the original CRLF bytes.
const OURS = /^<{7}(?: (.*))?\r?$/
const BASE = /^\|{7}(?: (.*))?\r?$/
const SEP = /^={7}\r?$/
const THEIRS = /^>{7}(?: (.*))?\r?$/

/** Returns null when the text contains no complete conflict block (either
 * clean or malformed — in both cases the editor has nothing to do). */
export function parseConflicts(text: string): ParsedConflicts | null {
  const raw = text.split('\n')
  const trailingNewline = raw.length > 0 && raw[raw.length - 1] === ''
  const lines = trailingNewline ? raw.slice(0, -1) : raw

  const segments: Segment[] = []
  let plain: string[] = []
  let conflicts = 0
  let i = 0

  const flush = (): void => {
    if (plain.length > 0) {
      segments.push({ kind: 'text', lines: plain })
      plain = []
    }
  }

  while (i < lines.length) {
    const open = OURS.exec(lines[i])
    if (!open) {
      plain.push(lines[i])
      i += 1
      continue
    }
    // Scan ahead for a complete block; if malformed, keep lines verbatim.
    const ours: string[] = []
    const base: string[] = []
    const theirs: string[] = []
    let sawBase = false
    let mode: 'ours' | 'base' | 'theirs' = 'ours'
    let close: RegExpExecArray | null = null
    let j = i + 1
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (mode !== 'theirs' && BASE.test(l)) {
        sawBase = true
        mode = 'base'
        continue
      }
      if (mode !== 'theirs' && SEP.test(l)) {
        mode = 'theirs'
        continue
      }
      const end = THEIRS.exec(l)
      if (mode === 'theirs' && end) {
        close = end
        break
      }
      if (mode === 'ours') ours.push(l)
      else if (mode === 'base') base.push(l)
      else theirs.push(l)
    }
    if (!close) {
      // Unterminated block: treat the opener as plain text and move on.
      plain.push(lines[i])
      i += 1
      continue
    }
    flush()
    segments.push({
      kind: 'conflict',
      ours,
      base: sawBase ? base : null,
      theirs,
      oursLabel: open[1] ?? '',
      theirsLabel: close[1] ?? '',
    })
    conflicts += 1
    i = j + 1
  }
  flush()

  if (conflicts === 0) return null
  return { segments, conflicts, trailingNewline }
}

export type Choice =
  | { kind: 'ours' }
  | { kind: 'theirs' }
  | { kind: 'both' }
  | { kind: 'custom'; lines: string[] }

/** Lines a choice yields for one conflict segment. */
export function choiceLines(seg: ConflictSegment, choice: Choice): string[] {
  switch (choice.kind) {
    case 'ours':
      return seg.ours
    case 'theirs':
      return seg.theirs
    case 'both':
      return [...seg.ours, ...seg.theirs]
    case 'custom':
      return choice.lines
  }
}

/** Reassemble the file. Returns null while any conflict is still unchosen —
 * the caller must not let a half-resolved file reach `git add`.
 *
 * `eof` carries whether each side's index blob ends with a newline. When
 * the file ENDS in a conflict, git's merged output always ends with \n
 * (the closing marker line), so trusting `trailingNewline` alone would
 * append a phantom newline that neither parent had. */
export function resolveText(
  parsed: ParsedConflicts,
  choices: (Choice | null)[],
  eof?: { ours: boolean | null; theirs: boolean | null },
): string | null {
  const out: string[] = []
  let c = 0
  let lastChoice: Choice | null = null
  let endsInConflict = false
  for (const seg of parsed.segments) {
    if (seg.kind === 'text') {
      out.push(...seg.lines)
      endsInConflict = false
      continue
    }
    const choice = choices[c]
    c += 1
    if (!choice) return null
    out.push(...choiceLines(seg, choice))
    lastChoice = choice
    endsInConflict = true
  }
  let trailing = parsed.trailingNewline
  if (endsInConflict && eof && lastChoice && lastChoice.kind !== 'custom') {
    const side = lastChoice.kind === 'ours' ? eof.ours : eof.theirs
    if (side !== null) trailing = side
  }
  return out.join('\n') + (trailing ? '\n' : '')
}
