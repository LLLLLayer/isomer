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

  /** The repo's default branch (PR chain anchor): origin/HEAD when set,
   * else whichever of origin/main | origin/master exists (origin/HEAD is
   * commonly unset after a plain `git remote add`). */
  async defaultBranch(cwd: string): Promise<string> {
    try {
      const r = await this.exec(
        'git',
        ['--no-optional-locks', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd, timeoutMs: 5_000 },
      )
      if (r.code === 0) {
        const name = r.stdout.trim().replace(/^origin\//, '')
        if (name) return name
      }
      for (const cand of ['main', 'master']) {
        const v = await this.exec(
          'git',
          ['--no-optional-locks', 'rev-parse', '--verify', '--quiet', `origin/${cand}`],
          { cwd, timeoutMs: 5_000 },
        )
        if (v.code === 0) return cand
      }
    } catch {
      /* fall through */
    }
    return 'main'
  }

  /** ALL open PRs, paginated — a stack PR beyond a fixed page cap would be
   * re-planned as `create` and wedge every subsequent run. 20 pages
   * (2000 PRs) is the sanity ceiling. */
  async openPrs(cwd: string): Promise<Result<PrRecord[]>> {
    try {
      const all: PrRecord[] = []
      for (let page = 1; page <= 20; page++) {
        const r = await this.exec(
          'gh',
          ['api', `repos/{owner}/{repo}/pulls?state=open&per_page=100&page=${page}`],
          { cwd, timeoutMs: 30_000 },
        )
        if (r.code !== 0) return err({ code: 'GH', message: r.stderr.trim() || 'gh api pulls failed' })
        const rows = JSON.parse(r.stdout) as {
          number: number
          head: { ref: string }
          base: { ref: string }
          body: string | null
        }[]
        all.push(
          ...rows.map((x) => ({
            number: x.number,
            headRefName: x.head.ref,
            baseRefName: x.base.ref,
            body: x.body ?? '',
          })),
        )
        if (rows.length < 100) break
      }
      return ok(all)
    } catch (e) {
      return err({ code: 'GH', message: e instanceof Error ? e.message : String(e) })
    }
  }

  /** stack/* branches are machine-owned mirrors of change commits; plain
   * force is intentional (their history rewrites on every re-apply).
   * Single-remote v1: pushes go to `origin`, matching where gh files the
   * PR for non-fork setups; triangular workflows are out of scope. */
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
      // REST, not `gh pr edit`: the latter also queries Projects (classic)
      // and fails hard on its deprecation notice with current gh builds.
      const payload = JSON.stringify({
        title: args.title,
        body: args.body,
        ...(args.retarget ? { base: args.retarget } : {}),
      })
      const r = await this.exec(
        'gh',
        ['api', '-X', 'PATCH', `repos/{owner}/{repo}/pulls/${number}`, '--input', '-'],
        { cwd, timeoutMs: 60_000, stdin: payload },
      )
      if (r.code !== 0) return err({ code: 'GH', message: r.stderr.trim() || 'gh pr edit failed' })
      return ok(undefined)
    } catch (e) {
      return err({ code: 'GH', message: e instanceof Error ? e.message : String(e) })
    }
  }
}
