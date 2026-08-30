import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/store'

/** CR area skeleton: hunk list for the selected change; side-by-side vs
 * unified toggle is wired, actual diff text rendering lands in A1. */
export function ReviewView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const selected = useAppStore((s) => s.selectedChangeId)
  const [sideBySide, setSideBySide] = useState(true)

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
      <ul className="hunk-list">
        {hunks.map((h) => (
          <li key={h.id} className="hunk-row">
            <span className={`kind-pill ${h.kind}`}>{h.kind}</span>
            <span className="hunk-id">{h.id}</span>
            <span className="linestat">
              <span className="plus">+{h.lines.add}</span>
              <span className="minus">-{h.lines.del}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
