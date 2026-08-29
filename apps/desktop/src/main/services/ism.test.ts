import { describe, expect, it } from 'vitest'
import type { Exec } from './exec'
import { IsmService } from './ism'

const fakeExec =
  (result: { code: number; stdout: string; stderr?: string } | Error): Exec =>
  async () => {
    if (result instanceof Error) throw result
    return { code: result.code, stdout: result.stdout, stderr: result.stderr ?? '' }
  }

describe('IsmService', () => {
  it('parses successful JSON output', async () => {
    const svc = new IsmService(fakeExec({ code: 0, stdout: '{"ok":true}' }), () => '')
    expect(await svc.run('/repo', ['verify'])).toEqual({ ok: true, data: { ok: true } })
  })

  it('maps structured ism errors onto Result (stable codes survive)', async () => {
    const stdout = JSON.stringify({
      ok: false,
      errors: [{ code: 'E010', message: 'plan is stale', hint: 're-run inspect' }],
    })
    const svc = new IsmService(fakeExec({ code: 3, stdout }), () => '')
    const r = await svc.run('/repo', ['check', 'plan.json'])
    expect(r).toEqual({
      ok: false,
      error: { code: 'E010', message: 'plan is stale', hint: 're-run inspect' },
    })
  })

  it('reports a missing binary as ISM_MISSING with a settings hint', async () => {
    const svc = new IsmService(fakeExec(new Error('ENOENT')), () => '/nope/ism')
    const r = await svc.run('/repo', ['status'])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('ISM_MISSING')
      expect(r.error.hint).toContain('Settings')
    }
  })

  it('reports non-JSON stdout as ISM_BAD_JSON', async () => {
    const svc = new IsmService(fakeExec({ code: 0, stdout: 'not json' }), () => '')
    const r = await svc.run('/repo', ['status'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ISM_BAD_JSON')
  })

  it('falls back to stderr for unstructured failures', async () => {
    const svc = new IsmService(fakeExec({ code: 9, stdout: '', stderr: 'boom' }), () => '')
    const r = await svc.run('/repo', ['status'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('boom')
  })
})
