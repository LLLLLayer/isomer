import { useTranslation } from 'react-i18next'
import { parseUnifiedDiff } from '../diff'

import { useAppStore } from '../store/store'
import { DiffView } from './DiffView'
import { FileTreePanel } from './FileTreePanel'
import { useState } from 'react'
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
      <div className="commit-list" style={{ height: listH, maxHeight: 'none' }}>
        {log.map((e, i) => (
          <button
            key={e.sha}
            className={`commit-row${e.sha === selected ? ' active' : ''}`}
            onClick={() => void selectCommit(e.sha)}
          >
            <span className={`graph-cell${i === 0 ? ' first' : ''}${i === log.length - 1 ? ' last' : ''}`}>
              <span className="graph-dot" />
            </span>
            <span className="commit-subject">
              {(decorations.get(e.sha) ?? []).map((d) => (
                <span key={d} className="ref-badge">{d}</span>
              ))}
              {e.title}
              {e.changeId && <span className="chip">{e.changeId}</span>}
            </span>
            <span className="commit-author">{e.authorName}</span>
            <span className="commit-sha mono">{e.sha.slice(0, 8)}</span>
            <span className="commit-date">{fmtDate(e.timestamp)}</span>
          </button>
        ))}
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
