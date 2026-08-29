import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/store'

/** The change stack: base→head as cards, identity badges, anomaly flags. */
export function StackView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const comments = useAppStore((s) => s.comments)
  const selected = useAppStore((s) => s.selectedChangeId)
  const selectChange = useAppStore((s) => s.selectChange)

  if (!snapshot || snapshot.commits.length === 0) {
    return (
      <section className="pane stack">
        <header className="pane-title">{t('stack.title')}</header>
        <p className="empty">{t('stack.empty')}</p>
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
        <span className="mono muted"> {snapshot.branch}</span>
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
                  <span className="mono badge">{c.change_id ?? t('stack.untracked')}</span>
                  <span className="mono muted">{c.sha.slice(0, 8)}</span>
                  {unresolved > 0 && <span className="badge warn">{unresolved}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {snapshot.anomalies.length > 0 && (
        <footer className="anomalies">
          <span className="muted">{t('stack.anomalies')}: </span>
          {snapshot.anomalies.map((a, i) => (
            <span key={i} className="badge warn mono">
              {a.kind}
            </span>
          ))}
        </footer>
      )}
    </section>
  )
}
