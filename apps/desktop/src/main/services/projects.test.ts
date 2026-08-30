import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from './projects'

let dir: string | null = null
const registry = (): ProjectRegistry => {
  dir = mkdtempSync(join(tmpdir(), 'ism-projects-'))
  return new ProjectRegistry(join(dir, 'projects.json'))
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('ProjectRegistry.update', () => {
  it('persists pin and group across reloads; empty group clears', () => {
    const r = registry()
    const a = r.add('/tmp/repo-a')
    r.update(a.id, { pinned: true, group: '  work ' })
    const reloaded = new ProjectRegistry(join(dir as string, 'projects.json'))
    const got = reloaded.get(a.id)
    expect(got?.pinned).toBe(true)
    expect(got?.group).toBe('work')
    reloaded.update(a.id, { group: '' })
    reloaded.update(a.id, { pinned: false })
    const again = new ProjectRegistry(join(dir as string, 'projects.json')).get(a.id)
    expect(again?.group).toBeUndefined()
    expect(again?.pinned).toBeUndefined()
  })

  it('touch bumps recency so "Recent" means recently opened', async () => {
    const r = registry()
    const a = r.add('/tmp/repo-a')
    const before = a.lastOpenedAt
    await new Promise((res) => setTimeout(res, 5))
    r.update(a.id, { touch: true })
    expect((r.get(a.id)?.lastOpenedAt ?? 0) > before).toBe(true)
  })

  it('ignores unknown ids without throwing', () => {
    const r = registry()
    expect(() => r.update('nope', { pinned: true })).not.toThrow()
  })
})
