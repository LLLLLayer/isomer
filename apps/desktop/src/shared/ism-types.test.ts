import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Comment, Snapshot } from './ism-types'

/**
 * Contract-drift guard: these fixtures are captured from the real `ism`
 * binary (see design D23 — the CLI JSON is the single contract). If ism's
 * serde shapes change, regenerate the fixtures and update ism-types.ts.
 */
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as T

describe('ism JSON contract fixtures', () => {
  it('snapshot parses into the mirrored Snapshot type', () => {
    const snap = fixture<Snapshot>('snapshot.json')
    expect(snap.snapshot_digest).toMatch(/^sha256:/)
    expect(snap.base).toMatch(/^[0-9a-f]{40}$/)
    expect(snap.head).toMatch(/^[0-9a-f]{40}$/)
    expect(snap.commits.length).toBeGreaterThan(0)
    for (const c of snap.commits) {
      expect(typeof c.sha).toBe('string')
      expect(typeof c.title).toBe('string')
      expect(Array.isArray(c.hunks)).toBe(true)
      // After an apply, commits carry change ids in the i- alphabet.
      if (c.change_id !== null) expect(c.change_id).toMatch(/^i-[a-z2-7]{8}$/)
    }
    for (const h of snap.hunks) {
      expect(h.id).toContain('#')
      expect(['add', 'mod', 'del', 'file']).toContain(h.kind)
      expect(h.new_range).toHaveLength(2)
    }
    for (const [dependent, dependency] of snap.deps) {
      expect(typeof dependent).toBe('string')
      expect(typeof dependency).toBe('string')
    }
  })

  it('comments parse into the mirrored Comment type', () => {
    const comments = fixture<Comment[]>('comments.json')
    expect(comments.length).toBeGreaterThan(0)
    for (const c of comments) {
      expect(c.id).toMatch(/^c-[a-z2-7]{8}$/)
      expect(c.change).toMatch(/^i-[a-z2-7]{8}$/)
      expect(typeof c.body).toBe('string')
      expect(typeof c.resolved).toBe('boolean')
    }
  })
})
