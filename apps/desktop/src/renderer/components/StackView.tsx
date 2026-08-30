import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/store'

/** The change stack: base→head as cards, identity badges, anomaly flags. */
export function StackView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const log = useAppStore((s) => s.log)
  const comments = useAppStore((s) => s.comments)
  const selected = useAppStore((s) => s.selectedChangeId)
  const selectChange = useAppStore((s) => s.selectChange)
  const selectedCommit = useAppStore((s) => s.selectedCommit)
  const selectCommit = useAppStore((s) => s.selectCommit)

  if (!snapshot || snapshot.commits.length === 0) {
    // On the trunk there is no pending stack; show recent history instead —
    // organized repos carry Isomer-Change identities right in their log.
    return (
      <section className="pane stack">
        <header className="pane-title">{t('stack.history')}</header>
        {log.length === 0 && <p className="empty">{t('stack.empty')}</p>}
        <ol className="stack-list">
          {log.map((e) => (
            <li key={e.sha}>
              <button
                className={`change-card${e.sha === selectedCommit ? ' active' : ''}`}
                onClick={() => void selectCommit(e.sha)}
              >
                <span className="summary">{e.title}</span>
                <span className="badges">
                  <span className="sha">{e.sha.slice(0, 8)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  const unresolvedByChange = new Map<string, number>()
  for (const c of comments) {
    if (!c.resolved) {
      unresolvedByChange.set(c.change, (unresolvedByChange.get(c.change) ?? 0) + 1)
    }
  }

  // Newest last in git order; render top-down as head-first (review order).
  const commits = [...snapshot.commits].reverse()

  return (
    <section className="pane stack">
      <header className="pane-title">
        {t('stack.title')}
        <span className="spacer" />
        <span>{t('stack.count', { count: commits.length })}</span>
      </header>
      <ol className="stack-list">
        {commits.map((c) => {
          const unresolved = c.change_id ? (unresolvedByChange.get(c.change_id) ?? 0) : 0
          return (
            <li key={c.sha}>
              <button
                className={`change-card${selected === c.sha ? ' active' : ''}`}
                onClick={() => selectChange(c.sha)}
              >
                <span className="summary">{c.title}</span>
                <span className="badges">
                  <span className="muted">{t('review.hunks', { count: c.hunks.length })}</span>
                  {unresolved > 0 && <span className="count-pill">{unresolved}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {snapshot.anomalies.length > 0 && (
        <footer className="anomalies">
          <span className="muted">{t('stack.anomalies')}</span>
          {snapshot.anomalies.map((a, i) => (
            <span key={i} className="badge warn">
              {a.kind}
            </span>
          ))}
        </footer>
      )}
    </section>
  )
}
