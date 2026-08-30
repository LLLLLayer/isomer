import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowLeft,
  DownloadCloud,
  FolderOpen,
  Pin,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { Project, ProjectHealth } from '../../shared/ipc'
import { groupProjects } from '../repos'
import { useAppStore } from '../store/store'
import { relTime } from '../time'

/** The repository manager: every registered repo with live health badges
 * (branch, dirty count, ahead/behind), pinned and grouped sections, and
 * clone/add flows. One window, many repos — switching stays instant. */
export function RepoManager(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.managerOpen)
  const close = useAppStore((s) => s.closeManager)
  const projects = useAppStore((s) => s.projects)
  const overview = useAppStore((s) => s.overview)
  const loadOverview = useAppStore((s) => s.loadOverview)
  const currentId = useAppStore((s) => s.currentProjectId)
  const openProject = useAppStore((s) => s.openProject)
  const addProject = useAppStore((s) => s.addProject)
  const updateProject = useAppStore((s) => s.updateProject)
  const removeProject = useAppStore((s) => s.removeProject)
  const cloneRepo = useAppStore((s) => s.cloneRepo)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloning, setCloning] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  if (!open) return null

  const grouped = groupProjects(projects)

  const clone = async (): Promise<void> => {
    const url = cloneUrl.trim()
    if (!url || cloning) return
    setCloning(true)
    const ok = await cloneRepo(url)
    setCloning(false)
    if (ok) {
      setCloneUrl('')
      close()
    }
  }

  const pick = async (id: string): Promise<void> => {
    await openProject(id)
    close()
  }

  const commitGroup = (p: Project, raw: string): void => {
    const next = raw.trim()
    if (next !== (p.group ?? '')) void updateProject(p.id, { group: next || null })
  }

  const row = (p: Project): React.JSX.Element => {
    const h: ProjectHealth | undefined = overview[p.id]
    return (
      <div key={p.id} className={`repo-row${p.id === currentId ? ' active' : ''}`}>
        <button
          className={`icon-btn pin${p.pinned ? ' on' : ''}`}
          title={p.pinned ? t('manager.unpin') : t('manager.pin')}
          onClick={() => void updateProject(p.id, { pinned: p.pinned !== true })}
        >
          <Pin size={13} strokeWidth={1.8} />
        </button>
        <button className="repo-main" onClick={() => void pick(p.id)}>
          <span className="repo-name">{p.name}</span>
          <span className="repo-path mono">{p.path}</span>
        </button>
        <span className="repo-badges">
          {h?.missing === true && (
            <span className="badge warn" title={t('manager.missing')}>
              <AlertTriangle size={10} strokeWidth={2} /> {t('manager.missingShort')}
            </span>
          )}
          {h && !h.missing && (
            <>
              {h.branch !== null && <span className="ref-badge">{h.branch}</span>}
              {h.dirty > 0 && (
                <span className="badge" title={t('manager.dirty', { count: h.dirty })}>
                  ±{h.dirty}
                </span>
              )}
              {h.ahead > 0 && <span className="badge">↑{h.ahead}</span>}
              {h.behind > 0 && <span className="badge">↓{h.behind}</span>}
            </>
          )}
          <span className="muted">{relTime(p.lastOpenedAt / 1000, t)}</span>
        </span>
        <input
          className="repo-group mono"
          placeholder={t('manager.groupPlaceholder')}
          defaultValue={p.group ?? ''}
          onBlur={(e) => commitGroup(p, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitGroup(p, e.currentTarget.value)
          }}
        />
        {confirmRemove === p.id ? (
          <button
            className="ghost-btn danger"
            onClick={() => {
              setConfirmRemove(null)
              void removeProject(p.id)
            }}
          >
            {t('manager.removeSure')}
          </button>
        ) : (
          <button
            className="icon-btn"
            title={t('manager.remove')}
            onClick={() => {
              setConfirmRemove(p.id)
              setTimeout(() => setConfirmRemove((c) => (c === p.id ? null : c)), 3000)
            }}
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="settings-page repo-manager">
      <header className="settings-top">
        <button className="icon-btn labeled" onClick={close}>
          <ArrowLeft size={14} strokeWidth={1.8} />
          {t('settings.back')}
        </button>
        <span className="settings-title">{t('manager.title')}</span>
        <span className="spacer" />
        <button className="icon-btn labeled" title={t('manager.refresh')} onClick={() => void loadOverview()}>
          <RefreshCw size={13} strokeWidth={1.8} /> {t('manager.refresh')}
        </button>
        <button
          className="icon-btn labeled"
          onClick={() => void addProject().then(() => loadOverview())}
        >
          <FolderOpen size={13} strokeWidth={1.8} /> {t('manager.addExisting')}
        </button>
      </header>
      <div className="manager-body">
        <div className="clone-row">
          <DownloadCloud size={14} strokeWidth={1.8} />
          <input
            className="settings-input mono"
            placeholder={t('manager.clonePlaceholder')}
            value={cloneUrl}
            onChange={(e) => setCloneUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void clone()
            }}
          />
          <button
            className="primary-btn"
            disabled={cloning || cloneUrl.trim() === ''}
            onClick={() => void clone()}
          >
            {cloning ? t('manager.cloning') : t('manager.clone')}
          </button>
        </div>
        {grouped.pinned.length > 0 && (
          <section className="repo-section">
            <h4>{t('manager.pinned')}</h4>
            {grouped.pinned.map(row)}
          </section>
        )}
        {grouped.groups.map(([name, list]) => (
          <section key={name} className="repo-section">
            <h4>{name}</h4>
            {list.map(row)}
          </section>
        ))}
        <section className="repo-section">
          <h4>{t('manager.recent')}</h4>
          {grouped.rest.length === 0 && grouped.pinned.length === 0 && grouped.groups.length === 0 && (
            <p className="empty">{t('manager.empty')}</p>
          )}
          {grouped.rest.map(row)}
        </section>
      </div>
    </div>
  )
}
