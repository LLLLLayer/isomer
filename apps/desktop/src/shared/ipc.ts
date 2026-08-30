/**
 * The typed IPC contract — single source of truth for both processes.
 * Pattern adapted from gitify's events.ts / GitHub Desktop's ipc-shared.ts:
 * every channel is declared here with request/response types, and a
 * compile-time coverage assertion fails the build if a channel lacks a
 * contract. Neither side ever touches raw channel strings elsewhere.
 */

import type { ApplyOutcome, Comment, HunkPatch, Snapshot, VerifyOutcome } from './ism-types'
import type { Result } from './result'
import type { Settings } from './theme'

export interface Project {
  id: string
  path: string
  name: string
  lastOpenedAt: number
}

export interface GitStatusSummary {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  /** A merge/rebase/cherry-pick/revert is mid-flight (conflict flow). */
  opInProgress: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
  /** Entries from porcelain v2; origPath present for renames/copies. */
  entries: { code: string; path: string; origPath?: string }[]
}

export interface StashEntry {
  index: number
  message: string
  timestamp: number
}

export interface ReflogEntry {
  selector: string
  sha: string
  action: string
  timestamp: number
}

export interface BlameLine {
  line: number
  sha: string
  author: string
  timestamp: number
  summary: string
  text: string
}

export interface BranchCompare {
  ahead: GitLogEntry[]
  behind: GitLogEntry[]
}

/** One record of the ism op log (refs/isomer/data), serde snake_case. */
export interface IsmOp {
  sha: string
  kind: 'apply' | 'undo' | 'void'
  branch: string
  /** Epoch seconds, as a string. */
  timestamp: string
  old_head: string
  new_head: string
  old_tree: string
  new_tree: string
}

export interface GitLogEntry {
  sha: string
  /** Parent shas (2+ on merges) — drives the history graph rail. */
  parents: string[]
  title: string
  authorName: string
  authorEmail: string
  timestamp: number
  changeId: string | null
}

export interface GitRefs {
  current: string
  /** name → tip sha, for decorating the commit list. */
  locals: Record<string, string>
  /** local branch → ahead/behind vs its upstream (badge data). */
  tracking: Record<string, { ahead: number; behind: number }>
  remotes: Record<string, string>
  /** remote name → fetch URL. */
  remoteUrls: Record<string, string>
  tags: Record<string, string>
  stashes: number
  submodules: string[]
}

export interface IsmDetection {
  path: string
  version: string
  source: 'settings' | 'path' | 'common'
}

export interface UpdateInfo {
  version: string
  url: string
  notes: string
}

export interface CommitInfo {
  sha: string
  authorName: string
  authorEmail: string
  authorDate: number
  subject: string
  body: string
}

/** renderer → main, request/response (ipcRenderer.invoke / ipcMain.handle). */
export interface InvokeContracts {
  'app:version': { req: void; res: string }
  'dialog:pick-directory': { req: void; res: string | null }
  'settings:get': { req: void; res: Settings }
  'settings:set': { req: Partial<Settings>; res: Settings }
  'projects:list': { req: void; res: Project[] }
  'projects:add': { req: { path: string }; res: Result<Project> }
  'projects:remove': { req: { id: string }; res: void }
  'git:status': { req: { projectId: string }; res: Result<GitStatusSummary> }
  'git:log': { req: { projectId: string; limit: number }; res: Result<GitLogEntry[]> }
  'git:refs': { req: { projectId: string }; res: Result<GitRefs> }
  'git:working-diff': { req: { projectId: string; path: string; untracked: boolean }; res: Result<string> }
  'git:commit-diff': { req: { projectId: string; sha: string }; res: Result<string> }
  'git:stage': { req: { projectId: string; paths: string[] }; res: Result<void> }
  'git:unstage': { req: { projectId: string; paths: string[] }; res: Result<void> }
  'git:commit': {
    req: { projectId: string; subject: string; description: string; amend: boolean }
    res: Result<string>
  }
  'git:stash': { req: { projectId: string }; res: Result<string> }
  'git:checkout': { req: { projectId: string; branch: string }; res: Result<void> }
  'git:branch-create': {
    req: { projectId: string; name: string; from: string }
    res: Result<void>
  }
  'git:branch-rename': { req: { projectId: string; from: string; to: string }; res: Result<void> }
  'git:branch-delete': { req: { projectId: string; name: string }; res: Result<void> }
  'git:commit-info': { req: { projectId: string; sha: string }; res: Result<CommitInfo> }
  'git:staged-diff': { req: { projectId: string; path: string }; res: Result<string> }
  'repo:watch': { req: { projectId: string }; res: void }
  'git:fetch': { req: { projectId: string }; res: Result<string> }
  'git:pull': { req: { projectId: string }; res: Result<string> }
  'git:push': { req: { projectId: string; forceWithLease?: boolean }; res: Result<string> }
  'git:stash-list': { req: { projectId: string }; res: Result<StashEntry[]> }
  'git:stash-diff': { req: { projectId: string; index: number }; res: Result<string> }
  'git:stash-apply': { req: { projectId: string; index: number; pop: boolean }; res: Result<string> }
  'git:stash-drop': { req: { projectId: string; index: number }; res: Result<void> }
  'git:cherry-pick': { req: { projectId: string; sha: string }; res: Result<string> }
  'git:revert': { req: { projectId: string; sha: string }; res: Result<string> }
  'git:tag-create': {
    req: { projectId: string; name: string; sha: string; push: boolean }
    res: Result<string>
  }
  'git:tag-delete': { req: { projectId: string; name: string; remote: boolean }; res: Result<string> }
  /** Discard working-tree changes: checkout for tracked, clean for untracked. */
  'git:discard': {
    req: { projectId: string; tracked: string[]; untracked: string[] }
    res: Result<void>
  }
  /** Hunk-level index surgery; `patch` is a verbatim single-hunk diff. */
  'git:stage-hunk': { req: { projectId: string; patch: string }; res: Result<void> }
  'git:unstage-hunk': { req: { projectId: string; patch: string }; res: Result<void> }
  'git:discard-hunk': { req: { projectId: string; patch: string }; res: Result<void> }
  'git:log-search': {
    req: { projectId: string; query: string; limit: number }
    res: Result<GitLogEntry[]>
  }
  'git:file-history': {
    req: { projectId: string; path: string; limit: number }
    res: Result<GitLogEntry[]>
  }
  'git:blame': { req: { projectId: string; path: string }; res: Result<BlameLine[]> }
  'git:merge': { req: { projectId: string; branch: string }; res: Result<string> }
  'git:rebase': { req: { projectId: string; onto: string }; res: Result<string> }
  'git:op-abort': {
    req: { projectId: string; op: 'merge' | 'rebase' | 'cherry-pick' | 'revert' }
    res: Result<string>
  }
  'git:op-continue': {
    req: { projectId: string; op: 'merge' | 'rebase' | 'cherry-pick' | 'revert' }
    res: Result<string>
  }
  'git:conflict-take': {
    req: { projectId: string; path: string; side: 'ours' | 'theirs' }
    res: Result<void>
  }
  'git:branch-compare': { req: { projectId: string; branch: string }; res: Result<BranchCompare> }
  'git:remote-add': { req: { projectId: string; name: string; url: string }; res: Result<void> }
  'git:remote-remove': { req: { projectId: string; name: string }; res: Result<void> }
  'git:remote-set-url': {
    req: { projectId: string; name: string; url: string }
    res: Result<void>
  }
  'git:submodule-update': { req: { projectId: string }; res: Result<string> }
  'git:reflog': { req: { projectId: string; limit: number }; res: Result<ReflogEntry[]> }
  'ism:snapshot': { req: { projectId: string; base?: string }; res: Result<Snapshot> }
  'ism:hunks': { req: { projectId: string; ids: string[] }; res: Result<HunkPatch[]> }
  'ism:verify': { req: { projectId: string }; res: Result<VerifyOutcome> }
  /** Plan objects are serialized to a temp file by main; the CLI stays the
   * only interface (D23) and the renderer never touches the filesystem. */
  'ism:check': { req: { projectId: string; plan: unknown }; res: Result<unknown> }
  'ism:apply': { req: { projectId: string; plan: unknown }; res: Result<ApplyOutcome> }
  'ism:undo': { req: { projectId: string }; res: Result<unknown> }
  'ism:ops': { req: { projectId: string; limit?: number }; res: Result<IsmOp[]> }
  'ism:comment-list': {
    req: { projectId: string; unresolvedOnly?: boolean }
    res: Result<Comment[]>
  }
  'ism:comment-add': {
    req: {
      projectId: string
      change: string
      body: string
      path?: string
      line?: number
      replyTo?: string
    }
    res: Result<Comment>
  }
  'ism:comment-resolve': { req: { projectId: string; id: string }; res: Result<Comment> }
  'ism:detect': { req: void; res: IsmDetection | null }
  'update:check': { req: void; res: Result<UpdateInfo | null> }
  /** Reveal a repo-relative path in the OS file manager. */
  'shell:reveal': { req: { projectId: string; path: string }; res: Result<void> }
  /** Open a repo-relative path with the default application. */
  'shell:open-path': { req: { projectId: string; path: string }; res: Result<void> }
  /** Open an https URL in the default browser. */
  'shell:open-external': { req: { url: string }; res: Result<void> }
  'pty:create': {
    req: { projectId: string; cols: number; rows: number }
    res: Result<{ id: string }>
  }
  'pty:input': { req: { id: string; data: string }; res: void }
  'pty:resize': { req: { id: string; cols: number; rows: number }; res: void }
  'pty:kill': { req: { id: string }; res: void }
}

/** main → renderer, fire-and-forget (webContents.send / ipcRenderer.on). */
export interface PushContracts {
  /** Batched pty output; payload is `<36-char session id><data>` (Hyper trick). */
  'pty:data': string
  'pty:exit': { id: string; exitCode: number }
  /** Coarse invalidation: something under .git changed externally. */
  'repo:changed': { projectId: string }
}

export type InvokeChannel = keyof InvokeContracts
export type PushChannel = keyof PushContracts

export const INVOKE_CHANNELS = [
  'app:version',
  'dialog:pick-directory',
  'settings:get',
  'settings:set',
  'projects:list',
  'projects:add',
  'projects:remove',
  'git:status',
  'git:log',
  'git:refs',
  'git:working-diff',
  'git:commit-diff',
  'git:stage',
  'git:unstage',
  'git:commit',
  'git:stash',
  'git:checkout',
  'git:branch-create',
  'git:branch-rename',
  'git:branch-delete',
  'git:commit-info',
  'git:staged-diff',
  'repo:watch',
  'git:fetch',
  'git:pull',
  'git:push',
  'git:stash-list',
  'git:stash-diff',
  'git:stash-apply',
  'git:stash-drop',
  'git:cherry-pick',
  'git:revert',
  'git:tag-create',
  'git:tag-delete',
  'git:discard',
  'git:stage-hunk',
  'git:unstage-hunk',
  'git:discard-hunk',
  'git:log-search',
  'git:file-history',
  'git:blame',
  'git:merge',
  'git:rebase',
  'git:op-abort',
  'git:op-continue',
  'git:conflict-take',
  'git:branch-compare',
  'git:remote-add',
  'git:remote-remove',
  'git:remote-set-url',
  'git:submodule-update',
  'git:reflog',
  'ism:snapshot',
  'ism:hunks',
  'ism:verify',
  'ism:check',
  'ism:apply',
  'ism:undo',
  'ism:ops',
  'ism:comment-list',
  'ism:comment-add',
  'ism:comment-resolve',
  'ism:detect',
  'update:check',
  'shell:reveal',
  'shell:open-path',
  'shell:open-external',
  'pty:create',
  'pty:input',
  'pty:resize',
  'pty:kill',
] as const satisfies readonly InvokeChannel[]

export const PUSH_CHANNELS = ['pty:data', 'pty:exit', 'repo:changed'] as const satisfies readonly PushChannel[]

/**
 * Compile-time coverage assertions: adding a contract without listing the
 * channel (or vice versa) fails typechecking.
 */
type AssertAllInvoke = (typeof INVOKE_CHANNELS)[number] extends InvokeChannel
  ? InvokeChannel extends (typeof INVOKE_CHANNELS)[number]
    ? true
    : never
  : never
type AssertAllPush = (typeof PUSH_CHANNELS)[number] extends PushChannel
  ? PushChannel extends (typeof PUSH_CHANNELS)[number]
    ? true
    : never
  : never
export const _invokeCoverage: AssertAllInvoke = true
export const _pushCoverage: AssertAllPush = true

/** The surface preload exposes as `window.isomer`. */
export interface IsomerApi {
  platform: NodeJS.Platform
  invoke<C extends InvokeChannel>(
    channel: C,
    req: InvokeContracts[C]['req'],
  ): Promise<InvokeContracts[C]['res']>
  on<C extends PushChannel>(channel: C, listener: (payload: PushContracts[C]) => void): () => void
}
