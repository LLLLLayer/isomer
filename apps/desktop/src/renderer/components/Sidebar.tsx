import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FileDiff, History, Layers, Plus, RefreshCw, SquarePen } from 'lucide-react'
import type { Result } from '../../shared/result'
import { ConfirmModal, PromptModal } from './Modals'
import { CompareModal, StashModal } from './Insights'
import { useAppStore } from '../store/store'
import { relTime } from '../time'

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string
  count?: number
  action?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="side-section">
      <div className="side-header-row">
        <button className="side-header" onClick={() => setOpen(!open)}>
          <span className={`disclosure${open ? ' open' : ''}`}>›</span>
          {title}
          {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
        </button>
        {action}
      </div>
      {open && children}
    </div>
  )
}

interface Menu {
  x: number
  y: number
  kind: 'branch' | 'tag' | 'remote'
  name: string
}

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const status = useAppStore((s) => s.status)
  const snapshot = useAppStore((s) => s.snapshot)
  const refs = useAppStore((s) => s.refs)
  const stashes = useAppStore((s) => s.stashes)
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const refreshProject = useAppStore((s) => s.refreshProject)
  const setError = useAppStore((s) => s.setError)
  const [filter, setFilter] = useState('')
  const branchOp = useAppStore((s) => s.branchOp)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [stashOpen, setStashOpen] = useState<{ index: number; message: string } | null>(null)
  const [compare, setCompare] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<
    | { kind: 'create'; from: string }
    | { kind: 'rename'; from: string }
    | { kind: 'delete'; name: string }
    | { kind: 'merge'; branch: string }
    | { kind: 'rebase'; onto: string }
    | { kind: 'tag-delete'; name: string; remote: boolean }
    | { kind: 'remote-add' }
    | { kind: 'remote-url'; name: string; url: string }
    | { kind: 'remote-remove'; name: string }
    | null
  >(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const run = (p: Promise<Result<unknown>>): void => {
    void p.then((r) => {
      if (!r.ok) setError(r.error)
      void refreshProject()
    })
  }
  const invoke = window.isomer.invoke.bind(window.isomer)

  const project = projects.find((p) => p.id === currentProjectId)
  const entries = status?.entries.length ?? 0
  const stackSize = snapshot?.commits.length ?? 0
  const match = (n: string): boolean =>
    filter.trim() === '' || n.toLowerCase().includes(filter.trim().toLowerCase())

  const ICONS = {
    changes: <FileDiff size={14} strokeWidth={1.8} />,
    history: <History size={14} strokeWidth={1.8} />,
    stack: <Layers size={14} strokeWidth={1.8} />,
    organize: <SquarePen size={14} strokeWidth={1.8} />,
  }
  const item = (
    key: 'changes' | 'history' | 'stack' | 'organize',
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

  const openMenu = (e: React.MouseEvent, kind: Menu['kind'], name: string): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, kind, name })
  }

  const menuItem = (
    label: string,
    action: () => void,
    opts: { danger?: boolean; disabled?: boolean; checked?: boolean } = {},
  ): React.JSX.Element => (
    <button
      key={label}
      className={`menu-item${opts.danger ? ' danger' : ''}`}
      disabled={opts.disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        action()
        setMenu(null)
      }}
    >
      <span className="menu-check">{opts.checked && <Check size={13} />}</span>
      {label}
    </button>
  )

  return (
    <nav className="sidebar">
      <div className="side-repo">{project?.name ?? ''}</div>
      {item('changes', t('sidebar.localChanges'), entries)}
      {item('history', t('sidebar.allCommits'))}
      {item('stack', t('sidebar.stack'), stackSize)}
      {item('organize', t('sidebar.organize'))}
      <input
        className="side-filter"
        placeholder={t('sidebar.filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {refs && (
        <>
          <Section title={t('sidebar.branches')}>
            {Object.keys(refs.locals)
              .filter(match)
              .map((n) => {
                const track = refs.tracking[n]
                return (
                  <div
                    key={n}
                    className={`side-ref${n === refs.current ? ' current' : ''}`}
                    title={n}
                    onDoubleClick={
                      n !== refs.current
                        ? () => void branchOp({ kind: 'checkout', branch: n })
                        : undefined
                    }
                    onContextMenu={(e) => openMenu(e, 'branch', n)}
                  >
                    <span className="side-ref-name">{n}</span>
                    {track && (
                      <span className="track-badge mono">
                        {track.ahead > 0 && `↑${track.ahead}`}
                        {track.ahead > 0 && track.behind > 0 && ' '}
                        {track.behind > 0 && `↓${track.behind}`}
                      </span>
                    )}
                  </div>
                )
              })}
          </Section>
          <Section
            title={t('sidebar.remotes')}
            action={
              <button
                className="icon-btn"
                title={t('remote.add')}
                onClick={() => setPrompt({ kind: 'remote-add' })}
              >
                <Plus size={12} strokeWidth={2} />
              </button>
            }
          >
            {Object.keys(refs.remoteUrls)
              .filter(match)
              .map((n) => (
                <div
                  key={n}
                  className="side-ref"
                  title={refs.remoteUrls[n]}
                  onContextMenu={(e) => openMenu(e, 'remote', n)}
                >
                  {n}
                </div>
              ))}
            {Object.keys(refs.remotes)
              .filter((n) => !n.endsWith('/HEAD'))
              .filter(match)
              .map((n) => (
                <div key={n} className="side-ref nested" title={n}>
                  {n}
                </div>
              ))}
          </Section>
          <Section title={t('sidebar.tags')} count={Object.keys(refs.tags).length}>
            {Object.keys(refs.tags)
              .filter(match)
              .map((n) => (
                <div key={n} className="side-ref" title={n} onContextMenu={(e) => openMenu(e, 'tag', n)}>
                  {n}
                </div>
              ))}
          </Section>
          <Section title={t('sidebar.stashes')} count={stashes.length}>
            {stashes.map((s) => (
              <button
                key={s.index}
                className="side-ref stash"
                title={s.message}
                onClick={() => setStashOpen({ index: s.index, message: s.message })}
              >
                <span className="side-ref-name">{s.message || `stash@{${s.index}}`}</span>
                <span className="muted">{relTime(s.timestamp, t)}</span>
              </button>
            ))}
          </Section>
          <Section
            title={t('sidebar.submodules')}
            count={refs.submodules.length}
            action={
              refs.submodules.length > 0 && currentProjectId ? (
                <button
                  className="icon-btn"
                  title={t('submodule.update')}
                  onClick={() =>
                    run(invoke('git:submodule-update', { projectId: currentProjectId }))
                  }
                >
                  <RefreshCw size={12} strokeWidth={1.8} />
                </button>
              ) : undefined
            }
          >
            {refs.submodules.filter(match).map((n) => (
              <div key={n} className="side-ref" title={n}>
                {n}
              </div>
            ))}
          </Section>
        </>
      )}

      {menu?.kind === 'branch' && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {menuItem(t('branch.checkout'), () => void branchOp({ kind: 'checkout', branch: menu.name }), {
            disabled: menu.name === refs?.current,
            checked: menu.name === refs?.current,
          })}
          <div className="menu-sep" />
          {menuItem(
            t('branch.mergeInto', { branch: menu.name, current: refs?.current ?? '' }),
            () => setPrompt({ kind: 'merge', branch: menu.name }),
            { disabled: menu.name === refs?.current },
          )}
          {menuItem(
            t('branch.rebaseOnto', { branch: menu.name }),
            () => setPrompt({ kind: 'rebase', onto: menu.name }),
            { disabled: menu.name === refs?.current },
          )}
          {menuItem(t('branch.compare'), () => setCompare(menu.name), {
            disabled: menu.name === refs?.current,
          })}
          <div className="menu-sep" />
          {menuItem(t('branch.new'), () => setPrompt({ kind: 'create', from: menu.name }))}
          {menuItem(t('branch.rename'), () => setPrompt({ kind: 'rename', from: menu.name }))}
          {menuItem(t('branch.delete'), () => setPrompt({ kind: 'delete', name: menu.name }), {
            danger: true,
            disabled: menu.name === refs?.current,
          })}
          <div className="menu-sep" />
          {menuItem(t('branch.copyName'), () => void navigator.clipboard.writeText(menu.name))}
        </div>
      )}
      {menu?.kind === 'tag' && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {menuItem(t('tag.delete'), () => setPrompt({ kind: 'tag-delete', name: menu.name, remote: false }), {
            danger: true,
          })}
          {menuItem(
            t('tag.deleteRemote'),
            () => setPrompt({ kind: 'tag-delete', name: menu.name, remote: true }),
            { danger: true },
          )}
          <div className="menu-sep" />
          {menuItem(t('branch.copyName'), () => void navigator.clipboard.writeText(menu.name))}
        </div>
      )}
      {menu?.kind === 'remote' && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {menuItem(t('remote.copyUrl'), () =>
            void navigator.clipboard.writeText(refs?.remoteUrls[menu.name] ?? ''),
          )}
          {menuItem(t('remote.setUrl'), () =>
            setPrompt({ kind: 'remote-url', name: menu.name, url: refs?.remoteUrls[menu.name] ?? '' }),
          )}
          {menuItem(t('remote.remove'), () => setPrompt({ kind: 'remote-remove', name: menu.name }), {
            danger: true,
          })}
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
      {prompt?.kind === 'merge' && currentProjectId && (
        <ConfirmModal
          title={t('branch.mergeTitle', { branch: prompt.branch, current: refs?.current ?? '' })}
          command={`git merge --no-edit ${prompt.branch}`}
          onClose={() => setPrompt(null)}
          onConfirm={() => {
            run(invoke('git:merge', { projectId: currentProjectId, branch: prompt.branch }))
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'rebase' && currentProjectId && (
        <ConfirmModal
          title={t('branch.rebaseTitle', { onto: prompt.onto, current: refs?.current ?? '' })}
          command={`git rebase ${prompt.onto}`}
          onClose={() => setPrompt(null)}
          onConfirm={() => {
            run(invoke('git:rebase', { projectId: currentProjectId, onto: prompt.onto }))
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'tag-delete' && currentProjectId && (
        <ConfirmModal
          title={t('tag.deleteTitle', { name: prompt.name })}
          command={
            prompt.remote
              ? `git tag -d ${prompt.name} && git push origin :refs/tags/${prompt.name}`
              : `git tag -d ${prompt.name}`
          }
          danger
          onClose={() => setPrompt(null)}
          onConfirm={() => {
            run(
              invoke('git:tag-delete', {
                projectId: currentProjectId,
                name: prompt.name,
                remote: prompt.remote,
              }),
            )
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'remote-add' && currentProjectId && (
        <PromptModal
          title={t('remote.addTitle')}
          initial="git@github.com:user/repo.git"
          onClose={() => setPrompt(null)}
          onSubmit={(url) => {
            run(invoke('git:remote-add', { projectId: currentProjectId, name: 'origin', url }))
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'remote-url' && currentProjectId && (
        <PromptModal
          title={t('remote.setUrlTitle', { name: prompt.name })}
          initial={prompt.url}
          onClose={() => setPrompt(null)}
          onSubmit={(url) => {
            run(invoke('git:remote-set-url', { projectId: currentProjectId, name: prompt.name, url }))
            setPrompt(null)
          }}
        />
      )}
      {prompt?.kind === 'remote-remove' && currentProjectId && (
        <ConfirmModal
          title={t('remote.removeTitle', { name: prompt.name })}
          command={`git remote remove ${prompt.name}`}
          danger
          onClose={() => setPrompt(null)}
          onConfirm={() => {
            run(invoke('git:remote-remove', { projectId: currentProjectId, name: prompt.name }))
            setPrompt(null)
          }}
        />
      )}
      {stashOpen && (
        <StashModal
          index={stashOpen.index}
          message={stashOpen.message}
          onClose={() => setStashOpen(null)}
        />
      )}
      {compare && <CompareModal branch={compare} onClose={() => setCompare(null)} />}
    </nav>
  )
}
