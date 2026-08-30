import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Copy, CornerDownRight, X } from 'lucide-react'
import type { Comment } from '../../shared/ism-types'
import { useAppStore } from '../store/store'
import { relTime } from '../time'

/** Detail pane: the selected change's comment threads (summary view — the
 * diff shows them inline at their lines), a composer, and the agent hook. */
export function Inspector(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const selected = useAppStore((s) => s.selectedChangeId)
  const comments = useAppStore((s) => s.comments)
  const addComment = useAppStore((s) => s.addComment)
  const resolveComment = useAppStore((s) => s.resolveComment)
  const anchor = useAppStore((s) => s.commentAnchor)
  const setCommentAnchor = useAppStore((s) => s.setCommentAnchor)
  const summonAgent = useAppStore((s) => s.summonAgent)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)

  const log = useAppStore((s) => s.log)
  const selectedCommit = useAppStore((s) => s.selectedCommit)
  const fallback = snapshot !== null && snapshot.commits.length === 0
  const commit = snapshot?.commits.find((c) => c.sha === selected)
  const changeId = fallback
    ? (log.find((e) => e.sha === selectedCommit)?.changeId ?? null)
    : (commit?.change_id ?? null)
  // No selection ⇒ all comments; a selected but untracked commit (stack or
  // fallback mode) has no identity, so nothing can be anchored to it.
  const noIdentity = (commit !== undefined || (fallback && selectedCommit !== null)) && !changeId
  const scoped = (noIdentity ? [] : comments).filter((c) =>
    changeId ? c.change === changeId : true,
  )
  // Resolution is a thread property: filters and counts look at top-level
  // comments only, and replies always travel with their parent.
  const topLevel = scoped
    .filter((c) => !c.parent)
    .filter((c) => !unresolvedOnly || !c.resolved)
  const visible = topLevel.flatMap((parent) => [
    parent,
    ...scoped.filter((c) => c.parent === parent.id),
  ])
  const unresolvedCount = scoped.filter((c) => !c.parent && !c.resolved).length

  const asMarkdown = (list: Comment[]): string =>
    list
      .map((c) => {
        const where = c.path ? `${c.path}${typeof c.line === 'number' ? `:${c.line}` : ''}` : ''
        const head = [c.resolved ? '[x]' : '[ ]', where, `@${c.author_name}`]
          .filter(Boolean)
          .join(' ')
        const body = c.body.replace(/\n/g, c.parent ? '\n    ' : '\n  ')
        return `${c.parent ? '  - ' : '- '}${head}: ${body}`
      })
      .join('\n')

  const anchorOf = (c: Comment): string =>
    c.path ? `${c.path}${typeof c.line === 'number' ? `:${c.line}` : ''}` : t('inspector.wholeChange')

  return (
    <aside className="pane inspector">
      <header className="pane-title">
        {t('inspector.title')}
        <span className="spacer" />
        {visible.length > 0 && (
          <button
            className="icon-btn"
            title={t('inspector.copyAll')}
            onClick={() => void navigator.clipboard.writeText(asMarkdown(visible))}
          >
            <Copy size={13} strokeWidth={1.8} />
          </button>
        )}
      </header>
      <div className="inspector-tools">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={unresolvedOnly}
            onChange={(e) => setUnresolvedOnly(e.target.checked)}
          />
          {t('inspector.unresolvedOnly')}
        </label>
        <span className="spacer" />
        {unresolvedCount > 0 && (
          <button className="ghost-btn" onClick={() => summonAgent()}>
            <Bot size={12} strokeWidth={1.8} /> {t('inspector.fixWithAgent')}
          </button>
        )}
      </div>
      <div className="inspector-scroll">
        {visible.length === 0 && <p className="empty">{t('inspector.noComments')}</p>}
        <ul className="comment-list">
          {visible.map((c) => (
            <li
              key={c.id}
              className={`comment${c.resolved ? ' resolved' : ''}${c.parent ? ' reply' : ''}`}
            >
              <div className="comment-head">
                <span className="author">{c.author_name}</span>
                <span className="time muted">{relTime(c.created_at, t)}</span>
                <span className="spacer" />
                <button
                  className="icon-btn"
                  title={t('inspector.copy')}
                  onClick={() => void navigator.clipboard.writeText(c.body)}
                >
                  <Copy size={12} strokeWidth={1.8} />
                </button>
              </div>
              {c.path && (
                <button
                  className="comment-anchor mono"
                  onClick={() =>
                    typeof c.line === 'number' &&
                    c.path &&
                    setCommentAnchor({ path: c.path, line: c.line })
                  }
                >
                  {anchorOf(c)}
                </button>
              )}
              <div className="comment-body">{c.body}</div>
              <div className="comment-actions">
                {!c.parent && changeId && (
                  <button className="ghost-btn" onClick={() => setReplyTo(c)}>
                    <CornerDownRight size={12} strokeWidth={1.8} /> {t('inspector.reply')}
                  </button>
                )}
                {!c.resolved && !c.parent && (
                  <button className="ghost-btn" onClick={() => void resolveComment(c.id)}>
                    {t('inspector.resolve')}
                  </button>
                )}
              </div>
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
                change: replyTo ? replyTo.change : changeId,
                body: draft,
                path: replyTo ? undefined : anchor?.path,
                line: replyTo ? undefined : anchor?.line,
                replyTo: replyTo?.id,
              })
              setDraft('')
              setReplyTo(null)
              setCommentAnchor(null)
            }}
          >
            {replyTo && (
              <span className="anchor-chip">
                <CornerDownRight size={11} strokeWidth={1.8} />
                <span>{t('inspector.replyTo', { author: replyTo.author_name })}</span>
                <button type="button" onClick={() => setReplyTo(null)}>
                  <X size={11} strokeWidth={2} />
                </button>
              </span>
            )}
            {!replyTo && anchor && (
              <span className="anchor-chip">
                <span className="mono">
                  {anchor.path}:{anchor.line}
                </span>
                <button type="button" onClick={() => setCommentAnchor(null)}>
                  <X size={11} strokeWidth={2} />
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
      </div>
    </aside>
  )
}
