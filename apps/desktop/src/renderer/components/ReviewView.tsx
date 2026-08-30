import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Comment } from '../../shared/ism-types'
import type { FileDiff } from '../diff'
import { parseHunkPatch, parseUnifiedDiff } from '../diff'
import { useAppStore } from '../store/store'
import type { ReviewHooks } from './DiffView'
import { DiffView } from './DiffView'

/** CR area. Stack mode renders the selected change's hunks; on the trunk
 * (no pending stack) it renders the picked history commit instead. Both
 * paths share DiffView with line anchoring and inline comment threads. */
export function ReviewView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const selected = useAppStore((s) => s.selectedChangeId)
  const patches = useAppStore((s) => s.patches)
  const comments = useAppStore((s) => s.comments)
  const anchor = useAppStore((s) => s.commentAnchor)
  const setCommentAnchor = useAppStore((s) => s.setCommentAnchor)
  const addComment = useAppStore((s) => s.addComment)
  const resolveComment = useAppStore((s) => s.resolveComment)
  const log = useAppStore((s) => s.log)
  const selectedCommit = useAppStore((s) => s.selectedCommit)
  const commitDiffText = useAppStore((s) => s.commitDiffText)

  const fallback = snapshot !== null && snapshot.commits.length === 0
  const commit = snapshot?.commits.find((c) => c.sha === selected)
  const changeId = fallback
    ? (log.find((e) => e.sha === selectedCommit)?.changeId ?? null)
    : (commit?.change_id ?? null)

  const hooks = (id: string): ReviewHooks => ({
    anchor,
    onAnchor: (path, line) => {
      if (anchor && anchor.path === path && anchor.line === line) setCommentAnchor(null)
      else setCommentAnchor({ path, line })
    },
    comments: comments.filter((c) => c.change === id),
    onResolve: (commentId) => void resolveComment(commentId),
    onReply: (parent: Comment, body: string) =>
      void addComment({ change: parent.change, body, replyTo: parent.id }),
  })

  // Stack mode: rebuild renderable files from the change's U0 hunk patches.
  const files = useMemo((): FileDiff[] => {
    if (!snapshot || !commit) return []
    const byPath = new Map<string, FileDiff>()
    for (const h of snapshot.hunks) {
      if (!commit.hunks.includes(h.id)) continue
      const path = h.id.split(':')[0]
      let f = byPath.get(path)
      if (!f) {
        f = { path, note: null, rows: [] }
        byPath.set(path, f)
      }
      const patch = patches[h.id]
      if (patch === undefined) continue
      const parsed = parseHunkPatch(patch)
      if (!parsed) {
        // Degraded whole-file unit (binary, mode change, …): show as note.
        f.note = patch.trim()
        continue
      }
      f.rows.push({ kind: 'gap', oldNo: null, newNo: null, text: patch.split('\n')[0] })
      parsed.removed.forEach((text, i) =>
        f.rows.push({ kind: 'del', oldNo: parsed.oldStart + i, newNo: null, text }),
      )
      parsed.added.forEach((text, i) =>
        f.rows.push({ kind: 'add', oldNo: null, newNo: parsed.newStart + i, text }),
      )
    }
    return [...byPath.values()]
  }, [snapshot, commit, patches])

  if (fallback && selectedCommit) {
    return (
      <section className="pane review">
        <header className="pane-title">{t('review.title')}</header>
        {commitDiffText === null ? (
          <p className="empty">…</p>
        ) : (
          <DiffView
            files={parseUnifiedDiff(commitDiffText)}
            review={changeId ? hooks(changeId) : undefined}
          />
        )}
      </section>
    )
  }

  if (!snapshot || !commit) {
    return (
      <section className="pane review">
        <header className="pane-title">{t('review.title')}</header>
        <p className="empty">{t('review.empty')}</p>
      </section>
    )
  }

  const loading = commit.hunks.some((id) => !(id in patches))
  return (
    <section className="pane review">
      <header className="pane-title">{t('review.title')}</header>
      {loading ? (
        <p className="empty">…</p>
      ) : (
        <DiffView files={files} review={changeId ? hooks(changeId) : undefined} />
      )}
    </section>
  )
}
