import { useTranslation } from 'react-i18next'
import { parseUnifiedDiff } from '../diff'
import { useAppStore } from '../store/store'
import { DiffView } from './DiffView'

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Commit list with author/sha/date columns; selecting shows the full diff. */
export function HistoryView(): React.JSX.Element {
  const { t } = useTranslation()
  const log = useAppStore((s) => s.log)
  const selected = useAppStore((s) => s.selectedCommit)
  const selectCommit = useAppStore((s) => s.selectCommit)
  const diffText = useAppStore((s) => s.commitDiffText)

  if (log.length === 0) {
    return (
      <section className="pane">
        <header className="pane-title">{t('sidebar.allCommits')}</header>
        <p className="empty">{t('stack.empty')}</p>
      </section>
    )
  }

  return (
    <div className="history-view">
      <div className="commit-list">
        {log.map((e) => (
          <button
            key={e.sha}
            className={`commit-row${e.sha === selected ? ' active' : ''}`}
            onClick={() => void selectCommit(e.sha)}
          >
            <span className="graph-dot" />
            <span className="commit-subject">
              {e.title}
              {e.changeId && <span className="chip">{e.changeId}</span>}
            </span>
            <span className="commit-author">{e.authorName}</span>
            <span className="commit-sha mono">{e.sha.slice(0, 8)}</span>
            <span className="commit-date">{fmtDate(e.timestamp)}</span>
          </button>
        ))}
      </div>
      <section className="pane diff-pane commit-diff">
        {diffText === null ? (
          <p className="empty">…</p>
        ) : (
          <DiffView files={parseUnifiedDiff(diffText)} />
        )}
      </section>
    </div>
  )
}
