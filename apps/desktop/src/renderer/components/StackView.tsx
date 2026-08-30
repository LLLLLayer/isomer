import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { dayKey } from '../graph'
import { useAppStore } from '../store/store'
import { relTime } from '../time'

/** The change stack: base→head as cards, identity badges, anomaly flags. */
export function StackView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const comments = useAppStore((s) => s.comments)
  const selected = useAppStore((s) => s.selectedChangeId)
  const selectChange = useAppStore((s) => s.selectChange)

  if (!snapshot || snapshot.commits.length === 0) {
    // On the trunk there is no pending stack; tell recent history as a
    // story instead: day chapters, a timeline rail, expandable narratives.
    return <StoryHistory />
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


/* ==== trunk fallback: history as a story ================================= */

function StoryHistory(): React.JSX.Element {
  const { t } = useTranslation()
  const log = useAppStore((s) => s.log)
  const refs = useAppStore((s) => s.refs)
  const comments = useAppStore((s) => s.comments)
  const selectedCommit = useAppStore((s) => s.selectedCommit)
  const selectCommit = useAppStore((s) => s.selectCommit)
  const commitBodies = useAppStore((s) => s.commitBodies)
  const loadCommitBody = useAppStore((s) => s.loadCommitBody)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // sha → ref decorations (branches and tags pointing there).
  const decorations = new Map<string, { name: string; tag: boolean }[]>()
  if (refs) {
    for (const [name, sha] of Object.entries(refs.locals)) {
      decorations.set(sha, [...(decorations.get(sha) ?? []), { name, tag: false }])
    }
    for (const [name, sha] of Object.entries(refs.tags)) {
      decorations.set(sha, [...(decorations.get(sha) ?? []), { name, tag: true }])
    }
  }
  const unresolvedByChange = new Map<string, number>()
  for (const c of comments) {
    if (!c.resolved && !c.parent) {
      unresolvedByChange.set(c.change, (unresolvedByChange.get(c.change) ?? 0) + 1)
    }
  }

  const now = Date.now() / 1000
  const dayLabel = (ts: number): string => {
    const key = dayKey(ts)
    if (key === dayKey(now)) return t('history.today')
    if (key === dayKey(now - 86_400)) return t('history.yesterday')
    return key
  }
  const toggleExpand = (sha: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sha)) next.delete(sha)
      else {
        next.add(sha)
        void loadCommitBody(sha)
      }
      return next
    })
  }

  return (
    <section className="pane stack">
      <header className="pane-title">{t('stack.history')}</header>
      {log.length === 0 && <p className="empty">{t('stack.empty')}</p>}
      <ol className="stack-list story">
        {log.map((e, i) => {
          const header = i === 0 || dayKey(e.timestamp) !== dayKey(log[i - 1].timestamp)
          const decos = decorations.get(e.sha) ?? []
          const unresolved = e.changeId ? (unresolvedByChange.get(e.changeId) ?? 0) : 0
          const isOpen = expanded.has(e.sha)
          const body = commitBodies[e.sha]
          return (
            <Fragment key={e.sha}>
              {header && (
                <li className="story-day">
                  <span className="day-label">{dayLabel(e.timestamp)}</span>
                </li>
              )}
              <li className={`story-item${e.sha === selectedCommit ? ' active' : ''}`}>
                <button
                  className={`change-card${e.sha === selectedCommit ? ' active' : ''}`}
                  onClick={() => void selectCommit(e.sha)}
                >
                  <span className="summary">{e.title}</span>
                  <span className="badges">
                    {decos.map((d) => (
                      <span key={d.name} className={`ref-badge${d.tag ? ' tag' : ''}`}>
                        {d.name}
                      </span>
                    ))}
                    {unresolved > 0 && <span className="count-pill">{unresolved}</span>}
                    <span className="muted">{relTime(e.timestamp, t)}</span>
                    <span className="sha">{e.sha.slice(0, 7)}</span>
                  </span>
                </button>
                <button
                  className="story-expand icon-btn"
                  title={t('stack.expand')}
                  onClick={() => toggleExpand(e.sha)}
                >
                  {isOpen ? (
                    <ChevronDown size={13} strokeWidth={2} />
                  ) : (
                    <ChevronRight size={13} strokeWidth={2} />
                  )}
                </button>
                {isOpen && (
                  <p className="story-body">
                    {body === undefined ? '…' : body === '' ? t('stack.noBody') : body}
                  </p>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </section>
  )
}
