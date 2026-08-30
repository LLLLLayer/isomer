import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseHunkPatch, parseUnifiedDiff, sideBySideRows } from '../diff'
import { highlightLine, langFor } from '../highlight'
import { useAppStore } from '../store/store'
import { DiffView } from './DiffView'

/** CR area: real diff text per hunk, side-by-side or unified. Clicking a
 * new-side line number anchors the next comment to path:line. */
export function ReviewView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const selected = useAppStore((s) => s.selectedChangeId)
  const patches = useAppStore((s) => s.patches)
  const anchor = useAppStore((s) => s.commentAnchor)
  const setCommentAnchor = useAppStore((s) => s.setCommentAnchor)
  const [sideBySide, setSideBySide] = useState(true)

  const fallback = snapshot !== null && snapshot.commits.length === 0
  const selectedCommit = useAppStore((s) => s.selectedCommit)
  const commitDiffText = useAppStore((s) => s.commitDiffText)
  if (fallback && selectedCommit) {
    // No pending stack: reviewing history — show the picked commit's diff.
    return (
      <section className="pane review">
        <header className="pane-title">{t('review.title')}</header>
        {commitDiffText === null ? (
          <p className="empty">…</p>
        ) : (
          <DiffView files={parseUnifiedDiff(commitDiffText)} />
        )}
      </section>
    )
  }
  const commit = snapshot?.commits.find((c) => c.sha === selected)
  if (!snapshot || !commit) {
    return (
      <section className="pane review">
        <header className="pane-title">{t('review.title')}</header>
        <p className="empty">{t('review.empty')}</p>
      </section>
    )
  }

  const hunks = snapshot.hunks.filter((h) => commit.hunks.includes(h.id))
  const pathOf = (id: string): string => id.split(':')[0]

  const anchorClick = (path: string, line: number): void => {
    if (anchor && anchor.path === path && anchor.line === line) setCommentAnchor(null)
    else setCommentAnchor({ path, line })
  }

  return (
    <section className="pane review">
      <header className="pane-title">
        {t('review.title')}
        <span className="spacer" />
        <div className="segmented">
          <button className={sideBySide ? 'active' : ''} onClick={() => setSideBySide(true)}>
            {t('review.sideBySide')}
          </button>
          <button className={sideBySide ? '' : 'active'} onClick={() => setSideBySide(false)}>
            {t('review.unified')}
          </button>
        </div>
      </header>
      <p className="hunk-count">{t('review.hunks', { count: hunks.length })}</p>
      {hunks.map((h) => {
        const path = pathOf(h.id)
        const lang = langFor(path)
        const hl = (text: string): { __html: string } => ({ __html: highlightLine(text, lang) })
        const patch = patches[h.id]
        const parsed = patch ? parseHunkPatch(patch) : null
        return (
          <article key={h.id} className="diff-hunk">
            <header className="diff-file">
              <span className={`kind-pill ${h.kind}`}>{h.kind}</span>
              <span className="hunk-id">{path}</span>
              <span className="linestat">
                <span className="plus">+{h.lines.add}</span>
                <span className="minus">-{h.lines.del}</span>
              </span>
            </header>
            {patch === undefined && <p className="diff-note muted">…</p>}
            {patch !== undefined && parsed === null && (
              <p className="diff-note muted">{patch.trim()}</p>
            )}
            {parsed && sideBySide && (
              <div className="diff-table split">
                {sideBySideRows(parsed).map((row, i) => (
                  <div key={i} className="diff-split-row">
                    <span className="lineno">{row.left?.lineNo ?? ''}</span>
                    <span
                      className={`code${row.left ? ' del' : ' void'}`}
                      dangerouslySetInnerHTML={row.left ? hl(row.left.text) : undefined}
                    />
                    <button
                      className={`lineno clickable${
                        anchor && anchor.path === path && anchor.line === row.right?.lineNo
                          ? ' anchored'
                          : ''
                      }`}
                      disabled={!row.right}
                      onClick={() => row.right && anchorClick(path, row.right.lineNo)}
                      title={t('review.anchorHint')}
                    >
                      {row.right?.lineNo ?? ''}
                    </button>
                    <span
                      className={`code${row.right ? ' add' : ' void'}`}
                      dangerouslySetInnerHTML={row.right ? hl(row.right.text) : undefined}
                    />
                  </div>
                ))}
              </div>
            )}
            {parsed && !sideBySide && (
              <div className="diff-table unified">
                {parsed.removed.map((text, i) => (
                  <div key={`d${i}`} className="diff-uni-row">
                    <span className="lineno">{parsed.oldStart + i}</span>
                    <span className="lineno" />
                    <span
                      className="code del"
                      dangerouslySetInnerHTML={{ __html: '-' + highlightLine(text, lang) }}
                    />
                  </div>
                ))}
                {parsed.added.map((text, i) => (
                  <div key={`a${i}`} className="diff-uni-row">
                    <span className="lineno" />
                    <button
                      className={`lineno clickable${
                        anchor && anchor.path === path && anchor.line === parsed.newStart + i
                          ? ' anchored'
                          : ''
                      }`}
                      onClick={() => anchorClick(path, parsed.newStart + i)}
                      title={t('review.anchorHint')}
                    >
                      {parsed.newStart + i}
                    </button>
                    <span
                      className="code add"
                      dangerouslySetInnerHTML={{ __html: '+' + highlightLine(text, lang) }}
                    />
                  </div>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
