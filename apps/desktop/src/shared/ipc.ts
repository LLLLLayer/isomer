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
  /** Entries from porcelain v2; origPath present for renames/copies. */
  entries: { code: string; path: string; origPath?: string }[]
}

export interface GitLogEntry {
  sha: string
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
  remotes: Record<string, string>
  tags: Record<string, string>
  stashes: number
  submodules: string[]
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
  'git:commit-info': { req: { projectId: string; sha: string }; res: Result<CommitInfo> }
  'git:staged-diff': { req: { projectId: string; path: string }; res: Result<string> }
  'repo:watch': { req: { projectId: string }; res: void }
  'git:fetch': { req: { projectId: string }; res: Result<string> }
  'git:pull': { req: { projectId: string }; res: Result<string> }
  'git:push': { req: { projectId: string }; res: Result<string> }
  'ism:snapshot': { req: { projectId: string; base?: string }; res: Result<Snapshot> }
  'ism:hunks': { req: { projectId: string; ids: string[] }; res: Result<HunkPatch[]> }
  'ism:verify': { req: { projectId: string }; res: Result<VerifyOutcome> }
  'ism:apply': { req: { projectId: string; planPath: string }; res: Result<ApplyOutcome> }
  'ism:undo': { req: { projectId: string }; res: Result<unknown> }
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
  'git:commit-info',
  'git:staged-diff',
  'repo:watch',
  'git:fetch',
  'git:pull',
  'git:push',
  'ism:snapshot',
  'ism:hunks',
  'ism:verify',
  'ism:apply',
  'ism:undo',
  'ism:comment-list',
  'ism:comment-add',
  'ism:comment-resolve',
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
  invoke<C extends InvokeChannel>(
    channel: C,
    req: InvokeContracts[C]['req'],
  ): Promise<InvokeContracts[C]['res']>
  on<C extends PushChannel>(channel: C, listener: (payload: PushContracts[C]) => void): () => void
}
