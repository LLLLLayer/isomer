import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  GitPullRequest,
  Link2,
  ShieldCheck,
  Unlink,
} from 'lucide-react'
import type { IsmOp } from '../../shared/ipc'
import { dayKey } from '../graph'
import { appliedProof, verifyCommands } from '../proof'
import { changeDeps } from '../stackdeps'
import { storage } from '../storage'
import { useAppStore } from '../store/store'
import { relTime } from '../time'
import { StackGraph } from './StackGraph'
import { SubmitStackModal } from './SubmitStack'

/** The change stack: base→head as cards with the evidence only ism has —
 * change-level dependency edges (with the pinning line identities), the
 * tree-equality proof of the last reorganize, and review state. */
export function StackView(): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useAppStore((s) => s.snapshot)
  const comments = useAppStore((s) => s.comments)
  const selected = useAppStore((s) => s.selectedChangeId)
  const selectChange = useAppStore((s) => s.selectChange)
  const approvals = useAppStore((s) => s.approvals)
  const toggleApproval = useAppStore((s) => s.toggleApproval)
  const projectId = useAppStore((s) => s.currentProjectId)
  const [latestOp, setLatestOp] = useState<IsmOp | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [view, setViewState] = useState<'list' | 'graph'>(() =>
    storage.get('isomer.stackView') === 'graph' ? 'graph' : 'list',
  )
  const setView = (v: 'list' | 'graph'): void => {
    setViewState(v)
    storage.set('isomer.stackView', v)
  }

  const stacked = snapshot !== null && snapshot.commits.length > 0
  useEffect(() => {
    if (!projectId || !stacked) return
    // Responses may resolve out of order across quick head changes (undo
    // then re-apply); a stale response must not overwrite the fresh one.
    let stale = false
    void window.isomer.invoke('ism:ops', { projectId, limit: 1 }).then((r) => {
      if (stale || useAppStore.getState().currentProjectId !== projectId) return
      setLatestOp(r.ok && r.data.length > 0 ? r.data[0] : null)
    })
    return () => {
      stale = true
    }
  }, [projectId, stacked, snapshot?.head])

  const deps = useMemo(() => (stacked && snapshot ? changeDeps(snapshot) : null), [
    stacked,
    snapshot,
  ])

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
  const totalUnresolved = [...unresolvedByChange.values()].reduce((a, b) => a + b, 0)
  const titleOf = new Map(snapshot.commits.map((c) => [c.sha, c.title]))

  // Newest last in git order; render top-down as head-first (review order).
  const commits = [...snapshot.commits].reverse()
  const proven =
    latestOp !== null && appliedProof(latestOp) && latestOp.new_head === snapshot.head

  return (
    <section className="pane stack">
      <header className="pane-title">
        {t('stack.title')}
        <span className="spacer" />
        {totalUnresolved > 0 && (
          <span className="count-pill">
            {t('stack.unresolvedTotal', { count: totalUnresolved })}
          </span>
        )}
        <div className="segmented">
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            {t('stack.viewList')}
          </button>
          <button
            className={view === 'graph' ? 'active' : ''}
            onClick={() => setView('graph')}
          >
            {t('stack.viewGraph')}
          </button>
        </div>
        <button
          className="icon-btn labeled"
          title={t('stack.submitTitle')}
          onClick={() => setSubmitOpen(true)}
        >
          <GitPullRequest size={12} strokeWidth={1.8} /> {t('stack.submit')}
        </button>
        <span>{t('stack.count', { count: commits.length })}</span>
      </header>
      {submitOpen && <SubmitStackModal onClose={() => setSubmitOpen(false)} />}
      {proven && latestOp && (
        <div className="proof-strip">
          <ShieldCheck size={13} strokeWidth={1.8} />
          <span className="proof-label">{t('stack.proven')}</span>
          <span className="mono muted">{latestOp.new_tree.slice(0, 12)}</span>
          <span className="spacer" />
          <button
            className="icon-btn"
            title={t('verify.copyCommands')}
            onClick={() => void navigator.clipboard.writeText(verifyCommands(latestOp))}
          >
            <Copy size={12} strokeWidth={1.8} />
          </button>
        </div>
      )}
      {view === 'graph' && deps && (
        <StackGraph
          commits={snapshot.commits}
          deps={deps}
          selected={selected}
          onSelect={selectChange}
          approvedShas={
            new Set(
              snapshot.commits
                .filter((c) => c.change_id !== null && approvals[c.change_id] === true)
                .map((c) => c.sha),
            )
          }
          unresolvedBySha={
            new Map(
              snapshot.commits.map((c) => [
                c.sha,
                c.change_id !== null ? (unresolvedByChange.get(c.change_id) ?? 0) : 0,
              ]),
            )
          }
        />
      )}
      {view === 'list' && (
        <ol className="stack-list">
          {commits.map((c) => {
            const unresolved = c.change_id ? (unresolvedByChange.get(c.change_id) ?? 0) : 0
            const edges = deps?.bySha.get(c.sha)
            const free = deps?.independent.has(c.sha) ?? false
            const approved = c.change_id !== null && approvals[c.change_id] === true
            return (
              <li key={c.sha} className="stack-item">
                <button
                  className={`change-card${selected === c.sha ? ' active' : ''}`}
                  onClick={() => selectChange(c.sha)}
                >
                  <span className="summary">{c.title}</span>
                  <span className="badges">
                    {free && (
                      <span className="dep-chip free" title={t('stack.independentTip')}>
                        <Unlink size={10} strokeWidth={2} /> {t('stack.independent')}
                      </span>
                    )}
                    {edges && edges.needs.length > 0 && (
                      <span
                        className="dep-chip"
                        title={edges.needs
                          .map((n) =>
                            t('stack.needsTip', {
                              target: titleOf.get(n.target) ?? n.target.slice(0, 7),
                              count: n.via.length,
                            }),
                          )
                          .join('\n')}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          selectChange(edges.needs[0].target)
                        }}
                      >
                        <Link2 size={10} strokeWidth={2} />{' '}
                        {t('stack.needs', { count: edges.needs.length })}
                      </span>
                    )}
                    {approved && (
                      <span className="dep-chip approved">
                        <CheckCircle2 size={10} strokeWidth={2} /> {t('stack.approved')}
                      </span>
                    )}
                    <span className="muted">{t('review.hunks', { count: c.hunks.length })}</span>
                    {unresolved > 0 && <span className="count-pill">{unresolved}</span>}
                  </span>
                </button>
                {c.change_id !== null && (
                  <button
                    className={`approve-btn icon-btn${approved ? ' on' : ''}`}
                    title={approved ? t('stack.unapprove') : t('stack.approve')}
                    onClick={() => c.change_id !== null && toggleApproval(c.change_id)}
                  >
                    <CheckCircle2 size={13} strokeWidth={1.8} />
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
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
