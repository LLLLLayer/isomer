import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FileDiff, History, Layers } from 'lucide-react'
import { ConfirmModal, PromptModal } from './Modals'
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
  const branchOp = useAppStore((s) => s.branchOp)
  const [menu, setMenu] = useState<{ x: number; y: number; branch: string } | null>(null)
  const [prompt, setPrompt] = useState<
    | { kind: 'create'; from: string }
    | { kind: 'rename'; from: string }
    | { kind: 'delete'; name: string }
    | null
  >(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const project = projects.find((p) => p.id === currentProjectId)
  const entries = status?.entries.length ?? 0
  const stackSize = snapshot?.commits.length ?? 0
  const match = (n: string): boolean =>
    filter.trim() === '' || n.toLowerCase().includes(filter.trim().toLowerCase())

  const ICONS = {
    changes: <FileDiff size={14} strokeWidth={1.8} />,
    history: <History size={14} strokeWidth={1.8} />,
    stack: <Layers size={14} strokeWidth={1.8} />,
  }
  const item = (
    key: 'changes' | 'history' | 'stack',
    label: string,
    count?: number,
  ): React.JSX.Element => (
    <button className={`side-item${view === key ? ' active' : ''}`} onClick={() => setView(key)}>
      <span className="side-icon">{ICONS[key]}</span>
      <span className="side-label">{label}</span>
      <span className="spacer" />
      {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
    </button>
  )

  const refList = (names: string[], current?: string, branchy = false): React.JSX.Element => (
    <>
      {names.filter(match).map((n) => (
        <div
          key={n}
          className={`side-ref${n === current ? ' current' : ''}`}
          title={n}
          onDoubleClick={branchy && n !== current ? () => void branchOp({ kind: 'checkout', branch: n }) : undefined}
          onContextMenu={
            branchy
              ? (e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, branch: n })
                }
              : undefined
          }
        >
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
            {refList(Object.keys(refs.locals), refs.current, true)}
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
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            className="menu-item"
            disabled={menu.branch === refs?.current}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              void branchOp({ kind: 'checkout', branch: menu.branch })
              setMenu(null)
            }}
          >
            <span className="menu-check">
              {menu.branch === refs?.current && <Check size={13} />}
            </span>
            {t('branch.checkout')}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setPrompt({ kind: 'create', from: menu.branch })
              setMenu(null)
            }}
          >
            <span className="menu-check" />
            {t('branch.new')}
          </button>
          <button
            className="menu-item"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setPrompt({ kind: 'rename', from: menu.branch })
              setMenu(null)
            }}
          >
            <span className="menu-check" />
            {t('branch.rename')}
          </button>
          <button
            className="menu-item"
            disabled={menu.branch === refs?.current}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setPrompt({ kind: 'delete', name: menu.branch })
              setMenu(null)
            }}
          >
            <span className="menu-check" />
            {t('branch.delete')}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              void navigator.clipboard.writeText(menu.branch)
              setMenu(null)
            }}
          >
            <span className="menu-check" />
            {t('branch.copyName')}
          </button>
        </div>
      )}
      {prompt?.kind === 'create' && (
        <PromptModal
          title={t('branch.newTitle', { from: prompt.from })}
          initial=""
          onClose={() => setPrompt(null)}
          onSubmit={(name) => {
            void branchOp({ kind: 'create', name, from: prompt.from })
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'rename' && (
        <PromptModal
          title={t('branch.renameTitle', { from: prompt.from })}
          initial={prompt.from}
          onClose={() => setPrompt(null)}
          onSubmit={(to) => {
            void branchOp({ kind: 'rename', from: prompt.from, to })
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'delete' && (
        <ConfirmModal
          title={t('branch.deleteTitle', { name: prompt.name })}
          command={`git branch -D ${prompt.name}`}
          danger
          onClose={() => setPrompt(null)}
          onConfirm={() => {
            void branchOp({ kind: 'delete', name: prompt.name })
            setPrompt(null)
          }}
        />
      )}
    </nav>
  )
}
