import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IsmDetection } from '../../shared/ipc'
import type { Result } from '../../shared/result'
import { err, ok } from '../../shared/result'
import type { Exec } from './exec'

/**
 * Thin adapter over the ism CLI. stdout is JSON per the agent contract;
 * failures carry `{ok:false, errors:[{code,message,hint}]}` which we map
 * onto the app's uniform Result. No business logic lives here — the CLI
 * is the single source of truth (design D23).
 */
export class IsmService {
  constructor(
    private exec: Exec,
    private binary: () => string,
  ) {}

  /** Last successful detection — GUI-launched apps inherit a minimal PATH,
   * so a bare `ism` spawn can fail while the binary sits in ~/.cargo/bin. */
  private detected: IsmDetection | null = null

  /** Where ism actually is: the settings override first, then PATH, then
   * the usual install spots — so a default install needs zero config. */
  async detect(): Promise<IsmDetection | null> {
    const configured = this.binary()
    const candidates: { path: string; source: IsmDetection['source'] }[] = [
      ...(configured ? [{ path: configured, source: 'settings' as const }] : []),
      { path: 'ism', source: 'path' as const },
      { path: join(homedir(), '.cargo', 'bin', 'ism'), source: 'common' as const },
      { path: '/opt/homebrew/bin/ism', source: 'common' as const },
      { path: '/usr/local/bin/ism', source: 'common' as const },
    ]
    for (const c of candidates) {
      try {
        const r = await this.exec(c.path, ['--version'], { cwd: homedir(), timeoutMs: 5_000 })
        if (r.code === 0) {
          this.detected = {
            path: c.path,
            version: r.stdout.trim().replace(/^ism\s*/, ''),
            source: c.source,
          }
          return this.detected
        }
      } catch {
        /* try the next candidate */
      }
    }
    this.detected = null
    return null
  }

  async run<T>(cwd: string, args: string[]): Promise<Result<T>> {
    const bin = this.binary() || this.detected?.path || 'ism'
    let r
    try {
      r = await this.exec(bin, args, { cwd, timeoutMs: 60_000 })
    } catch (e) {
      return err({
        code: 'ISM_MISSING',
        message: `cannot run ${bin}: ${e instanceof Error ? e.message : String(e)}`,
        hint: 'install ism or set its path in Settings',
      })
    }
    if (r.code === 0) {
      try {
        return ok(JSON.parse(r.stdout) as T)
      } catch {
        return err({ code: 'ISM_BAD_JSON', message: 'ism produced non-JSON output' })
      }
    }
    try {
      const report = JSON.parse(r.stdout) as {
        errors?: { code: string; message: string; hint?: string }[]
      }
      const first = report.errors?.[0]
      if (first) return err({ code: first.code, message: first.message, hint: first.hint })
    } catch {
      /* fall through to the generic error */
    }
    return err({ code: 'ISM', message: r.stderr.trim() || `ism exited with ${r.code}` })
  }
}
