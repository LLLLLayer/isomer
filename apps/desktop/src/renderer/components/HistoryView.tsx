import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import type { GitLogEntry } from '../../shared/ipc'
import type { Result } from '../../shared/result'
import { parseUnifiedDiff } from '../diff'
import { dayKey, graphLayout } from '../graph'
import { useAppStore } from '../store/store'
import { useFileContextMenu } from './FileContextMenu'
import { ConfirmModal, PromptModal } from './Modals'
import { DiffView } from './DiffView'
import { FileTreePanel } from './FileTreePanel'
import { Splitter, usePaneSize } from '../resize'

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Fork-style All Commits: graph rail, ref decorations, author/sha/date
 * columns; the selected commit opens a Commit / Changes / File Tree panel. */
export function HistoryView(): React.JSX.Element {
  const { t } = useTranslation()
  const log = useAppStore((s) => s.log)
  const refs = useAppStore((s) => s.refs)
  const selected = useAppStore((s) => s.selectedCommit)
  const selectCommit = useAppStore((s) => s.selectCommit)
  const diffText = useAppStore((s) => s.commitDiffText)
  const info = useAppStore((s) => s.commitInfo)
  const tab = useAppStore((s) => s.detailTab)
  const setDetailTab = useAppStore((s) => s.setDetailTab)
  const [treeFile, setTreeFile] = useState<string | null>(null)
  const fileMenu = useFileContextMenu()
  const projectId = useAppStore((s) => s.currentProjectId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GitLogEntry[] | null>(null)

  // Debounced repo-wide search: message, author, sha prefix.
  useEffect(() => {
    const q = query.trim()
    if (!projectId || q === '') {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      void window.isomer
        .invoke('git:log-search', { projectId, query: q, limit: 100 })
        .then((r) => setResults(r.ok ? r.data : []))
    }, 250)
    return () => clearTimeout(timer)
  }, [projectId, query])

  if (log.length === 0) {
    return (
      <section className="pane">
        <header className="pane-title">{t('sidebar.allCommits')}</header>
        <p className="empty">{t('stack.empty')}</p>
      </section>
    )
  }

  // sha → decoration labels (branch heads and tags pointing at it).
  const decorations = new Map<string, string[]>()
  if (refs) {
    for (const [name, sha] of Object.entries(refs.locals)) {
      decorations.set(sha, [...(decorations.get(sha) ?? []), name])
    }
    for (const [name, sha] of Object.entries(refs.remotes)) {
      if (!name.endsWith('/HEAD')) decorations.set(sha, [...(decorations.get(sha) ?? []), name])
    }
    for (const [name, sha] of Object.entries(refs.tags)) {
      decorations.set(sha, [...(decorations.get(sha) ?? []), name])
    }
  }

  const files = diffText === null ? [] : parseUnifiedDiff(diffText)

  const [listH, resizeList] = usePaneSize('commit-list', 300, 140, 640)
  return (
    <div className="history-view">
      {fileMenu.menu}
      <div className="history-toolbar">
        <Search size={13} strokeWidth={1.8} />
        <input
          className="history-search"
          placeholder={t('history.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query !== '' && (
          <button className="icon-btn" onClick={() => setQuery('')}>
            <X size={12} strokeWidth={2} />
          </button>
        )}
        {results !== null && (
          <span className="muted">{t('history.results', { count: results.length })}</span>
        )}
      </div>
      <div className="commit-list" style={{ height: listH, maxHeight: 'none' }}>
        <GraphList
          entries={results}
          selected={selected}
          onSelect={(sha) => void selectCommit(sha)}
          decorations={decorations}
        />
      </div>
      <Splitter axis="y" onDelta={resizeList} />
      <section className="commit-detail">
        <nav className="detail-tabs">
          {(['commit', 'changes', 'tree'] as const).map((k) => (
            <button
              key={k}
              className={tab === k ? 'active' : ''}
              onClick={() => setDetailTab(k)}
            >
              {t(`history.tab.${k}`)}
            </button>
          ))}
          <span className="spacer" />
          {files.length > 0 && <span className="muted">{t('diff.files', { count: files.length })}</span>}
        </nav>
        <div className="detail-body pane">
          {tab === 'commit' && info && (
            <div className="commit-meta">
              <div className="commit-meta-subject">{info.subject}</div>
              <dl>
                <dt>{t('history.author')}</dt>
                <dd>
                  {info.authorName} <span className="muted">&lt;{info.authorEmail}&gt;</span>
                </dd>
                <dt>SHA</dt>
                <dd className="mono">{info.sha}</dd>
                <dt>{t('history.date')}</dt>
                <dd>{fmtDate(info.authorDate)}</dd>
              </dl>
              {info.body && <pre className="commit-body">{info.body}</pre>}
            </div>
          )}
          {tab === 'changes' &&
            (diffText === null ? <p className="empty">…</p> : <DiffView files={files} />)}
          {tab === 'tree' && (
            <div className="tree-split">
              <FileTreePanel
                paths={files.map((f) => f.path)}
                selected={treeFile}
                onSelect={setTreeFile}
                onFileContextMenu={fileMenu.onContextMenu}
              />
              <div className="tree-diff">
                {treeFile ? (
                  <DiffView files={files.filter((f) => f.path === treeFile)} />
                ) : (
                  <p className="empty">{t('history.pickFile')}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}


/* ==== graph rail ========================================================= */

const LANE_W = 12
const ROW_H = 28
const HEAD_H = 26
const MAX_LANES = 8

function laneColor(l: number): string {
  return `var(--graph-${(l % 6) + 1})`
}

/** The commit list with a real topology rail: lanes from parent links,
 * day headers grouping commits into scannable clusters. */
function GraphList({
  entries,
  selected,
  onSelect,
  decorations,
}: {
  /** Search results override the store log (flat rail, no fake topology). */
  entries: GitLogEntry[] | null
  selected: string | null
  onSelect: (sha: string) => void
  decorations: Map<string, string[]>
}): React.JSX.Element {
  const { t } = useTranslation()
  const storeLog = useAppStore((s) => s.log)
  const log = entries ?? storeLog
  const refreshProject = useAppStore((s) => s.refreshProject)
  const setError = useAppStore((s) => s.setError)
  const branchOp = useAppStore((s) => s.branchOp)
  const projectId = useAppStore((s) => s.currentProjectId)
  const [menu, setMenu] = useState<{ x: number; y: number; sha: string } | null>(null)
  const [modal, setModal] = useState<
    | { kind: 'branch'; sha: string }
    | { kind: 'tag'; sha: string }
    | { kind: 'cherry-pick'; sha: string }
    | { kind: 'revert'; sha: string }
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
  const menuItem = (label: string, action: () => void, danger = false): React.JSX.Element => (
    <button
      key={label}
      className={`menu-item${danger ? ' danger' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        action()
        setMenu(null)
      }}
    >
      <span className="menu-check" />
      {label}
    </button>
  )
  const rows = useMemo(() => graphLayout(log), [log])
  const lanes = Math.min(
    MAX_LANES,
    rows.reduce((m, r) => Math.max(m, r.topCount, r.bottomCount), 1),
  )
  const gw = 12 + (lanes - 1) * LANE_W
  const x = (l: number): number => 6 + Math.min(l, MAX_LANES - 1) * LANE_W

  const now = Date.now() / 1000
  const dayLabel = (ts: number): string => {
    const key = dayKey(ts)
    if (key === dayKey(now)) return t('history.today')
    if (key === dayKey(now - 86_400)) return t('history.yesterday')
    return key
  }

  const mid = ROW_H / 2
  const curve = (x1: number, y1: number, x2: number, y2: number): string =>
    `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`

  return (
    <>
      {log.map((e, i) => {
        const r = rows[i]
        const header = i === 0 || dayKey(e.timestamp) !== dayKey(log[i - 1].timestamp)
        return (
          <Fragment key={e.sha}>
            {header && (
              <div className="day-row" style={{ paddingLeft: gw + 18 }}>
                <svg className="graph-svg" width={gw} height={HEAD_H}>
                  {Array.from({ length: Math.min(r.topCount, MAX_LANES) }, (_, l) => (
                    <line
                      key={l}
                      x1={x(l)}
                      y1={0}
                      x2={x(l)}
                      y2={HEAD_H}
                      style={{ stroke: laneColor(l) }}
                    />
                  ))}
                </svg>
                <span className="day-label">{dayLabel(e.timestamp)}</span>
              </div>
            )}
            <button
              className={`commit-row${e.sha === selected ? ' active' : ''}`}
              style={{ gridTemplateColumns: `${gw}px minmax(0, 1fr) 130px 80px 110px` }}
              onClick={() => onSelect(e.sha)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                setMenu({ x: ev.clientX, y: ev.clientY, sha: e.sha })
              }}
            >
              <svg className="graph-svg" width={gw} height={ROW_H}>
                {r.through.map(([a, b], k) =>
                  a === b ? (
                    <line
                      key={k}
                      x1={x(a)}
                      y1={0}
                      x2={x(b)}
                      y2={ROW_H}
                      style={{ stroke: laneColor(b) }}
                    />
                  ) : (
                    <path key={k} d={curve(x(a), 0, x(b), ROW_H)} style={{ stroke: laneColor(b) }} />
                  ),
                )}
                {r.into.map((a, k) => (
                  <path
                    key={`i${k}`}
                    d={curve(x(a), 0, x(r.dot), mid)}
                    style={{ stroke: laneColor(a) }}
                  />
                ))}
                {r.out.map((b, k) => (
                  <path
                    key={`o${k}`}
                    d={curve(x(r.dot), mid, x(b), ROW_H)}
                    style={{ stroke: laneColor(b) }}
                  />
                ))}
                <circle
                  cx={x(r.dot)}
                  cy={mid}
                  r={3.5}
                  style={{
                    fill: r.merge ? 'var(--bg)' : laneColor(r.dot),
                    stroke: laneColor(r.dot),
                  }}
                />
              </svg>
              <span className="commit-subject">
                {(decorations.get(e.sha) ?? []).map((d) => (
                  <span key={d} className="ref-badge">
                    {d}
                  </span>
                ))}
                {e.title}
              </span>
              <span className="commit-author">{e.authorName}</span>
              <span className="commit-sha mono">{e.sha.slice(0, 8)}</span>
              <span className="commit-date">{fmtDate(e.timestamp)}</span>
            </button>
          </Fragment>
        )
      })}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {menuItem(t('commit.copySha'), () => void navigator.clipboard.writeText(menu.sha))}
          <div className="menu-sep" />
          {menuItem(t('commit.newBranch'), () => setModal({ kind: 'branch', sha: menu.sha }))}
          {menuItem(t('commit.newTag'), () => setModal({ kind: 'tag', sha: menu.sha }))}
          {menuItem(t('commit.checkout'), () =>
            void branchOp({ kind: 'checkout', branch: menu.sha }),
          )}
          <div className="menu-sep" />
          {menuItem(t('commit.cherryPick'), () => setModal({ kind: 'cherry-pick', sha: menu.sha }))}
          {menuItem(t('commit.revert'), () => setModal({ kind: 'revert', sha: menu.sha }), true)}
        </div>
      )}
      {modal?.kind === 'branch' && (
        <PromptModal
          title={t('branch.newTitle', { from: modal.sha.slice(0, 8) })}
          initial=""
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void branchOp({ kind: 'create', name, from: modal.sha })
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'tag' && projectId && (
        <PromptModal
          title={t('tag.newTitle', { sha: modal.sha.slice(0, 8) })}
          initial=""
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            run(
              window.isomer.invoke('git:tag-create', {
                projectId,
                name,
                sha: modal.sha,
                push: false,
              }),
            )
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'cherry-pick' && projectId && (
        <ConfirmModal
          title={t('commit.cherryPickTitle', { sha: modal.sha.slice(0, 8) })}
          command={`git cherry-pick ${modal.sha.slice(0, 8)}`}
          onClose={() => setModal(null)}
          onConfirm={() => {
            run(window.isomer.invoke('git:cherry-pick', { projectId, sha: modal.sha }))
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'revert' && projectId && (
        <ConfirmModal
          title={t('commit.revertTitle', { sha: modal.sha.slice(0, 8) })}
          command={`git revert --no-edit ${modal.sha.slice(0, 8)}`}
          danger
          onClose={() => setModal(null)}
          onConfirm={() => {
            run(window.isomer.invoke('git:revert', { projectId, sha: modal.sha }))
            setModal(null)
          }}
        />
      )}
    </>
  )
}
