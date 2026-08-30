import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/store'

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const status = useAppStore((s) => s.status)
  const snapshot = useAppStore((s) => s.snapshot)
  const refs = useAppStore((s) => s.refs)

  const entries = status?.entries.length ?? 0
  const stackSize = snapshot?.commits.length ?? 0

  const item = (
    key: 'changes' | 'history' | 'stack',
    label: string,
    count?: number,
  ): React.JSX.Element => (
    <button className={`side-item${view === key ? ' active' : ''}`} onClick={() => setView(key)}>
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
    </button>
  )

  const refList = (label: string, names: string[], current?: string): React.JSX.Element => (
    <div className="side-section">
      <div className="side-header">{label}</div>
      {names.slice(0, 12).map((n) => (
        <div key={n} className={`side-ref${n === current ? ' current' : ''}`} title={n}>
          {n}
        </div>
      ))}
      {names.length > 12 && <div className="side-ref muted">+{names.length - 12}</div>}
    </div>
  )

  return (
    <nav className="sidebar">
      {item('changes', t('sidebar.localChanges'), entries)}
      {item('history', t('sidebar.allCommits'))}
      {item('stack', t('sidebar.stack'), stackSize)}
      {refs && (
        <>
          {refList(t('sidebar.branches'), refs.locals, refs.current)}
          {refs.remotes.length > 0 && refList(t('sidebar.remotes'), refs.remotes)}
          {refs.tags.length > 0 && refList(t('sidebar.tags'), refs.tags)}
          {refs.stashes > 0 && (
            <div className="side-section">
              <div className="side-header">
                {t('sidebar.stashes')} <span className="side-count">{refs.stashes}</span>
              </div>
            </div>
          )}
        </>
      )}
    </nav>
  )
}
