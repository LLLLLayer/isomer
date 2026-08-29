import { describe, expect, it } from 'vitest'
import { parseLog, parseStatusV2 } from './git'

describe('parseStatusV2', () => {
  it('reads branch header, ahead/behind, and entries', () => {
    const raw = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head feat',
      '# branch.upstream origin/feat',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc def src/app.py',
      '? scratch.txt',
    ].join('\0')
    const s = parseStatusV2(raw)
    expect(s.branch).toBe('feat')
    expect(s.upstream).toBe('origin/feat')
    expect(s.ahead).toBe(2)
    expect(s.behind).toBe(1)
    expect(s.entries).toEqual([
      { code: '.M', path: 'src/app.py' },
      { code: '??', path: 'scratch.txt' },
    ])
  })

  it('handles a clean detached state', () => {
    const s = parseStatusV2('# branch.oid abc\0# branch.head (detached)\0')
    expect(s.branch).toBe('(detached)')
    expect(s.upstream).toBeNull()
    expect(s.entries).toEqual([])
  })

  it('keeps paths containing spaces intact', () => {
    const raw = '1 .M N... 100644 100644 100644 abc def my dir/my file.txt'
    expect(parseStatusV2(raw).entries[0].path).toBe('my dir/my file.txt')
  })
})

describe('parseLog', () => {
  it('splits unit-separator fields and extracts change trailers', () => {
    const raw =
      'aaaa\x1fFix util\x1fAda\x1fada@example.com\x1f1700000000\x1fi-abcdefgh\n' +
      'bbbb\x1fwip\x1fBo\x1fbo@example.com\x1f1700000001\x1f\n'
    const log = parseLog(raw)
    expect(log).toHaveLength(2)
    expect(log[0]).toEqual({
      sha: 'aaaa',
      title: 'Fix util',
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: 1700000000,
      changeId: 'i-abcdefgh',
    })
    expect(log[1].changeId).toBeNull()
  })
})
