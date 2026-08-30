import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/store'

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="side-section">
      <button className="side-header" onClick={() => setOpen(!open)}>
        <span className={`disclosure${open ? ' open' : ''}`}>›</span>
        {title}
        {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
      </button>
      {open && children}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const status = useAppStore((s) => s.status)
  const snapshot = useAppStore((s) => s.snapshot)
  const refs = useAppStore((s) => s.refs)
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const [filter, setFilter] = useState('')

  const project = projects.find((p) => p.id === currentProjectId)
  const entries = status?.entries.length ?? 0
  const stackSize = snapshot?.commits.length ?? 0
  const match = (n: string): boolean =>
    filter.trim() === '' || n.toLowerCase().includes(filter.trim().toLowerCase())

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

  const refList = (names: string[], current?: string): React.JSX.Element => (
    <>
      {names.filter(match).map((n) => (
        <div key={n} className={`side-ref${n === current ? ' current' : ''}`} title={n}>
          {n}
        </div>
      ))}
    </>
  )

  return (
    <nav className="sidebar">
      <div className="side-repo">{project?.name ?? ''}</div>
      {item('changes', t('sidebar.localChanges'), entries)}
      {item('history', t('sidebar.allCommits'))}
      {item('stack', t('sidebar.stack'), stackSize)}
      <input
        className="side-filter"
        placeholder={t('sidebar.filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {refs && (
        <>
          <Section title={t('sidebar.branches')}>
            {refList(Object.keys(refs.locals), refs.current)}
          </Section>
          <Section title={t('sidebar.remotes')}>
            {refList(Object.keys(refs.remotes).filter((n) => !n.endsWith('/HEAD')))}
          </Section>
          <Section title={t('sidebar.tags')} count={Object.keys(refs.tags).length}>
            {refList(Object.keys(refs.tags))}
          </Section>
          <Section title={t('sidebar.stashes')} count={refs.stashes} />
          <Section title={t('sidebar.submodules')} count={refs.submodules.length}>
            {refList(refs.submodules)}
          </Section>
        </>
      )}
    </nav>
  )
}
