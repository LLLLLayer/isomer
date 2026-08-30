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
  const [draft, setDraft] = useState('')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)

  const commit = snapshot?.commits.find((c) => c.sha === selected)
  const changeId = commit?.change_id ?? null
  // No selection ⇒ all comments; a selected but untracked commit has no
  // identity, so nothing can be anchored to it.
  const visible = (commit && !changeId ? [] : comments)
    .filter((c) => (changeId ? c.change === changeId : true))
    .filter((c) => !unresolvedOnly || !c.resolved)

  return (
    <aside className="pane inspector">
      <header className="pane-title">{t('inspector.title')}</header>
      <section>
        <h3>
          {t('inspector.comments')}
          <label className="muted toggle-label">
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
            <li key={c.id} className={`comment${c.resolved ? ' resolved' : ''}`}>
              <div className="comment-head mono muted">
                {c.author_name} · {c.path ? `${c.path}:${c.line ?? ''}` : c.change}
              </div>
              <div className="comment-body">{c.body}</div>
              {!c.resolved && (
                <button className="link" onClick={() => void resolveComment(c.id)}>
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
              void addComment({ change: changeId, body: draft })
              setDraft('')
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder={t('inspector.addComment')}
            />
            <button type="submit">{t('inspector.addComment')}</button>
          </form>
        )}
      </section>
    </aside>
  )
}
