import type { GitLogEntry, GitStatusSummary } from '../../shared/ipc'
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
      return await this.exec('git', args, { cwd })
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
}
