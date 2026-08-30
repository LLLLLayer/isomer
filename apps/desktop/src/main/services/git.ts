import type { CommitInfo, GitLogEntry, GitRefs, GitStatusSummary } from '../../shared/ipc'
import type { Result } from '../../shared/result'
import { err, ok } from '../../shared/result'
import type { Exec } from './exec'

/**
 * Parse `git status --porcelain=v2 --branch -z` output.
 * Record shapes (git-status(1)): ordinary `1` has 8 fields before the path,
 * rename/copy `2` has 9 (the extra `<X><score>`) and its ORIGINAL path
 * arrives as the following NUL-terminated record, unmerged `u` has 10.
 * Exported pure for tests.
 */
export function parseStatusV2(raw: string): GitStatusSummary {
  const summary: GitStatusSummary = {
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
  }
  const records = raw.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record === '') continue
    if (record.startsWith('# branch.head ')) {
      summary.branch = record.slice('# branch.head '.length)
    } else if (record.startsWith('# branch.upstream ')) {
      summary.upstream = record.slice('# branch.upstream '.length)
    } else if (record.startsWith('# branch.ab ')) {
      const m = record.match(/\+(\d+) -(\d+)/)
      if (m) {
        summary.ahead = Number(m[1])
        summary.behind = Number(m[2])
      }
    } else if (record.startsWith('1 ')) {
      const parts = record.split(' ')
      summary.entries.push({ code: parts[1] ?? '??', path: parts.slice(8).join(' ') })
    } else if (record.startsWith('2 ')) {
      const parts = record.split(' ')
      // Consume the continuation record so a filename like "1 x" is never
      // misread as a new entry.
      const origPath = records[++i] ?? ''
      summary.entries.push({
        code: parts[1] ?? '??',
        path: parts.slice(9).join(' '),
        origPath,
      })
    } else if (record.startsWith('u ')) {
      const parts = record.split(' ')
      summary.entries.push({ code: parts[1] ?? 'UU', path: parts.slice(10).join(' ') })
    } else if (record.startsWith('? ')) {
      summary.entries.push({ code: '??', path: record.slice(2) })
    }
  }
  return summary
}

const LOG_FORMAT =
  '%H%x1f%s%x1f%an%x1f%ae%x1f%ct%x1f%(trailers:key=Isomer-Change,valueonly,separator=%x2C,unfold)'

/** Parse the %x1f-separated log format above. Exported pure for tests. */
export function parseLog(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const [sha, title, authorName, authorEmail, ts, changeId] = line.split('\x1f')
    if (!sha || !title) continue
    // Multiple trailers on one commit mean a squash of changes (ism's
    // "merged" anomaly) — there is no single identity to display.
    const trailerValues = (changeId ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '')
    entries.push({
      sha,
      title,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      timestamp: Number(ts ?? 0),
      changeId: trailerValues.length === 1 ? trailerValues[0] : null,
    })
  }
  return entries
}

export class GitService {
  constructor(private exec: Exec) {}

  /** Spawn git; a spawn failure (missing binary, deleted cwd) becomes a
   * Result error instead of an unhandled rejection crossing IPC. */
  private async run(cwd: string, args: string[]) {
    try {
      // --no-optional-locks: reads must never touch .git (index stat cache),
      // or the repo watcher would loop on our own refreshes.
      return await this.exec('git', ['--no-optional-locks', ...args], { cwd })
    } catch (e) {
      return {
        code: -1,
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e),
      }
    }
  }

  async status(cwd: string): Promise<Result<GitStatusSummary>> {
    const r = await this.run(cwd, ['status', '--porcelain=v2', '--branch', '-z'])
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git status failed' })
    }
    return ok(parseStatusV2(r.stdout))
  }

  async log(cwd: string, limit: number): Promise<Result<GitLogEntry[]>> {
    const r = await this.run(cwd, ['log', `--max-count=${limit}`, `--format=${LOG_FORMAT}`])
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git log failed' })
    }
    return ok(parseLog(r.stdout))
  }

  async isRepository(cwd: string): Promise<boolean> {
    const r = await this.run(cwd, ['rev-parse', '--git-dir'])
    return r.code === 0
  }

  async refs(cwd: string): Promise<Result<GitRefs>> {
    const [head, refs, stashes, subs] = await Promise.all([
      this.run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      this.run(cwd, [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)',
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ]),
      this.run(cwd, ['stash', 'list']),
      this.run(cwd, ['submodule', 'status']),
    ])
    if (refs.code !== 0) {
      return err({ code: 'GIT', message: refs.stderr.trim() || 'for-each-ref failed' })
    }
    const out: GitRefs = {
      current: head.code === 0 ? head.stdout.trim() : '',
      locals: {},
      remotes: {},
      tags: {},
      stashes:
        stashes.code === 0 ? stashes.stdout.split('\n').filter((l) => l !== '').length : 0,
      submodules:
        subs.code === 0
          ? subs.stdout
              .split('\n')
              .filter((l) => l.trim() !== '')
              .map((l) => l.trim().split(/\s+/)[1] ?? '')
              .filter((s) => s !== '')
          : [],
    }
    for (const line of refs.stdout.split('\n')) {
      const [ref, sha] = line.split('\0')
      if (!ref || !sha) continue
      if (ref.startsWith('refs/heads/')) out.locals[ref.slice('refs/heads/'.length)] = sha
      else if (ref.startsWith('refs/remotes/')) out.remotes[ref.slice('refs/remotes/'.length)] = sha
      else if (ref.startsWith('refs/tags/')) out.tags[ref.slice('refs/tags/'.length)] = sha
    }
    return ok(out)
  }

  async stage(cwd: string, paths: string[]): Promise<Result<void>> {
    const r = await this.run(cwd, ['add', '--', ...paths])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git add failed' })
    return ok(undefined)
  }

  async unstage(cwd: string, paths: string[]): Promise<Result<void>> {
    const r = await this.run(cwd, ['restore', '--staged', '--', ...paths])
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git restore --staged failed' })
    }
    return ok(undefined)
  }

  /** Commit the staged set, Fork-style: subject + optional description. */
  async commit(
    cwd: string,
    subject: string,
    description: string,
    amend: boolean,
  ): Promise<Result<string>> {
    const message = description.trim() === '' ? subject : `${subject}\n\n${description}`
    const args = ['commit', '-m', message, ...(amend ? ['--amend'] : [])]
    const r = await this.run(cwd, args)
    if (r.code !== 0) {
      return err({ code: 'GIT', message: (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-2).join('\n') })
    }
    const sha = await this.run(cwd, ['rev-parse', 'HEAD'])
    return ok(sha.stdout.trim())
  }

  async stash(cwd: string): Promise<Result<string>> {
    const r = await this.run(cwd, ['stash', 'push', '--include-untracked'])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git stash failed' })
    return ok(r.stdout.trim().split('\n').slice(-1)[0] ?? '')
  }

  async commitInfo(cwd: string, sha: string): Promise<Result<CommitInfo>> {
    const r = await this.run(cwd, ['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b', sha])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git show failed' })
    const [h, an, ae, at, subj, body] = r.stdout.split('\x1f')
    return ok({
      sha: (h ?? '').trim(),
      authorName: an ?? '',
      authorEmail: ae ?? '',
      authorDate: Number(at ?? 0),
      subject: subj ?? '',
      body: (body ?? '').trim(),
    })
  }

  async stagedDiff(cwd: string, path: string): Promise<Result<string>> {
    const r = await this.run(cwd, ['diff', '--cached', '--no-color', '--', path])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git diff --cached failed' })
    return ok(r.stdout)
  }

  /** Unified diff of a working-tree file against HEAD; untracked files are
   * rendered via --no-index against /dev/null (exit 1 means "differs"). */
  async workingDiff(cwd: string, path: string, untracked: boolean): Promise<Result<string>> {
    const args = untracked
      ? ['diff', '--no-color', '--no-index', '--', '/dev/null', path]
      : ['diff', '--no-color', 'HEAD', '--', path]
    const r = await this.run(cwd, args)
    if (r.code !== 0 && !(untracked && r.code === 1)) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git diff failed' })
    }
    return ok(r.stdout)
  }

  async commitDiff(cwd: string, sha: string): Promise<Result<string>> {
    const r = await this.run(cwd, [
      'show',
      sha,
      '--format=',
      '--patch',
      '--no-color',
      '--no-renames',
    ])
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git show failed' })
    }
    return ok(r.stdout)
  }

  /** Network verbs report their stderr tail (git talks progress on stderr). */
  private async network(cwd: string, args: string[]): Promise<Result<string>> {
    const r = await this.run(cwd, args)
    const tail = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-3).join('\n')
    if (r.code !== 0) {
      return err({ code: 'GIT', message: tail || `git ${args[0]} failed` })
    }
    return ok(tail)
  }

  fetch(cwd: string): Promise<Result<string>> {
    return this.network(cwd, ['fetch', '--prune'])
  }

  pull(cwd: string): Promise<Result<string>> {
    return this.network(cwd, ['pull', '--ff-only'])
  }

  push(cwd: string): Promise<Result<string>> {
    return this.network(cwd, ['push'])
  }
}
