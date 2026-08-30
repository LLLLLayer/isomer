import { create } from 'zustand'
import type {
  CommitInfo,
  GitLogEntry,
  GitRefs,
  GitStatusSummary,
  IsmDetection,
  Project,
  StashEntry,
  UpdateInfo,
} from '../../shared/ipc'
import type { Comment, Snapshot } from '../../shared/ism-types'
import type { AppError } from '../../shared/result'
import type { Settings } from '../../shared/theme'
import { DEFAULT_SETTINGS } from '../../shared/theme'
import i18next from 'i18next'
import { setLanguage } from '../i18n'
import { storage } from '../storage'

export type ViewMode = 'changes' | 'history' | 'stack' | 'organize'
export type ChangeArea = 'unstaged' | 'staged'
export type DetailTab = 'commit' | 'changes' | 'tree'

export interface AppState {
  settings: Settings
  projects: Project[]
  currentProjectId: string | null
  status: GitStatusSummary | null
  log: GitLogEntry[]
  refs: GitRefs | null
  stashes: StashEntry[]
  view: ViewMode
  /** Changes view: selected file (in one of the two areas) and its diff. */
  selectedPath: string | null
  selectedArea: ChangeArea
  workingDiffText: string | null
  /** Fork-style commit box (staged set only). */
  commitSubject: string
  commitDescription: string
  commitAmend: boolean
  committing: boolean
  /** History view: selected commit, its diff and metadata, active tab. */
  selectedCommit: string | null
  commitDiffText: string | null
  commitInfo: CommitInfo | null
  detailTab: DetailTab
  /** In-flight network verb, and the last one-line result. */
  netBusy: 'fetch' | 'pull' | 'push' | null
  netNote: string | null
  snapshot: Snapshot | null
  comments: Comment[]
  selectedChangeId: string | null
  /** Patch text per hunk id, fetched on change selection. */
  patches: Record<string, string>
  /** Pending file/line anchor for the next comment (set from the diff). */
  commentAnchor: { path: string; line: number } | null
  /** Commit descriptions fetched on demand (story view expansion). */
  commitBodies: Record<string, string>
  sidebarCollapsed: boolean
  terminalOpen: boolean
  terminalDock: 'bottom' | 'right'
  /** Text queued for the terminal (agent summon); sent once a pty exists. */
  pendingTerminalInput: string | null
  settingsOpen: boolean
  /** null = no newer release; undefined = not checked yet. */
  updateInfo: UpdateInfo | null | undefined
  updateStatus: 'idle' | 'checking' | 'error'
  /** null = not found; undefined = not probed yet. */
  ismDetection: IsmDetection | null | undefined
  lastError: AppError | null

  bootstrap(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  addProject(): Promise<void>
  openProject(id: string): Promise<void>
  refreshProject(initial?: boolean): Promise<void>
  selectChange(id: string | null): void
  setCommentAnchor(anchor: { path: string; line: number } | null): void
  setView(view: ViewMode): void
  setDetailTab(tab: DetailTab): void
  selectPath(path: string | null, area?: ChangeArea): Promise<void>
  selectCommit(sha: string | null): Promise<void>
  loadCommitBody(sha: string): Promise<void>
  stagePaths(paths: string[]): Promise<void>
  unstagePaths(paths: string[]): Promise<void>
  setCommitField(field: 'subject' | 'description', value: string): void
  setCommitAmend(amend: boolean): void
  doCommit(): Promise<void>
  doStash(): Promise<void>
  branchOp(
    op:
      | { kind: 'checkout'; branch: string }
      | { kind: 'create'; name: string; from: string }
      | { kind: 'rename'; from: string; to: string }
      | { kind: 'delete'; name: string },
  ): Promise<void>
  runNet(verb: 'fetch' | 'pull' | 'push', opts?: { forceWithLease?: boolean }): Promise<void>
  addComment(input: { change: string; body: string; path?: string; line?: number; replyTo?: string }): Promise<void>
  resolveComment(id: string): Promise<void>
  toggleSidebar(): void
  toggleTerminal(): void
  setTerminalDock(dock: 'bottom' | 'right'): void
  /** Open the terminal pre-filled with the agent command + fix prompt. */
  summonAgent(): void
  clearPendingTerminalInput(): void
  openSettings(): void
  closeSettings(): void
  checkUpdate(): Promise<void>
  detectIsm(): Promise<void>
  openExternal(url: string): Promise<void>
  setError(error: AppError): void
  clearError(): void
}

let bootstrapped = false
let detectSeq = 0
let forcedViewUsed = false

/** The ?view= override (shot tooling) applies to the FIRST landing only —
 * location.search never changes, so later project switches must ignore it. */
function consumeForcedView(): ViewMode | 'settings' | null {
  if (forcedViewUsed) return null
  forcedViewUsed = true
  return new URLSearchParams(window.location.search).get('view') as ViewMode | 'settings' | null
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  projects: [],
  currentProjectId: null,
  status: null,
  log: [],
  refs: null,
  stashes: [],
  view: 'changes',
  selectedPath: null,
  selectedArea: 'unstaged',
  workingDiffText: null,
  commitSubject: '',
  commitDescription: '',
  commitAmend: false,
  committing: false,
  selectedCommit: null,
  commitDiffText: null,
  commitInfo: null,
  detailTab: 'changes',
  netBusy: null,
  netNote: null,
  snapshot: null,
  comments: [],
  selectedChangeId: null,
  patches: {},
  commentAnchor: null,
  commitBodies: {},
  sidebarCollapsed: storage.get('sidebarCollapsed') === '1',
  terminalOpen: false,
  terminalDock: storage.get('terminalDock') === 'right' ? 'right' : 'bottom',
  pendingTerminalInput: null,
  settingsOpen: false,
  updateInfo: undefined,
  updateStatus: 'idle',
  ismDetection: undefined,
  lastError: null,

  async bootstrap() {
    // StrictMode double-invokes mount effects; a second bootstrap would
    // duplicate the repo:changed subscription and race two openProject chains.
    if (bootstrapped) return
    bootstrapped = true
    const [settings, projects] = await Promise.all([
      window.isomer.invoke('settings:get', undefined),
      window.isomer.invoke('projects:list', undefined),
    ])
    setLanguage(settings.language)
    set({ settings, projects })
    // External git activity (terminal commits, ism applies, rebases) lands
    // as a coarse invalidation; refresh whatever project it belongs to.
    window.isomer.on('repo:changed', ({ projectId }) => {
      if (projectId === get().currentProjectId) void get().refreshProject()
    })
    // A quiet startup check; failures stay silent (settings has a manual one).
    setTimeout(() => {
      void get()
        .checkUpdate()
        .catch(() => undefined)
    }, 5_000)
    if (projects.length > 0) await get().openProject(projects[0].id)
  },

  async updateSettings(patch) {
    const settings = await window.isomer.invoke('settings:set', patch)
    if (patch.language) setLanguage(settings.language)
    set({ settings })
  },

  async addProject() {
    const path = await window.isomer.invoke('dialog:pick-directory', undefined)
    if (!path) return
    const r = await window.isomer.invoke('projects:add', { path })
    if (!r.ok) {
      set({ lastError: r.error })
      return
    }
    const projects = await window.isomer.invoke('projects:list', undefined)
    set({ projects })
    await get().openProject(r.data.id)
  },

  async openProject(id) {
    set({
      currentProjectId: id,
      status: null,
      log: [],
      refs: null,
      stashes: [],
      selectedPath: null,
      workingDiffText: null,
      selectedCommit: null,
      commitDiffText: null,
      commitInfo: null,
      commitSubject: '',
      commitDescription: '',
      commitAmend: false,
      snapshot: null,
      comments: [],
      selectedChangeId: null,
      patches: {},
      commentAnchor: null,
      commitBodies: {},
    })
    void window.isomer.invoke('repo:watch', { projectId: id })
    if (get().pendingTerminalInput) set({ pendingTerminalInput: null })
    await get().refreshProject(true)
  },

  async refreshProject(initial = false) {
    const id = get().currentProjectId
    if (!id) return
    const [status, log, refs, stash, snapshot, comments] = await Promise.all([
      window.isomer.invoke('git:status', { projectId: id }),
      window.isomer.invoke('git:log', { projectId: id, limit: 200 }),
      window.isomer.invoke('git:refs', { projectId: id }),
      window.isomer.invoke('git:stash-list', { projectId: id }),
      window.isomer.invoke('ism:snapshot', { projectId: id }),
      window.isomer.invoke('ism:comment-list', { projectId: id }),
    ])
    // The user may have switched projects while we awaited; never let a
    // slow response land on the wrong project.
    if (get().currentProjectId !== id) return
    set({
      status: status.ok ? status.data : null,
      log: log.ok ? log.data : [],
      refs: refs.ok ? refs.data : null,
      stashes: stash.ok ? stash.data : [],
      snapshot: snapshot.ok ? snapshot.data : null,
      comments: comments.ok ? comments.data : [],
      lastError: firstError([status, log, comments]),
    })
    const entries = get().status?.entries ?? []
    const snap = get().snapshot
    if (initial) {
      // Land where the work is: dirty worktree → changes; else a pending
      // stack → stack; else history. Refreshes never yank the view away.
      // Shot tooling may force the landing view via ?view=.
      const forced = consumeForcedView()
      if (forced === 'settings') get().openSettings()
      const view: ViewMode =
        forced && ['changes', 'history', 'stack', 'organize'].includes(forced)
          ? (forced as ViewMode)
          : entries.length > 0
            ? 'changes'
            : snap && snap.commits.length > 0
              ? 'stack'
              : 'history'
      set({ view })
    }
    // Reconcile selections with the new reality.
    const sel = get().selectedPath
    if (sel !== null && !entries.some((e) => e.path === sel)) {
      set({ selectedPath: null, workingDiffText: null })
    }
    if (entries.length > 0 && get().selectedPath === null) {
      void get().selectPath(entries[0].path)
    } else if (get().selectedPath !== null) {
      void get().selectPath(get().selectedPath, get().selectedArea)
    }
    const chosen = get().selectedChangeId
    if (snap && snap.commits.length > 0 && !snap.commits.some((c) => c.sha === chosen)) {
      get().selectChange(snap.commits[snap.commits.length - 1].sha)
    }
    const logEntries = get().log
    const selCommit = get().selectedCommit
    if (logEntries.length > 0 && !logEntries.some((e) => e.sha === selCommit)) {
      void get().selectCommit(logEntries[0].sha)
    }
  },

  setView(view) {
    set({ view })
  },

  async selectPath(path, area = 'unstaged') {
    const id = get().currentProjectId
    set({ selectedPath: path, selectedArea: area, workingDiffText: null })
    if (!id || !path) return
    const entry = get().status?.entries.find((e) => e.path === path)
    const r =
      area === 'staged'
        ? await window.isomer.invoke('git:staged-diff', { projectId: id, path })
        : await window.isomer.invoke('git:working-diff', {
            projectId: id,
            path,
            untracked: entry?.code === '??',
          })
    if (get().currentProjectId !== id || get().selectedPath !== path) return
    if (!r.ok) {
      set({ lastError: r.error })
      return
    }
    set({ workingDiffText: r.data })
  },

  async selectCommit(sha) {
    const id = get().currentProjectId
    set({ selectedCommit: sha, commitDiffText: null, commitInfo: null })
    if (!id || !sha) return
    const [diff, info] = await Promise.all([
      window.isomer.invoke('git:commit-diff', { projectId: id, sha }),
      window.isomer.invoke('git:commit-info', { projectId: id, sha }),
    ])
    if (get().currentProjectId !== id || get().selectedCommit !== sha) return
    if (!diff.ok) {
      set({ lastError: diff.error })
      return
    }
    set({ commitDiffText: diff.data, commitInfo: info.ok ? info.data : null })
  },

  setDetailTab(tab) {
    set({ detailTab: tab })
  },

  async loadCommitBody(sha) {
    const id = get().currentProjectId
    if (!id || sha in get().commitBodies) return
    const r = await window.isomer.invoke('git:commit-info', { projectId: id, sha })
    if (get().currentProjectId !== id) return
    set({ commitBodies: { ...get().commitBodies, [sha]: r.ok ? r.data.body : '' } })
  },

  async stagePaths(paths) {
    const id = get().currentProjectId
    if (!id || paths.length === 0) return
    const r = await window.isomer.invoke('git:stage', { projectId: id, paths })
    if (get().currentProjectId !== id) return
    if (!r.ok) set({ lastError: r.error })
    await get().refreshProject()
  },

  async unstagePaths(paths) {
    const id = get().currentProjectId
    if (!id || paths.length === 0) return
    const r = await window.isomer.invoke('git:unstage', { projectId: id, paths })
    if (get().currentProjectId !== id) return
    if (!r.ok) set({ lastError: r.error })
    await get().refreshProject()
  },

  setCommitField(field, value) {
    set(field === 'subject' ? { commitSubject: value } : { commitDescription: value })
  },

  setCommitAmend(amend) {
    set({ commitAmend: amend })
  },

  async doCommit() {
    const id = get().currentProjectId
    const subject = get().commitSubject.trim()
    if (!id || subject === '' || get().committing) return
    set({ committing: true })
    const r = await window.isomer.invoke('git:commit', {
      projectId: id,
      subject,
      description: get().commitDescription,
      amend: get().commitAmend,
    })
    if (get().currentProjectId !== id) {
      set({ committing: false })
      return
    }
    if (!r.ok) {
      set({ lastError: r.error, committing: false })
      return
    }
    set({ commitSubject: '', commitDescription: '', commitAmend: false, committing: false })
    await get().refreshProject()
  },

  async doStash() {
    const id = get().currentProjectId
    if (!id) return
    const r = await window.isomer.invoke('git:stash', { projectId: id })
    if (get().currentProjectId !== id) return
    if (!r.ok) {
      set({ lastError: r.error })
      return
    }
    set({ netNote: r.data })
    await get().refreshProject()
  },

  async branchOp(op) {
    const id = get().currentProjectId
    if (!id) return
    const r =
      op.kind === 'checkout'
        ? await window.isomer.invoke('git:checkout', { projectId: id, branch: op.branch })
        : op.kind === 'create'
          ? await window.isomer.invoke('git:branch-create', {
              projectId: id,
              name: op.name,
              from: op.from,
            })
          : op.kind === 'rename'
            ? await window.isomer.invoke('git:branch-rename', {
                projectId: id,
                from: op.from,
                to: op.to,
              })
            : await window.isomer.invoke('git:branch-delete', { projectId: id, name: op.name })
    if (!r.ok) {
      set({ lastError: r.error })
      return
    }
    await get().refreshProject()
  },

  async runNet(verb, opts) {
    const id = get().currentProjectId
    if (!id || get().netBusy) return
    set({ netBusy: verb, netNote: null })
    const r =
      verb === 'push'
        ? await window.isomer.invoke('git:push', {
            projectId: id,
            forceWithLease: opts?.forceWithLease ?? false,
          })
        : await window.isomer.invoke(`git:${verb}`, { projectId: id })
    if (get().currentProjectId !== id) {
      set({ netBusy: null })
      return
    }
    set({ netBusy: null, netNote: r.ok ? r.data : null, lastError: r.ok ? null : r.error })
    if (verb !== 'fetch') await get().refreshProject()
  },

  selectChange(id) {
    set({ selectedChangeId: id, commentAnchor: null })
    const projectId = get().currentProjectId
    const snapshot = get().snapshot
    if (!projectId || !snapshot || !id) return
    const commit = snapshot.commits.find((c) => c.sha === id)
    if (!commit) return
    const missing = commit.hunks.filter((h) => !(h in get().patches))
    if (missing.length === 0) return
    void window.isomer
      .invoke('ism:hunks', { projectId, ids: missing })
      .then((r) => {
        if (get().currentProjectId !== projectId) return
        if (!r.ok) {
          set({ lastError: r.error })
          return
        }
        const patches = { ...get().patches }
        for (const hp of r.data) patches[hp.id] = hp.patch
        set({ patches })
      })
  },

  setCommentAnchor(anchor) {
    set({ commentAnchor: anchor })
  },

  async addComment(input) {
    const id = get().currentProjectId
    if (!id) return
    const r = await window.isomer.invoke('ism:comment-add', { projectId: id, ...input })
    if (get().currentProjectId !== id) return
    if (!r.ok) {
      set({ lastError: r.error })
      return
    }
    set({ comments: [...get().comments, r.data] })
  },

  async resolveComment(commentId) {
    const id = get().currentProjectId
    if (!id) return
    const r = await window.isomer.invoke('ism:comment-resolve', { projectId: id, id: commentId })
    if (get().currentProjectId !== id) return
    if (!r.ok) {
      set({ lastError: r.error })
      return
    }
    set({ comments: get().comments.map((c) => (c.id === r.data.id ? r.data : c)) })
  },

  toggleSidebar() {
    const collapsed = !get().sidebarCollapsed
    storage.set('sidebarCollapsed', collapsed ? '1' : '0')
    set({ sidebarCollapsed: collapsed })
  },

  toggleTerminal() {
    const opening = !get().terminalOpen
    // Closing drops any queued (never-delivered) agent command with it.
    set(opening ? { terminalOpen: true } : { terminalOpen: false, pendingTerminalInput: null })
  },

  summonAgent() {
    const cmd = get().settings.agentCommand.trim() || 'claude'
    const prompt = i18next.t('inspector.agentPrompt')
    // Pre-fill, never execute: the user reviews and presses Enter.
    set({ pendingTerminalInput: `${cmd} "${prompt}"`, terminalOpen: true })
  },

  clearPendingTerminalInput() {
    set({ pendingTerminalInput: null })
  },

  setTerminalDock(dock) {
    storage.set('terminalDock', dock)
    set({ terminalDock: dock })
  },

  async checkUpdate() {
    if (get().updateStatus === 'checking') return
    set({ updateStatus: 'checking' })
    const r = await window.isomer.invoke('update:check', undefined)
    if (!r.ok) {
      set({ updateStatus: 'error' })
      return
    }
    set({ updateStatus: 'idle', updateInfo: r.data })
  },

  async detectIsm() {
    // Probing bad candidates can take seconds; never let a slow stale
    // probe overwrite a fresher result.
    const seq = ++detectSeq
    const d = await window.isomer.invoke('ism:detect', undefined)
    if (seq !== detectSeq) return
    set({ ismDetection: d })
  },

  async openExternal(url) {
    const r = await window.isomer.invoke('shell:open-external', { url })
    if (!r.ok) set({ lastError: r.error })
  },

  openSettings() {
    set({ settingsOpen: true })
    if (get().ismDetection === undefined) void get().detectIsm()
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  setError(error) {
    set({ lastError: error })
  },

  clearError() {
    set({ lastError: null })
  },
}))

/** First failure among results, if any — snapshot errors are expected on
 * trunk (empty stack) and are not surfaced as errors. */
export function firstError(
  results: ({ ok: true } | { ok: false; error: AppError })[],
): AppError | null {
  for (const r of results) {
    if (!r.ok) return r.error
  }
  return null
}
