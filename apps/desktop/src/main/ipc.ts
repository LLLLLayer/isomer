import { BrowserWindow, app, dialog, ipcMain, nativeTheme, net, shell } from 'electron'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { InvokeChannel, InvokeContracts, PushChannel, PushContracts } from '../shared/ipc'
import { err } from '../shared/result'
import type { Exec } from './services/exec'
import { GitService } from './services/git'
import { IsmService } from './services/ism'
import { ProjectRegistry, projectsFile } from './services/projects'
import { PtyService } from './services/pty'
import { SettingsStore, settingsFile } from './services/settings'
import { checkForUpdate } from './services/updates'
import { RepoWatcher } from './services/watcher'

/** Typed ipcMain.handle: the contract table is the only channel authority. */
function handle<C extends InvokeChannel>(
  channel: C,
  handler: (req: InvokeContracts[C]['req']) => Promise<InvokeContracts[C]['res']>,
): void {
  ipcMain.handle(channel, (_event, req) => handler(req as InvokeContracts[C]['req']))
}

export function push<C extends PushChannel>(channel: C, payload: PushContracts[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

const NO_PROJECT = err<never>({
  code: 'NO_PROJECT',
  message: 'unknown project id',
  hint: 'reopen the project from the rail',
})

export function registerIpc(exec: Exec): { dispose(): void } {
  const userData = app.getPath('userData')
  const settings = new SettingsStore(settingsFile(userData))
  const projects = new ProjectRegistry(projectsFile(userData))
  const git = new GitService(exec)
  const ism = new IsmService(exec, () => settings.get().ismPath)
  const pty = new PtyService({
    onData: (payload) => push('pty:data', payload),
    onExit: (id, exitCode) => push('pty:exit', { id, exitCode }),
  })
  const watcher = new RepoWatcher()

  const cwd = (projectId: string): string | undefined => projects.get(projectId)?.path

  handle('app:version', async () => app.getVersion())
  handle('ism:detect', async () => ism.detect())
  void ism.detect() // warm the cache: run() falls back to the found binary
  handle('update:check', async () => {
    try {
      // Electron's net.fetch rides Chromium's stack (system proxy aware);
      // the timeout keeps a hung connection from wedging the check.
      const fetchImpl: typeof fetch = (input, init) =>
        net.fetch(input as string, { ...init, signal: AbortSignal.timeout(10_000) })
      return { ok: true, data: await checkForUpdate(app.getVersion(), fetchImpl) }
    } catch (e) {
      return err({
        code: 'UPDATE_CHECK',
        message: e instanceof Error ? e.message : String(e),
        hint: 'check the network and try again',
      })
    }
  })

  /** A repo-relative path resolved inside the project root, or null when it
   * escapes. Containment is checked lexically AND on real paths, so a
   * committed symlink pointing outside the repo cannot smuggle a target. */
  const insideProject = async (projectId: string, rel: string): Promise<string | null> => {
    const root = cwd(projectId)
    if (!root || isAbsolute(rel)) return null
    const abs = resolve(root, rel)
    if (abs !== root && !abs.startsWith(root + sep)) return null
    try {
      const realRoot = await realpath(root)
      // The leaf may not exist (deleted files); resolve its parent instead.
      const real = await realpath(abs).catch(async () =>
        join(await realpath(dirname(abs)), basename(abs)),
      )
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return null
    } catch {
      return null
    }
    return abs
  }
  const OUTSIDE = err<never>({
    code: 'PATH_OUTSIDE_PROJECT',
    message: 'path resolves outside the project',
    hint: 'symlinks leaving the repository are not followed',
  })
  handle('shell:reveal', async ({ projectId, path }) => {
    const abs = await insideProject(projectId, path)
    if (!abs) return OUTSIDE
    shell.showItemInFolder(abs)
    return { ok: true, data: undefined }
  })
  handle('shell:open-path', async ({ projectId, path }) => {
    const abs = await insideProject(projectId, path)
    if (!abs) return OUTSIDE
    const problem = await shell.openPath(abs)
    return problem === ''
      ? { ok: true, data: undefined }
      : err({ code: 'OPEN_PATH', message: problem })
  })
  handle('shell:open-external', async ({ url }) => {
    if (!url.startsWith('https://')) {
      return err({ code: 'BAD_URL', message: 'only https links may leave the app' })
    }
    await shell.openExternal(url)
    return { ok: true, data: undefined }
  })
  handle('dialog:pick-directory', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  const applyNativeTheme = (): void => {
    nativeTheme.themeSource = settings.get().theme
  }
  applyNativeTheme()
  handle('settings:get', async () => settings.get())
  handle('settings:set', async (patch) => {
    const updated = settings.update(patch)
    applyNativeTheme()
    return updated
  })
  handle('projects:list', async () => projects.list())
  handle('projects:add', async ({ path }) => {
    if (!(await git.isRepository(path))) {
      return err({
        code: 'NOT_A_REPO',
        message: `${path} is not a git repository`,
        hint: 'pick a directory containing a .git',
      })
    }
    return { ok: true, data: projects.add(path) }
  })
  handle('projects:remove', async ({ id }) => projects.remove(id))

  handle('git:status', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.status(dir) : NO_PROJECT
  })
  handle('git:log', async ({ projectId, limit }) => {
    const dir = cwd(projectId)
    return dir ? git.log(dir, limit) : NO_PROJECT
  })

  handle('git:refs', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.refs(dir) : NO_PROJECT
  })
  handle('git:working-diff', async ({ projectId, path, untracked }) => {
    const dir = cwd(projectId)
    return dir ? git.workingDiff(dir, path, untracked) : NO_PROJECT
  })
  handle('git:commit-diff', async ({ projectId, sha }) => {
    const dir = cwd(projectId)
    return dir ? git.commitDiff(dir, sha) : NO_PROJECT
  })
  handle('repo:watch', async ({ projectId }) => {
    const dir = cwd(projectId)
    if (!dir) return
    watcher.watch(dir, () => push('repo:changed', { projectId }))
  })
  handle('git:stage', async ({ projectId, paths }) => {
    const dir = cwd(projectId)
    return dir ? git.stage(dir, paths) : NO_PROJECT
  })
  handle('git:unstage', async ({ projectId, paths }) => {
    const dir = cwd(projectId)
    return dir ? git.unstage(dir, paths) : NO_PROJECT
  })
  handle('git:commit', async ({ projectId, subject, description, amend }) => {
    const dir = cwd(projectId)
    return dir ? git.commit(dir, subject, description, amend) : NO_PROJECT
  })
  handle('git:stash', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.stash(dir) : NO_PROJECT
  })
  handle('git:checkout', async ({ projectId, branch }) => {
    const dir = cwd(projectId)
    return dir ? git.checkout(dir, branch) : NO_PROJECT
  })
  handle('git:branch-create', async ({ projectId, name, from }) => {
    const dir = cwd(projectId)
    return dir ? git.branchCreate(dir, name, from) : NO_PROJECT
  })
  handle('git:branch-rename', async ({ projectId, from, to }) => {
    const dir = cwd(projectId)
    return dir ? git.branchRename(dir, from, to) : NO_PROJECT
  })
  handle('git:branch-delete', async ({ projectId, name }) => {
    const dir = cwd(projectId)
    return dir ? git.branchDelete(dir, name) : NO_PROJECT
  })
  handle('git:commit-info', async ({ projectId, sha }) => {
    const dir = cwd(projectId)
    return dir ? git.commitInfo(dir, sha) : NO_PROJECT
  })
  handle('git:staged-diff', async ({ projectId, path }) => {
    const dir = cwd(projectId)
    return dir ? git.stagedDiff(dir, path) : NO_PROJECT
  })
  handle('git:fetch', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.fetch(dir) : NO_PROJECT
  })
  handle('git:pull', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.pull(dir) : NO_PROJECT
  })
  handle('git:push', async ({ projectId, forceWithLease }) => {
    const dir = cwd(projectId)
    return dir ? git.push(dir, forceWithLease ?? false) : NO_PROJECT
  })
  handle('git:stash-list', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.stashList(dir) : NO_PROJECT
  })
  handle('git:stash-diff', async ({ projectId, index }) => {
    const dir = cwd(projectId)
    return dir ? git.stashDiff(dir, index) : NO_PROJECT
  })
  handle('git:stash-apply', async ({ projectId, index, pop }) => {
    const dir = cwd(projectId)
    return dir ? git.stashApply(dir, index, pop) : NO_PROJECT
  })
  handle('git:stash-drop', async ({ projectId, index }) => {
    const dir = cwd(projectId)
    return dir ? git.stashDrop(dir, index) : NO_PROJECT
  })
  handle('git:cherry-pick', async ({ projectId, sha }) => {
    const dir = cwd(projectId)
    return dir ? git.cherryPick(dir, sha) : NO_PROJECT
  })
  handle('git:revert', async ({ projectId, sha }) => {
    const dir = cwd(projectId)
    return dir ? git.revert(dir, sha) : NO_PROJECT
  })
  handle('git:tag-create', async ({ projectId, name, sha, push }) => {
    const dir = cwd(projectId)
    return dir ? git.tagCreate(dir, name, sha, push) : NO_PROJECT
  })
  handle('git:tag-delete', async ({ projectId, name, remote }) => {
    const dir = cwd(projectId)
    return dir ? git.tagDelete(dir, name, remote) : NO_PROJECT
  })
  handle('git:discard', async ({ projectId, tracked, untracked }) => {
    const dir = cwd(projectId)
    return dir ? git.discard(dir, tracked, untracked) : NO_PROJECT
  })
  handle('git:stage-hunk', async ({ projectId, patch }) => {
    const dir = cwd(projectId)
    return dir ? git.stageHunk(dir, patch) : NO_PROJECT
  })
  handle('git:unstage-hunk', async ({ projectId, patch }) => {
    const dir = cwd(projectId)
    return dir ? git.unstageHunk(dir, patch) : NO_PROJECT
  })
  handle('git:discard-hunk', async ({ projectId, patch }) => {
    const dir = cwd(projectId)
    return dir ? git.discardHunk(dir, patch) : NO_PROJECT
  })
  handle('git:log-search', async ({ projectId, query, limit }) => {
    const dir = cwd(projectId)
    return dir ? git.logSearch(dir, query, limit) : NO_PROJECT
  })
  handle('git:file-history', async ({ projectId, path, limit }) => {
    const dir = cwd(projectId)
    return dir ? git.fileHistory(dir, path, limit) : NO_PROJECT
  })
  handle('git:blame', async ({ projectId, path }) => {
    const dir = cwd(projectId)
    return dir ? git.blame(dir, path) : NO_PROJECT
  })
  handle('git:merge', async ({ projectId, branch }) => {
    const dir = cwd(projectId)
    return dir ? git.merge(dir, branch) : NO_PROJECT
  })
  handle('git:rebase', async ({ projectId, onto }) => {
    const dir = cwd(projectId)
    return dir ? git.rebase(dir, onto) : NO_PROJECT
  })
  handle('git:op-abort', async ({ projectId, op }) => {
    const dir = cwd(projectId)
    return dir ? git.opAbort(dir, op) : NO_PROJECT
  })
  handle('git:op-continue', async ({ projectId, op }) => {
    const dir = cwd(projectId)
    return dir ? git.opContinue(dir, op) : NO_PROJECT
  })
  handle('git:conflict-take', async ({ projectId, path, side }) => {
    const dir = cwd(projectId)
    return dir ? git.conflictTake(dir, path, side) : NO_PROJECT
  })
  handle('git:branch-compare', async ({ projectId, branch }) => {
    const dir = cwd(projectId)
    return dir ? git.branchCompare(dir, branch) : NO_PROJECT
  })
  handle('git:remote-add', async ({ projectId, name, url }) => {
    const dir = cwd(projectId)
    return dir ? git.remoteAdd(dir, name, url) : NO_PROJECT
  })
  handle('git:remote-remove', async ({ projectId, name }) => {
    const dir = cwd(projectId)
    return dir ? git.remoteRemove(dir, name) : NO_PROJECT
  })
  handle('git:remote-set-url', async ({ projectId, name, url }) => {
    const dir = cwd(projectId)
    return dir ? git.remoteSetUrl(dir, name, url) : NO_PROJECT
  })
  handle('git:submodule-update', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? git.submoduleUpdate(dir) : NO_PROJECT
  })
  handle('git:reflog', async ({ projectId, limit }) => {
    const dir = cwd(projectId)
    return dir ? git.reflog(dir, limit) : NO_PROJECT
  })
  handle('ism:snapshot', async ({ projectId, base }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    const args = ['inspect', ...(base ? ['--base', base] : [])]
    return ism.run(dir, args)
  })
  handle('ism:hunks', async ({ projectId, ids }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    if (ids.length === 0) return { ok: true, data: [] }
    return ism.run(dir, ['show', 'hunk', ...ids])
  })
  handle('ism:verify', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? ism.run(dir, ['verify']) : NO_PROJECT
  })
  /** Serialize a renderer-built plan to a temp file for the CLI (D23:
   * the CLI is the only interface; the renderer never touches disk). */
  const withPlanFile = async <T>(
    plan: unknown,
    body: (path: string) => Promise<T>,
  ): Promise<T> => {
    const dir = await mkdtemp(join(tmpdir(), 'ism-plan-'))
    const file = join(dir, 'plan.json')
    await writeFile(file, JSON.stringify(plan))
    try {
      return await body(file)
    } finally {
      void rm(dir, { recursive: true, force: true })
    }
  }
  handle('ism:check', async ({ projectId, plan }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    return withPlanFile(plan, (file) => ism.run(dir, ['check', file]))
  })
  handle('ism:apply', async ({ projectId, plan }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    return withPlanFile(plan, (file) => ism.run(dir, ['apply', file]))
  })
  handle('ism:ops', async ({ projectId, limit }) => {
    const dir = cwd(projectId)
    return dir ? ism.run(dir, ['ops', '--limit', String(limit ?? 50)]) : NO_PROJECT
  })
  handle('ism:undo', async ({ projectId }) => {
    const dir = cwd(projectId)
    return dir ? ism.run(dir, ['undo']) : NO_PROJECT
  })
  handle('ism:comment-list', async ({ projectId, unresolvedOnly }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    const args = ['comment', 'list', ...(unresolvedOnly ? ['--unresolved'] : [])]
    return ism.run(dir, args)
  })
  handle('ism:comment-add', async ({ projectId, change, body, path, line, replyTo }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    const args = ['comment', 'add', '--change', change, '-m', body]
    if (path) args.push('--path', path)
    if (line !== undefined) args.push('--line', String(line))
    if (replyTo) args.push('--reply-to', replyTo)
    return ism.run(dir, args)
  })
  handle('ism:comment-resolve', async ({ projectId, id }) => {
    const dir = cwd(projectId)
    return dir ? ism.run(dir, ['comment', 'resolve', id]) : NO_PROJECT
  })

  handle('pty:create', async ({ projectId, cols, rows }) => {
    const dir = cwd(projectId)
    if (!dir) return NO_PROJECT
    try {
      return { ok: true, data: { id: pty.create(dir, cols, rows) } }
    } catch (e) {
      // node-pty is native; a broken build (ABI mismatch) must surface as a
      // structured error, not an unhandled rejection.
      return err({
        code: 'PTY',
        message: e instanceof Error ? e.message : String(e),
        hint: 'reinstall dependencies (node-pty native build)',
      })
    }
  })
  handle('pty:input', async ({ id, data }) => pty.write(id, data))
  handle('pty:resize', async ({ id, cols, rows }) => pty.resize(id, cols, rows))
  handle('pty:kill', async ({ id }) => pty.kill(id))

  return {
    dispose(): void {
      pty.disposeAll()
      watcher.dispose()
    },
  }
}
