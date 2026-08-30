import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { BlameLine, BranchCompare, GitLogEntry, ReflogEntry } from '../../shared/ipc'
import { parseUnifiedDiff } from '../diff'
import { useAppStore } from '../store/store'
import { relTime } from '../time'
import { DiffView } from './DiffView'

/** Shared shell: a wide modal with a title bar and scrollable body. */
export function Wide({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <span className="insight-title">{title}</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} title={t('settings.close')}>
            <X size={15} />
          </button>
        </header>
        <div className="insight-body">{children}</div>
      </div>
    </div>
  )
}

/** Commit list for a single file (--follow); click shows that commit's
 * diff filtered down to the file. */
export function FileHistoryModal({
  path,
  onClose,
}: {
  path: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const [log, setLog] = useState<GitLogEntry[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('git:file-history', { projectId, path, limit: 100 })
      .then((r) => setLog(r.ok ? r.data : []))
  }, [projectId, path])

  useEffect(() => {
    if (!projectId || !picked) return
    setDiff(null)
    void window.isomer
      .invoke('git:commit-diff', { projectId, sha: picked })
      .then((r) => setDiff(r.ok ? r.data : ''))
  }, [projectId, picked])

  const files = diff === null ? [] : parseUnifiedDiff(diff).filter((f) => f.path === path)
  return (
    <Wide title={`${t('files.history')} · ${path}`} onClose={onClose}>
      <div className="insight-split">
        <div className="insight-list">
          {log === null && <p className="empty">…</p>}
          {log?.map((e) => (
            <button
              key={e.sha}
              className={`insight-row${e.sha === picked ? ' active' : ''}`}
              onClick={() => setPicked(e.sha)}
            >
              <span className="summary">{e.title}</span>
              <span className="muted">
                {e.authorName} · {relTime(e.timestamp, t)} · <span className="mono">{e.sha.slice(0, 7)}</span>
              </span>
            </button>
          ))}
          {log !== null && log.length === 0 && <p className="empty">{t('insight.none')}</p>}
        </div>
        <div className="insight-detail">
          {picked === null ? (
            <p className="empty">{t('history.pickFile')}</p>
          ) : diff === null ? (
            <p className="empty">…</p>
          ) : (
            <DiffView files={files} />
          )}
        </div>
      </div>
    </Wide>
  )
}

/** Line-by-line authorship; sha-tinted gutter, jump-worthy summaries. */
export function BlameModal({
  path,
  onClose,
}: {
  path: string
  onClose: () => void
}): React.JSX.Element {
  const projectId = useAppStore((s) => s.currentProjectId)
  const [lines, setLines] = useState<BlameLine[] | null>(null)

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('git:blame', { projectId, path })
      .then((r) => setLines(r.ok ? r.data : []))
  }, [projectId, path])

  let last = ''
  return (
    <Wide title={`Blame · ${path}`} onClose={onClose}>
      {lines === null && <p className="empty">…</p>}
      {lines !== null && (
        <div className="blame-table mono">
          {lines.map((l) => {
            const first = l.sha !== last
            last = l.sha
            return (
              <div key={l.line} className={`blame-row${first ? ' first' : ''}`}>
                <span className="blame-meta" title={`${l.summary} · ${l.author}`}>
                  {first ? `${l.sha.slice(0, 7)} ${l.author}` : ''}
                </span>
                <span className="lineno">{l.line}</span>
                <span className="code">{l.text}</span>
              </div>
            )
          })}
        </div>
      )}
    </Wide>
  )
}

/** Ahead/behind commit lists between the current branch and another. */
export function CompareModal({
  branch,
  onClose,
}: {
  branch: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const current = useAppStore((s) => s.refs?.current ?? 'HEAD')
  const [cmp, setCmp] = useState<BranchCompare | null>(null)

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('git:branch-compare', { projectId, branch })
      .then((r) => setCmp(r.ok ? r.data : { ahead: [], behind: [] }))
  }, [projectId, branch])

  const list = (title: string, entries: GitLogEntry[]): React.JSX.Element => (
    <div className="insight-list">
      <h4>{title}</h4>
      {entries.length === 0 && <p className="empty">{t('insight.none')}</p>}
      {entries.map((e) => (
        <div key={e.sha} className="insight-row static">
          <span className="summary">{e.title}</span>
          <span className="muted">
            {e.authorName} · <span className="mono">{e.sha.slice(0, 7)}</span>
          </span>
        </div>
      ))}
    </div>
  )
  return (
    <Wide title={t('compare.title', { a: current, b: branch })} onClose={onClose}>
      {cmp === null ? (
        <p className="empty">…</p>
      ) : (
        <div className="insight-split even">
          {list(t('compare.ahead', { branch, count: cmp.ahead.length }), cmp.ahead)}
          {list(t('compare.behind', { branch, count: cmp.behind.length }), cmp.behind)}
        </div>
      )}
    </Wide>
  )
}

/** One stash: its diff plus apply / pop / drop. */
export function StashModal({
  index,
  message,
  onClose,
}: {
  index: number
  message: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const refreshProject = useAppStore((s) => s.refreshProject)
  const setError = useAppStore((s) => s.setError)
  const [diff, setDiff] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('git:stash-diff', { projectId, index })
      .then((r) => setDiff(r.ok ? r.data : ''))
  }, [projectId, index])

  const act = (
    p: Promise<{ ok: true; data: unknown } | { ok: false; error: import('../../shared/result').AppError }>,
  ): void => {
    void p.then((r) => {
      if (!r.ok) setError(r.error)
      void refreshProject()
      onClose()
    })
  }

  return (
    <Wide title={`stash@{${index}} · ${message}`} onClose={onClose}>
      <div className="stash-actions">
        <button
          className="ghost-btn"
          onClick={() =>
            projectId && act(window.isomer.invoke('git:stash-apply', { projectId, index, pop: false }))
          }
        >
          {t('stash.apply')}
        </button>
        <button
          className="ghost-btn"
          onClick={() =>
            projectId && act(window.isomer.invoke('git:stash-apply', { projectId, index, pop: true }))
          }
        >
          {t('stash.pop')}
        </button>
        <button
          className="ghost-btn danger"
          onClick={() =>
            projectId && act(window.isomer.invoke('git:stash-drop', { projectId, index }))
          }
        >
          {t('stash.drop')}
        </button>
      </div>
      {diff === null ? <p className="empty">…</p> : <DiffView files={parseUnifiedDiff(diff)} />}
    </Wide>
  )
}

/** Read-only reflog: the safety net, one copyable sha per step. */
export function ReflogModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null)

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('git:reflog', { projectId, limit: 100 })
      .then((r) => setEntries(r.ok ? r.data : []))
  }, [projectId])

  return (
    <Wide title={t('reflog.title')} onClose={onClose}>
      {entries === null && <p className="empty">…</p>}
      {entries !== null && (
        <div className="insight-list">
          {entries.map((e) => (
            <div key={e.selector} className="insight-row static">
              <span className="summary">{e.action}</span>
              <span className="muted">
                {e.selector} · {relTime(e.timestamp, t)} ·{' '}
                <button
                  className="link mono"
                  onClick={() => void navigator.clipboard.writeText(e.sha)}
                  title={t('inspector.copy')}
                >
                  {e.sha.slice(0, 10)}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Wide>
  )
}
