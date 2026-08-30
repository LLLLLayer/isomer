import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import type { InvokeChannel, InvokeContracts, PushChannel, PushContracts } from '../shared/ipc'
import { err } from '../shared/result'
import type { Exec } from './services/exec'
import { GitService } from './services/git'
import { IsmService } from './services/ism'
import { ProjectRegistry, projectsFile } from './services/projects'
import { PtyService } from './services/pty'
import { SettingsStore, settingsFile } from './services/settings'

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

  const cwd = (projectId: string): string | undefined => projects.get(projectId)?.path

  handle('app:version', async () => app.getVersion())
  handle('dialog:pick-directory', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  handle('settings:get', async () => settings.get())
  handle('settings:set', async (patch) => settings.update(patch))
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
  handle('ism:apply', async ({ projectId, planPath }) => {
    const dir = cwd(projectId)
    return dir ? ism.run(dir, ['apply', planPath]) : NO_PROJECT
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
    },
  }
}
