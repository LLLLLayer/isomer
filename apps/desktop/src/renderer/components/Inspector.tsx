import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/store'

export function Inspector(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const selected = useAppStore((s) => s.selectedChangeId)
  const comments = useAppStore((s) => s.comments)
  const addComment = useAppStore((s) => s.addComment)
  const resolveComment = useAppStore((s) => s.resolveComment)
  const anchor = useAppStore((s) => s.commentAnchor)
  const setCommentAnchor = useAppStore((s) => s.setCommentAnchor)
  const [draft, setDraft] = useState('')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)

  const log = useAppStore((s) => s.log)
  const selectedCommit = useAppStore((s) => s.selectedCommit)
  const fallback = snapshot !== null && snapshot.commits.length === 0
  const commit = snapshot?.commits.find((c) => c.sha === selected)
  const changeId = fallback
    ? (log.find((e) => e.sha === selectedCommit)?.changeId ?? null)
    : (commit?.change_id ?? null)
  // No selection ⇒ all comments; a selected but untracked commit has no
  // identity, so nothing can be anchored to it.
  const filtered = (commit && !changeId ? [] : comments)
    .filter((c) => (changeId ? c.change === changeId : true))
    .filter((c) => !unresolvedOnly || !c.resolved)
  // Thread order: top-level comments in arrival order, each followed by its
  // replies (same-second timestamps would otherwise interleave threads).
  const topLevel = filtered.filter((c) => !c.parent)
  const visible = topLevel.flatMap((parent) => [
    parent,
    ...filtered.filter((c) => c.parent === parent.id),
  ])

  return (
    <aside className="pane inspector">
      <header className="pane-title">{t('inspector.title')}</header>
      <section>
        <h3>
          {t('inspector.comments')}
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={unresolvedOnly}
              onChange={(e) => setUnresolvedOnly(e.target.checked)}
            />
            {t('inspector.unresolvedOnly')}
          </label>
        </h3>
        {visible.length === 0 && <p className="empty">{t('inspector.noComments')}</p>}
        <ul className="comment-list">
          {visible.map((c) => (
            <li
              key={c.id}
              className={`comment${c.resolved ? ' resolved' : ''}${c.parent ? ' reply' : ''}`}
            >
              <div className="comment-head">
                <span className="author">{c.author_name}</span>
                <span className="anchor">{c.path ? `${c.path}:${c.line ?? ''}` : c.change}</span>
              </div>
              <div className="comment-body">{c.body}</div>
              {!c.resolved && (
                <button className="ghost-btn" onClick={() => void resolveComment(c.id)}>
                  {t('inspector.resolve')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {changeId && (
          <form
            className="comment-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim() === '') return
              void addComment({
                change: changeId,
                body: draft,
                path: anchor?.path,
                line: anchor?.line,
              })
              setDraft('')
              setCommentAnchor(null)
            }}
          >
            {anchor && (
              <span className="anchor-chip">
                <span className="mono">
                  {anchor.path}:{anchor.line}
                </span>
                <button type="button" onClick={() => setCommentAnchor(null)}>
                  ×
                </button>
              </span>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder={t('inspector.addComment')}
            />
            <button type="submit" className="primary-btn" disabled={draft.trim() === ''}>
              {t('inspector.addComment')}
            </button>
          </form>
        )}
      </section>
    </aside>
  )
}
