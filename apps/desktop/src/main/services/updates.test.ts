import { describe, expect, it } from 'vitest'
import { compareVersions, parseLatestRelease } from './updates'

describe('compareVersions', () => {
  it('orders dotted versions numerically, v-prefix agnostic', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
  })
})

describe('parseLatestRelease', () => {
  const rel = {
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/LLLLLayer/isomer/releases/tag/v0.2.0',
    body: 'notes',
  }

  it('offers an update only when the release is newer', () => {
    expect(parseLatestRelease(rel, '0.1.0')).toEqual({
      version: '0.2.0',
      url: rel.html_url,
      notes: 'notes',
    })
    expect(parseLatestRelease(rel, '0.2.0')).toBeNull()
    expect(parseLatestRelease(rel, '0.3.0')).toBeNull()
  })

  it('ignores drafts, prereleases, and malformed payloads', () => {
    expect(parseLatestRelease({ ...rel, draft: true }, '0.1.0')).toBeNull()
    expect(parseLatestRelease({ ...rel, prerelease: true }, '0.1.0')).toBeNull()
    expect(parseLatestRelease(null, '0.1.0')).toBeNull()
    expect(parseLatestRelease({}, '0.1.0')).toBeNull()
  })
})
