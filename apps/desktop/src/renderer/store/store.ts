import { create } from 'zustand'
import type { GitLogEntry, GitStatusSummary, Project } from '../../shared/ipc'
import type { Comment, Snapshot } from '../../shared/ism-types'
import type { AppError } from '../../shared/result'
import type { Settings } from '../../shared/theme'
import { DEFAULT_SETTINGS } from '../../shared/theme'
import { setLanguage } from '../i18n'

export interface AppState {
  settings: Settings
  projects: Project[]
  currentProjectId: string | null
  status: GitStatusSummary | null
  log: GitLogEntry[]
  snapshot: Snapshot | null
  comments: Comment[]
  selectedChangeId: string | null
  /** Patch text per hunk id, fetched on change selection. */
  patches: Record<string, string>
  /** Pending file/line anchor for the next comment (set from the diff). */
  commentAnchor: { path: string; line: number } | null
  terminalOpen: boolean
  lastError: AppError | null

  bootstrap(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  addProject(): Promise<void>
  openProject(id: string): Promise<void>
  refreshProject(): Promise<void>
  selectChange(id: string | null): void
  addComment(input: { change: string; body: string; path?: string; line?: number; replyTo?: string }): Promise<void>
  resolveComment(id: string): Promise<void>
  toggleTerminal(): void
  setError(error: AppError): void
  clearError(): void
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  projects: [],
  currentProjectId: null,
  status: null,
  log: [],
  snapshot: null,
  comments: [],
  selectedChangeId: null,
  patches: {},
  commentAnchor: null,
  terminalOpen: false,
  lastError: null,

  async bootstrap() {
    const [settings, projects] = await Promise.all([
      window.isomer.invoke('settings:get', undefined),
      window.isomer.invoke('projects:list', undefined),
    ])
    setLanguage(settings.language)
    set({ settings, projects })
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
      snapshot: null,
      comments: [],
      selectedChangeId: null,
      patches: {},
      commentAnchor: null,
    })
    await get().refreshProject()
  },

  async refreshProject() {
    const id = get().currentProjectId
    if (!id) return
    const [status, log, snapshot, comments] = await Promise.all([
      window.isomer.invoke('git:status', { projectId: id }),
      window.isomer.invoke('git:log', { projectId: id, limit: 100 }),
      window.isomer.invoke('ism:snapshot', { projectId: id }),
      window.isomer.invoke('ism:comment-list', { projectId: id }),
    ])
    // The user may have switched projects while we awaited; never let a
    // slow response land on the wrong project.
    if (get().currentProjectId !== id) return
    set({
      status: status.ok ? status.data : null,
      log: log.ok ? log.data : [],
      snapshot: snapshot.ok ? snapshot.data : null,
      comments: comments.ok ? comments.data : [],
      lastError: firstError([status, log, comments]),
    })
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

  toggleTerminal() {
    set({ terminalOpen: !get().terminalOpen })
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
