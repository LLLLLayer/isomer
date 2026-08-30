import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight, ExternalLink, GitPullRequest, X } from 'lucide-react'
import type { StackPreview, StackSubmitOutcome } from '../../shared/ipc'
import { useAppStore } from '../store/store'

/** Submit/sync the change stack as a GitHub PR chain: one branch per
 * change, each PR based on the one below. Identities (change ids) — not
 * branch names or shas — match PRs across re-applies, so a reorganize
 * that rewrites every commit still syncs onto the same chain. */
export function SubmitStackModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const comments = useAppStore((s) => s.comments)
  const openExternal = useAppStore((s) => s.openExternal)
  const [preview, setPreview] = useState<StackPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<StackSubmitOutcome | null>(null)

  const busyRef = busy
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Closing mid-submit would orphan the outcome (and invite a second
      // concurrent run); the chain finishes or fails first.
      if (e.key === 'Escape' && !busyRef) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busyRef])

  const loadPreview = (id: string): void => {
    void window.isomer.invoke('stack:preview', { projectId: id }).then((r) => {
      if (useAppStore.getState().currentProjectId !== id) return
      if (r.ok) setPreview(r.data)
      else setError(`${r.error.code}: ${r.error.message}${r.error.hint ? ` — ${r.error.hint}` : ''}`)
    })
  }
  useEffect(() => {
    if (projectId) loadPreview(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const unresolved = comments.filter((c) => !c.resolved).length

  const submit = async (): Promise<void> => {
    if (!projectId || busy) return
    setBusy(true)
    setError(null)
    const r = await window.isomer.invoke('stack:submit', { projectId })
    setBusy(false)
    if (r.ok) {
      setOutcome(r.data)
    } else {
      setError(`${r.error.code}: ${r.error.message}${r.error.hint ? ` — ${r.error.hint}` : ''}`)
      // A mid-chain failure changed remote state; the shown plan is stale.
      setPreview(null)
      loadPreview(projectId)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <span className="insight-title">
            <GitPullRequest size={13} strokeWidth={1.8} /> {t('stack.submitTitle')}
          </span>
          <span className="spacer" />
          <button
            className="icon-btn"
            disabled={busy}
            onClick={() => !busy && onClose()}
            title={t('settings.close')}
          >
            <X size={15} />
          </button>
        </header>
        <div className="insight-body stackpr">
          {error !== null && <p className="stackpr-error">{error}</p>}
          {preview === null && error === null && <p className="empty">…</p>}
          {preview && outcome === null && (
            <>
              {preview.gh !== 'ok' && (
                <p className="stackpr-warn">
                  <AlertTriangle size={12} strokeWidth={2} />{' '}
                  {preview.gh === 'missing' ? t('stack.ghMissing') : t('stack.ghUnauth')}
                </p>
              )}
              {unresolved > 0 && (
                <p className="stackpr-warn">
                  <AlertTriangle size={12} strokeWidth={2} />{' '}
                  {t('stack.unresolvedWarn', { count: unresolved })}
                </p>
              )}
              <ol className="stackpr-list">
                {preview.actions.map((a) => (
                  <li key={a.id}>
                    <span className={`stackpr-kind ${a.kind}`}>
                      {a.kind === 'create'
                        ? t('stack.willCreate')
                        : t('stack.willUpdate', { number: a.number })}
                    </span>
                    <span className="mono">{a.branch}</span>
                    <ArrowRight size={11} strokeWidth={2} className="muted" />
                    <span className="mono muted">{a.base}</span>
                    <span className="stackpr-summary">{a.summary}</span>
                    {a.retarget && (
                      <span className="stackpr-retarget">
                        {t('stack.retargetTo', { base: a.retarget })}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {preview.orphans.length > 0 && (
                <p className="stackpr-warn">
                  {preview.orphans
                    .map((o) => t('stack.orphanNote', { number: o.number, branch: o.branch }))
                    .join(' ')}
                </p>
              )}
            </>
          )}
          {outcome && (
            <ol className="stackpr-list">
              {outcome.results.map((r) => (
                <li key={r.id}>
                  <span className="stackpr-kind create">
                    {r.number !== null ? `#${r.number}` : '—'}
                  </span>
                  <span className="mono">{r.branch}</span>
                  <span className="spacer" />
                  {r.url && (
                    <button
                      className="icon-btn labeled"
                      onClick={() => r.url && void openExternal(r.url)}
                    >
                      <ExternalLink size={11} strokeWidth={1.8} /> {t('stack.viewPr')}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <footer className="stackpr-footer">
          {outcome ? (
            <>
              <span className="muted">{t('stack.doneNote')}</span>
              <span className="spacer" />
              <button className="primary-btn" onClick={onClose}>
                {t('settings.close')}
              </button>
            </>
          ) : (
            <>
              <span className="muted">
                {preview ? t('stack.trunkNote', { trunk: preview.trunk }) : ''}
              </span>
              <span className="spacer" />
              <button
                className="primary-btn"
                disabled={busy || preview === null || preview.gh !== 'ok'}
                onClick={() => void submit()}
              >
                {busy
                  ? t('stack.submitting')
                  : t('stack.submitRun', { count: preview?.actions.length ?? 0 })}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
