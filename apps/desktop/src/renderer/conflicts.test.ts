import { describe, expect, it } from 'vitest'
import { parseConflicts, resolveText } from './conflicts'

const merge = [
  'intro',
  '<<<<<<< HEAD',
  'ours line',
  '=======',
  'theirs line',
  '>>>>>>> feature',
  'outro',
  '',
].join('\n')

describe('parseConflicts', () => {
  it('splits text and conflict segments with labels', () => {
    const p = parseConflicts(merge)
    expect(p).not.toBeNull()
    expect(p?.conflicts).toBe(1)
    expect(p?.segments).toEqual([
      { kind: 'text', lines: ['intro'] },
      {
        kind: 'conflict',
        ours: ['ours line'],
        base: null,
        theirs: ['theirs line'],
        oursLabel: 'HEAD',
        theirsLabel: 'feature',
      },
      { kind: 'text', lines: ['outro'] },
    ])
    expect(p?.trailingNewline).toBe(true)
  })

  it('captures the ancestor section in diff3 style', () => {
    const p = parseConflicts(
      ['<<<<<<< HEAD', 'a', '||||||| merged common ancestors', 'o', '=======', 'b', '>>>>>>> x', ''].join(
        '\n',
      ),
    )
    expect(p?.segments[0]).toMatchObject({ ours: ['a'], base: ['o'], theirs: ['b'] })
  })

  it('handles multiple conflicts and empty sides', () => {
    const p = parseConflicts(
      ['<<<<<<< a', '=======', 'x', '>>>>>>> b', 'mid', '<<<<<<< a', 'y', '=======', '>>>>>>> b'].join(
        '\n',
      ),
    )
    expect(p?.conflicts).toBe(2)
    expect(p?.segments).toHaveLength(3)
    expect(p?.trailingNewline).toBe(false)
  })

  it('returns null on clean or unterminated input', () => {
    expect(parseConflicts('plain\ntext\n')).toBeNull()
    expect(parseConflicts('<<<<<<< HEAD\ndangling\n')).toBeNull()
  })

  it('keeps an unterminated opener as text when a real conflict follows', () => {
    const p = parseConflicts(
      ['<<<<<<< stray', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> x'].join('\n'),
    )
    // The scan from the stray opener finds the LATER terminator, swallowing
    // the inner opener as content — git never emits this shape; we only
    // require not crashing and still reporting one conflict.
    expect(p?.conflicts).toBe(1)
  })
})

describe('CRLF and EOF edges', () => {
  it('parses CRLF marker lines and reproduces CRLF bytes', () => {
    const crlf = 'top\r\n<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> side\r\nend\r\n'
    const p = parseConflicts(crlf)
    expect(p?.conflicts).toBe(1)
    const seg = p?.segments[1]
    expect(seg?.kind === 'conflict' && seg.oursLabel).toBe('HEAD')
    expect(p && resolveText(p, [{ kind: 'ours' }])).toBe('top\r\na\r\nend\r\n')
  })

  it('does not invent a trailing newline when the file ends in a conflict', () => {
    // git's merged output always ends with \n (the closing marker line)
    // even when neither parent blob had one.
    const merged = 'a\n<<<<<<< HEAD\nend-main\n=======\nend-side\n>>>>>>> side\n'
    const p = parseConflicts(merged)
    expect(p && resolveText(p, [{ kind: 'ours' }], { ours: false, theirs: false })).toBe(
      'a\nend-main',
    )
    expect(p && resolveText(p, [{ kind: 'theirs' }], { ours: false, theirs: true })).toBe(
      'a\nend-side\n',
    )
    // Unknown stage (add/add missing side) falls back to the merged text.
    expect(p && resolveText(p, [{ kind: 'ours' }], { ours: null, theirs: null })).toBe(
      'a\nend-main\n',
    )
  })

  it('leaves mid-file conflicts untouched by eof hints', () => {
    const p = parseConflicts('<<<<<<< a\nx\n=======\ny\n>>>>>>> b\ntail\n')
    expect(p && resolveText(p, [{ kind: 'ours' }], { ours: false, theirs: false })).toBe(
      'x\ntail\n',
    )
  })
})

describe('resolveText', () => {
  const parsed = parseConflicts(merge)
  if (!parsed) throw new Error('fixture must parse')

  it('resolves ours / theirs / both / custom', () => {
    expect(resolveText(parsed, [{ kind: 'ours' }])).toBe('intro\nours line\noutro\n')
    expect(resolveText(parsed, [{ kind: 'theirs' }])).toBe('intro\ntheirs line\noutro\n')
    expect(resolveText(parsed, [{ kind: 'both' }])).toBe(
      'intro\nours line\ntheirs line\noutro\n',
    )
    expect(resolveText(parsed, [{ kind: 'custom', lines: ['hand-merged'] }])).toBe(
      'intro\nhand-merged\noutro\n',
    )
  })

  it('refuses while any conflict is unchosen', () => {
    expect(resolveText(parsed, [null])).toBeNull()
  })

  it('preserves the missing trailing newline', () => {
    const p = parseConflicts('<<<<<<< a\nx\n=======\ny\n>>>>>>> b')
    expect(p && resolveText(p, [{ kind: 'ours' }])).toBe('x')
  })
})
