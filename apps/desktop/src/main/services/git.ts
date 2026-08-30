import type {
  BlameLine,
  BranchCompare,
  CommitInfo,
  GitLogEntry,
  GitRefs,
  GitStatusSummary,
  ReflogEntry,
  StashEntry,
} from '../../shared/ipc'
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
    opInProgress: null,
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
  '%H%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%ct%x1f%(trailers:key=Isomer-Change,valueonly,separator=%x2C,unfold)'

/** Parse the %x1f-separated log format above. Exported pure for tests. */
export function parseLog(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const [sha, parents, title, authorName, authorEmail, ts, changeId] = line.split('\x1f')
    if (!sha || !title) continue
    // Multiple trailers on one commit mean a squash of changes (ism's
    // "merged" anomaly) — there is no single identity to display.
    const trailerValues = (changeId ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '')
    entries.push({
      sha,
      parents: (parents ?? '').split(' ').filter((v) => v !== ''),
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
    const summary = parseStatusV2(r.stdout)
    summary.opInProgress = await this.opInProgress(cwd)
    return ok(summary)
  }

  /** Which multi-step operation is mid-flight, if any (drives the conflict
   * banner). Paths resolved via --git-path so worktrees/submodules work. */
  private async opInProgress(cwd: string): Promise<GitStatusSummary['opInProgress']> {
    const probes: [string, GitStatusSummary['opInProgress']][] = [
      ['rebase-merge', 'rebase'],
      ['rebase-apply', 'rebase'],
      ['MERGE_HEAD', 'merge'],
      ['CHERRY_PICK_HEAD', 'cherry-pick'],
      ['REVERT_HEAD', 'revert'],
    ]
    const r = await this.run(cwd, ['rev-parse', ...probes.map(([name]) => `--git-path=${name}`)])
    if (r.code !== 0) return null
    const paths = r.stdout.trim().split('\n')
    const { existsSync } = await import('node:fs')
    const { isAbsolute, join } = await import('node:path')
    for (let i = 0; i < probes.length; i++) {
      const abs = isAbsolute(paths[i] ?? '') ? (paths[i] as string) : join(cwd, paths[i] ?? '')
      if (paths[i] && existsSync(abs)) return probes[i][1]
    }
    return null
  }

  async log(cwd: string, limit: number): Promise<Result<GitLogEntry[]>> {
    // Every ref plus HEAD (detached checkouts included) except isomer
    // metadata and stashes; children before parents so the graph rail can
    // lay out lanes top-down.
    const r = await this.run(cwd, [
      'log',
      '--exclude=refs/isomer/*',
      '--exclude=refs/stash',
      '--all',
      '--date-order',
      `--max-count=${limit}`,
      `--format=${LOG_FORMAT}`,
    ])
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
    const [head, refs, stashes, subs, remotes] = await Promise.all([
      this.run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      this.run(cwd, [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(upstream:track)',
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ]),
      this.run(cwd, ['stash', 'list']),
      this.run(cwd, ['submodule', 'status']),
      this.run(cwd, ['remote', '-v']),
    ])
    if (refs.code !== 0) {
      return err({ code: 'GIT', message: refs.stderr.trim() || 'for-each-ref failed' })
    }
    const out: GitRefs = {
      current: head.code === 0 ? head.stdout.trim() : '',
      locals: {},
      tracking: {},
      remotes: {},
      remoteUrls: {},
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
      const [ref, sha, track] = line.split('\0')
      if (!ref || !sha) continue
      if (ref.startsWith('refs/heads/')) {
        const name = ref.slice('refs/heads/'.length)
        out.locals[name] = sha
        const m = (track ?? '').match(/\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/)
        if (m && (m[1] || m[2])) {
          out.tracking[name] = { ahead: Number(m[1] ?? 0), behind: Number(m[2] ?? 0) }
        }
      } else if (ref.startsWith('refs/remotes/')) out.remotes[ref.slice('refs/remotes/'.length)] = sha
      else if (ref.startsWith('refs/tags/')) out.tags[ref.slice('refs/tags/'.length)] = sha
    }
    if (remotes.code === 0) {
      for (const line of remotes.stdout.split('\n')) {
        const m = line.match(/^(\S+)\t(\S+) \(fetch\)$/)
        if (m) out.remoteUrls[m[1]] = m[2]
      }
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

  private async simple(cwd: string, args: string[]): Promise<Result<void>> {
    const r = await this.run(cwd, args)
    if (r.code !== 0) {
      return err({ code: 'GIT', message: r.stderr.trim() || `git ${args[0]} failed` })
    }
    return ok(undefined)
  }

  checkout(cwd: string, branch: string): Promise<Result<void>> {
    return this.simple(cwd, ['checkout', branch])
  }

  branchCreate(cwd: string, name: string, from: string): Promise<Result<void>> {
    return this.simple(cwd, ['checkout', '-b', name, from])
  }

  branchRename(cwd: string, from: string, to: string): Promise<Result<void>> {
    return this.simple(cwd, ['branch', '-m', from, to])
  }

  branchDelete(cwd: string, name: string): Promise<Result<void>> {
    return this.simple(cwd, ['branch', '-D', name])
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
    // --diff-merges=first-parent: merges otherwise emit the combined
    // (diff --cc) format, which the renderer's unified parser cannot read.
    const r = await this.run(cwd, [
      'show',
      sha,
      '--format=',
      '--patch',
      '--diff-merges=first-parent',
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

  async push(cwd: string, forceWithLease = false): Promise<Result<string>> {
    const args = forceWithLease ? ['push', '--force-with-lease'] : ['push']
    const first = await this.network(cwd, args)
    if (!first.ok && /no upstream|--set-upstream/i.test(first.error.message)) {
      // First push of a new branch: publish it instead of failing.
      return this.network(cwd, [...args, '--set-upstream', 'origin', 'HEAD'])
    }
    return first
  }

  /* ==== stash ============================================================ */

  async stashList(cwd: string): Promise<Result<StashEntry[]>> {
    const r = await this.run(cwd, ['stash', 'list', '--format=%gd%x1f%ct%x1f%gs'])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'stash list failed' })
    const out: StashEntry[] = []
    for (const line of r.stdout.split('\n')) {
      const [sel, ts, msg] = line.split('\x1f')
      const m = sel?.match(/stash@\{(\d+)\}/)
      if (!m) continue
      out.push({ index: Number(m[1]), timestamp: Number(ts ?? 0), message: msg ?? '' })
    }
    return ok(out)
  }

  async stashDiff(cwd: string, index: number): Promise<Result<string>> {
    const r = await this.run(cwd, ['stash', 'show', '-p', '--no-color', `stash@{${index}}`])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'stash show failed' })
    return ok(r.stdout)
  }

  async stashApply(cwd: string, index: number, pop: boolean): Promise<Result<string>> {
    return this.network(cwd, ['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
  }

  async stashDrop(cwd: string, index: number): Promise<Result<void>> {
    return this.simple(cwd, ['stash', 'drop', `stash@{${index}}`])
  }

  /* ==== history verbs ==================================================== */

  cherryPick(cwd: string, sha: string): Promise<Result<string>> {
    return this.network(cwd, ['cherry-pick', sha])
  }

  revert(cwd: string, sha: string): Promise<Result<string>> {
    return this.network(cwd, ['revert', '--no-edit', sha])
  }

  async tagCreate(cwd: string, name: string, sha: string, push: boolean): Promise<Result<string>> {
    const r = await this.simple(cwd, ['tag', name, sha])
    if (!r.ok) return r
    if (push) return this.network(cwd, ['push', 'origin', `refs/tags/${name}`])
    return ok(`tag ${name} created`)
  }

  async tagDelete(cwd: string, name: string, remote: boolean): Promise<Result<string>> {
    const r = await this.simple(cwd, ['tag', '-d', name])
    if (!r.ok) return r
    if (remote) return this.network(cwd, ['push', 'origin', `:refs/tags/${name}`])
    return ok(`tag ${name} deleted`)
  }

  /* ==== working tree surgery ============================================= */

  async discard(cwd: string, tracked: string[], untracked: string[]): Promise<Result<void>> {
    if (tracked.length > 0) {
      const r = await this.simple(cwd, ['checkout', 'HEAD', '--', ...tracked])
      if (!r.ok) return r
    }
    if (untracked.length > 0) {
      const r = await this.simple(cwd, ['clean', '-f', '--', ...untracked])
      if (!r.ok) return r
    }
    return ok(undefined)
  }

  /** Apply a verbatim single-hunk patch to the index (or reverse it). */
  private async applyPatch(cwd: string, patch: string, args: string[]): Promise<Result<void>> {
    try {
      const r = await this.exec('git', ['--no-optional-locks', 'apply', ...args, '-'], {
        cwd,
        stdin: patch,
      })
      if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git apply failed' })
      return ok(undefined)
    } catch (e) {
      return err({ code: 'GIT', message: e instanceof Error ? e.message : String(e) })
    }
  }

  stageHunk(cwd: string, patch: string): Promise<Result<void>> {
    return this.applyPatch(cwd, patch, ['--cached'])
  }

  unstageHunk(cwd: string, patch: string): Promise<Result<void>> {
    return this.applyPatch(cwd, patch, ['--cached', '-R'])
  }

  discardHunk(cwd: string, patch: string): Promise<Result<void>> {
    return this.applyPatch(cwd, patch, ['-R'])
  }

  /* ==== search / archaeology ============================================= */

  async logSearch(cwd: string, query: string, limit: number): Promise<Result<GitLogEntry[]>> {
    // Three probes — message, author, sha prefix — merged, first-seen wins.
    const base = ['log', '--all', '--date-order', `--max-count=${limit}`, `--format=${LOG_FORMAT}`]
    const probes = [
      this.run(cwd, [...base, '-i', `--grep=${query}`]),
      this.run(cwd, [...base, '-i', `--author=${query}`]),
    ]
    if (/^[0-9a-f]{4,40}$/i.test(query)) {
      probes.push(this.run(cwd, [...base.slice(0, 1), `--max-count=1`, `--format=${LOG_FORMAT}`, query]))
    }
    const results = await Promise.all(probes)
    const seen = new Set<string>()
    const out: GitLogEntry[] = []
    for (const r of results) {
      if (r.code !== 0) continue
      for (const e of parseLog(r.stdout)) {
        if (seen.has(e.sha)) continue
        seen.add(e.sha)
        out.push(e)
      }
    }
    return ok(out)
  }

  async fileHistory(cwd: string, path: string, limit: number): Promise<Result<GitLogEntry[]>> {
    const r = await this.run(cwd, [
      'log',
      '--follow',
      `--max-count=${limit}`,
      `--format=${LOG_FORMAT}`,
      '--',
      path,
    ])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'file history failed' })
    return ok(parseLog(r.stdout))
  }

  async blame(cwd: string, path: string): Promise<Result<BlameLine[]>> {
    const r = await this.run(cwd, ['blame', '--line-porcelain', '--', path])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git blame failed' })
    const out: BlameLine[] = []
    let cur: Partial<BlameLine> = {}
    for (const line of r.stdout.split('\n')) {
      const head = line.match(/^([0-9a-f]{40}) \d+ (\d+)/)
      if (head) {
        cur = { sha: head[1], line: Number(head[2]) }
      } else if (line.startsWith('author ')) cur.author = line.slice(7)
      else if (line.startsWith('author-time ')) cur.timestamp = Number(line.slice(12))
      else if (line.startsWith('summary ')) cur.summary = line.slice(8)
      else if (line.startsWith('\t')) {
        out.push({
          line: cur.line ?? 0,
          sha: cur.sha ?? '',
          author: cur.author ?? '',
          timestamp: cur.timestamp ?? 0,
          summary: cur.summary ?? '',
          text: line.slice(1),
        })
      }
    }
    return ok(out)
  }

  async reflog(cwd: string, limit: number): Promise<Result<ReflogEntry[]>> {
    const r = await this.run(cwd, ['reflog', `--format=%gd%x1f%H%x1f%gs%x1f%ct`, '-n', String(limit)])
    if (r.code !== 0) return err({ code: 'GIT', message: r.stderr.trim() || 'git reflog failed' })
    const out: ReflogEntry[] = []
    for (const line of r.stdout.split('\n')) {
      const [sel, sha, action, ts] = line.split('\x1f')
      if (!sel || !sha) continue
      out.push({ selector: sel, sha, action: action ?? '', timestamp: Number(ts ?? 0) })
    }
    return ok(out)
  }

  /* ==== merge / rebase / conflicts ======================================= */

  merge(cwd: string, branch: string): Promise<Result<string>> {
    return this.network(cwd, ['merge', '--no-edit', branch])
  }

  rebase(cwd: string, onto: string): Promise<Result<string>> {
    return this.network(cwd, ['rebase', onto])
  }

  opAbort(cwd: string, op: 'merge' | 'rebase' | 'cherry-pick' | 'revert'): Promise<Result<string>> {
    return this.network(cwd, [op, '--abort'])
  }

  async opContinue(
    cwd: string,
    op: 'merge' | 'rebase' | 'cherry-pick' | 'revert',
  ): Promise<Result<string>> {
    if (op === 'merge') return this.network(cwd, ['commit', '--no-edit'])
    // GIT_EDITOR=true: --continue must never open an interactive editor.
    try {
      const r = await this.exec('git', ['--no-optional-locks', op, '--continue'], {
        cwd,
        env: { GIT_EDITOR: 'true' },
      })
      const tail = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-3).join('\n')
      if (r.code !== 0) return err({ code: 'GIT', message: tail || `${op} --continue failed` })
      return ok(tail)
    } catch (e) {
      return err({ code: 'GIT', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async conflictTake(cwd: string, path: string, side: 'ours' | 'theirs'): Promise<Result<void>> {
    const r = await this.simple(cwd, ['checkout', `--${side}`, '--', path])
    if (!r.ok) return r
    return this.simple(cwd, ['add', '--', path])
  }

  async branchCompare(cwd: string, branch: string): Promise<Result<BranchCompare>> {
    const fmt = `--format=${LOG_FORMAT}`
    const [ahead, behind] = await Promise.all([
      this.run(cwd, ['log', '--max-count=100', fmt, `${branch}..HEAD`]),
      this.run(cwd, ['log', '--max-count=100', fmt, `HEAD..${branch}`]),
    ])
    if (ahead.code !== 0 || behind.code !== 0) {
      return err({ code: 'GIT', message: (ahead.stderr || behind.stderr).trim() || 'compare failed' })
    }
    return ok({ ahead: parseLog(ahead.stdout), behind: parseLog(behind.stdout) })
  }

  /* ==== remotes / submodules ============================================ */

  remoteAdd(cwd: string, name: string, url: string): Promise<Result<void>> {
    return this.simple(cwd, ['remote', 'add', name, url])
  }

  remoteRemove(cwd: string, name: string): Promise<Result<void>> {
    return this.simple(cwd, ['remote', 'remove', name])
  }

  remoteSetUrl(cwd: string, name: string, url: string): Promise<Result<void>> {
    return this.simple(cwd, ['remote', 'set-url', name, url])
  }

  submoduleUpdate(cwd: string): Promise<Result<string>> {
    return this.network(cwd, ['submodule', 'update', '--init', '--recursive'])
  }
}
