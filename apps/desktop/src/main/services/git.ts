import type { GitLogEntry, GitStatusSummary } from '../../shared/ipc'
import type { Result } from '../../shared/result'
import { err, ok } from '../../shared/result'
import type { Exec } from './exec'

/** Parse `git status --porcelain=v2 --branch -z` output. Exported pure for tests. */
export function parseStatusV2(raw: string): GitStatusSummary {
  const summary: GitStatusSummary = {
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
  }
  for (const record of raw.split('\0')) {
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
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      // "1 XY sub mH mI mW hH hI path" — path is the 9th field onward.
      const parts = record.split(' ')
      summary.entries.push({ code: parts[1] ?? '??', path: parts.slice(8).join(' ') })
    } else if (record.startsWith('? ')) {
      summary.entries.push({ code: '??', path: record.slice(2) })
    }
  }
  return summary
}

const LOG_FORMAT = '%H%x1f%s%x1f%an%x1f%ae%x1f%ct%x1f%(trailers:key=Isomer-Change,valueonly,separator=)'

/** Parse the %x1f-separated log format above. Exported pure for tests. */
export function parseLog(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const [sha, title, authorName, authorEmail, ts, changeId] = line.split('\x1f')
    if (!sha || !title) continue
    entries.push({
      sha,
      title,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      timestamp: Number(ts ?? 0),
      changeId: changeId ? changeId.trim() || null : null,
    })
  }
  return entries
}

export class GitService {
  constructor(private exec: Exec) {}

  async status(cwd: string): Promise<Result<GitStatusSummary>> {
    const r = await this.exec('git', ['status', '--porcelain=v2', '--branch', '-z'], { cwd })
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git status failed' })
    }
    return ok(parseStatusV2(r.stdout))
  }

  async log(cwd: string, limit: number): Promise<Result<GitLogEntry[]>> {
    const r = await this.exec(
      'git',
      ['log', `--max-count=${limit}`, `--format=${LOG_FORMAT}`],
      { cwd },
    )
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || 'git log failed' })
    }
    return ok(parseLog(r.stdout))
  }

  async isRepository(cwd: string): Promise<boolean> {
    const r = await this.exec('git', ['rev-parse', '--git-dir'], { cwd })
    return r.code === 0
  }
}
