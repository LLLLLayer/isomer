import type { Result } from '../../shared/result'
import { err, ok } from '../../shared/result'
import type { Exec } from './exec'
import type { PrRecord } from './stackplan'

/** Executes a stack plan against GitHub through the user's own `gh` CLI.
 * The app carries no tokens and registers no OAuth application; identity
 * and consent live entirely with gh (same guest-not-landlord stance as
 * the rest of the product). */
export class StackService {
  constructor(private exec: Exec) {}

  async ghState(cwd: string): Promise<'ok' | 'missing' | 'unauthenticated'> {
    try {
      const v = await this.exec('gh', ['--version'], { cwd, timeoutMs: 5_000 })
      if (v.code !== 0) return 'missing'
    } catch {
      return 'missing'
    }
    try {
      const a = await this.exec('gh', ['auth', 'status'], { cwd, timeoutMs: 15_000 })
      return a.code === 0 ? 'ok' : 'unauthenticated'
    } catch {
      return 'unauthenticated'
    }
  }

  /** The repo's default branch (PR chain anchor): origin/HEAD, else main. */
  async defaultBranch(cwd: string): Promise<string> {
    try {
      const r = await this.exec(
        'git',
        ['--no-optional-locks', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd, timeoutMs: 5_000 },
      )
      if (r.code === 0) return r.stdout.trim().replace(/^origin\//, '') || 'main'
    } catch {
      /* fall through */
    }
    return 'main'
  }

  async openPrs(cwd: string): Promise<Result<PrRecord[]>> {
    try {
      const r = await this.exec(
        'gh',
        ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName,baseRefName,body'],
        { cwd, timeoutMs: 30_000 },
      )
      if (r.code !== 0) return err({ code: 'GH', message: r.stderr.trim() || 'gh pr list failed' })
      return ok(JSON.parse(r.stdout) as PrRecord[])
    } catch (e) {
      return err({ code: 'GH', message: e instanceof Error ? e.message : String(e) })
    }
  }

  /** stack/* branches are machine-owned mirrors of change commits; plain
   * force is intentional (their history rewrites on every re-apply). */
  async pushBranch(cwd: string, sha: string, branch: string): Promise<Result<void>> {
    try {
      const r = await this.exec(
        'git',
        ['--no-optional-locks', 'push', '--force', 'origin', `${sha}:refs/heads/${branch}`],
        { cwd, timeoutMs: 120_000 },
      )
      if (r.code !== 0) {
        return err({ code: 'GIT', message: r.stderr.trim().split('\n').slice(-2).join('\n') })
      }
      return ok(undefined)
    } catch (e) {
      return err({ code: 'GIT', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async createPr(
    cwd: string,
    args: { head: string; base: string; title: string; body: string },
  ): Promise<Result<{ number: number | null; url: string }>> {
    try {
      const r = await this.exec(
        'gh',
        ['pr', 'create', '--head', args.head, '--base', args.base, '--title', args.title, '--body-file', '-'],
        { cwd, timeoutMs: 60_000, stdin: args.body },
      )
      if (r.code !== 0) return err({ code: 'GH', message: r.stderr.trim() || 'gh pr create failed' })
      const url = r.stdout.trim().split('\n').pop() ?? ''
      const number = /\/pull\/(\d+)/.exec(url)?.[1]
      return ok({ number: number ? Number(number) : null, url })
    } catch (e) {
      return err({ code: 'GH', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async editPr(
    cwd: string,
    number: number,
    args: { title: string; body: string; retarget: string | null },
  ): Promise<Result<void>> {
    try {
      const cli = [
        'pr',
        'edit',
        String(number),
        '--title',
        args.title,
        '--body-file',
        '-',
        ...(args.retarget ? ['--base', args.retarget] : []),
      ]
      const r = await this.exec('gh', cli, { cwd, timeoutMs: 60_000, stdin: args.body })
      if (r.code !== 0) return err({ code: 'GH', message: r.stderr.trim() || 'gh pr edit failed' })
      return ok(undefined)
    } catch (e) {
      return err({ code: 'GH', message: e instanceof Error ? e.message : String(e) })
    }
  }
}
