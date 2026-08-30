import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './components/QuickLaunch'

describe('fuzzyScore', () => {
  it('matches subsequences and rejects non-matches', () => {
    expect(fuzzyScore('lc', 'Local Changes')).toBeGreaterThan(0)
    expect(fuzzyScore('zzz', 'Local Changes')).toBe(-1)
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('prefers word-start matches over mid-word ones', () => {
    expect(fuzzyScore('st', 'Stack')).toBeGreaterThan(fuzzyScore('st', 'least'))
  })
})
