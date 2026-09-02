import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Copy,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { IsmOp } from '../../shared/ipc'
import type { Snapshot } from '../../shared/ism-types'
import type { AppError } from '../../shared/result'
import { fileGroups, groupDiff, hunkDeps } from '../organize'
import { opProven, verifyCommands } from '../proof'
import { changeDeps } from '../stackdeps'
import { useAppStore } from '../store/store'
import { relTime } from '../time'
import { DiffView } from './DiffView'

interface DraftNode {
  key: string
  name: string
  summary: string
  description: string
  from: string[]
}

let keySeq = 0

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'change'
}

/** Drafts cycle through the graph palette; the class sets `--draft`. */
const colorClass = (index: number): string => `draft-c${(index % 6) + 1}`

/** Body rows a hunk shows before folding behind "… more lines". */
const FOLD_AFTER = 6

interface Chip {
  tone: 'ok' | 'bad' | 'muted'
  label: string
  tip: string
}

/** The stack editor. Left: the drafts in landing order (the plan's `order`
 * — a linear authority, annotated with live dependency evidence). Right:
 * every hunk of the stack grouped by file with its code visible, each one
 * assignable in place; hard deps always live inside one file, so a file
 * group is also the neighbourhood where they can be shown. Check runs the
 * CLI's full R1–R8 validation; apply rebuilds the chain and shows the
 * tree proof. */
export function OrganizeView(): React.JSX.Element {
  const { t } = useTranslation()
  const storeSnapshot = useAppStore((s) => s.snapshot)
  const status = useAppStore((s) => s.status)
  const projectId = useAppStore((s) => s.currentProjectId)
  const refreshProject = useAppStore((s) => s.refreshProject)
  const patches = useAppStore((s) => s.patches)
  const loadPatches = useAppStore((s) => s.loadPatches)
  const [altSnapshot, setAltSnapshot] = useState<Snapshot | null>(null)

  // On the trunk the default analysis sees an empty stack; the work to
  // organize is whatever the branch is ahead of its upstream by. Re-anchor
  // the snapshot on the upstream in that case (the plan carries base/head).
  const storeEmpty = storeSnapshot === null || storeSnapshot.commits.length === 0
  useEffect(() => {
    const upstream = status?.upstream
    if (!projectId || !storeEmpty || !upstream || (status?.ahead ?? 0) === 0) {
      setAltSnapshot(null)
      return
    }
    void window.isomer.invoke('ism:snapshot', { projectId, base: upstream }).then((r) => {
      if (useAppStore.getState().currentProjectId !== projectId) return
      setAltSnapshot(r.ok && r.data.commits.length > 0 ? r.data : null)
    })
  }, [projectId, storeEmpty, status?.upstream, status?.ahead])

  const snapshot = !storeEmpty ? storeSnapshot : altSnapshot
  // Hunk ids of a re-anchored snapshot only resolve against that base.
  const patchBase = storeEmpty ? (status?.upstream ?? undefined) : undefined
  const [nodes, setNodes] = useState<DraftNode[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; errors?: AppError[] } | null>(null)
  const [proof, setProof] = useState<IsmOp | null>(null)
  const [ops, setOps] = useState<IsmOp[] | null>(null)
  // Bumped by apply/undo so the op-log refetches even when `proof` is
  // unchanged (undo with proof already null used to leave a stale list
  // whose visible Undo button would actually redo).
  const [opsTick, setOpsTick] = useState(0)

  const seed = (): DraftNode[] => {
    if (!snapshot) return []
    const used = new Set<string>()
    return snapshot.commits.map((c) => {
      let name = slugify(c.title)
      for (let i = 2; used.has(name); i++) name = `${slugify(c.title).slice(0, 36)}-${i}`
      used.add(name)
      return {
        key: `n${keySeq++}`,
        name,
        summary: c.title,
        description: '',
        from: [...c.hunks],
      }
    })
  }

  // Re-seed whenever the underlying stack changes (new head = new reality).
  const stackId = snapshot ? `${snapshot.base}..${snapshot.head}` : null
  useEffect(() => {
    if (stackId === seededFor) return
    setSeededFor(stackId)
    const fresh = stackId === null ? [] : seed()
    setNodes(fresh)
    setSelectedKey(fresh.length > 0 ? fresh[fresh.length - 1].key : null)
    setFilter('all')
    setPicked(new Set())
    setCheckResult(null)
    setProof(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackId, seededFor])

  // The board shows code, not ids: fetch every hunk's patch up front. A
  // failed fetch surfaces through the store's error; the board just stops
  // saying "loading".
  const [fetching, setFetching] = useState(false)
  useEffect(() => {
    if (!snapshot) return
    let stale = false
    setFetching(true)
    void loadPatches(
      snapshot.hunks.map((h) => h.id),
      patchBase,
    ).finally(() => {
      if (!stale) setFetching(false)
    })
    return () => {
      stale = true
    }
  }, [snapshot, patchBase, loadPatches])

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('ism:ops', { projectId, limit: 20 })
      .then((r) => setOps(r.ok ? r.data : []))
  }, [projectId, opsTick])

  const groups = useMemo(() => (snapshot ? fileGroups(snapshot.hunks) : []), [snapshot])
  const adjacency = useMemo(() => hunkDeps(snapshot?.deps ?? []), [snapshot])
  /** Draft index owning each hunk. */
  const ownerIdx = useMemo(() => {
    const map = new Map<string, number>()
    nodes.forEach((n, i) => {
      for (const h of n.from) map.set(h, i)
    })
    return map
  }, [nodes])
  // Drafts are pseudo-commits to the change-level lift: same evidence the
  // stack view shows after apply, computed live while editing.
  const draftDeps = useMemo(
    () =>
      changeDeps({
        commits: nodes.map((n) => ({ sha: n.key, hunks: n.from })),
        deps: snapshot?.deps ?? [],
      }),
    [nodes, snapshot],
  )
  const indexOf = (key: string): number => nodes.findIndex((n) => n.key === key)

  const filterIdx = filter === 'all' ? -1 : indexOf(filter)
  const visible = useMemo(
    () =>
      groups
        .map((g) =>
          filterIdx < 0
            ? g
            : { ...g, hunks: g.hunks.filter((h) => ownerIdx.get(h.id) === filterIdx) },
        )
        .filter((g) => g.hunks.length > 0),
    [groups, filterIdx, ownerIdx],
  )
  const files = useMemo(() => visible.map((g) => groupDiff(g, patches)), [visible, patches])
  const idsByPath = useMemo(() => new Map(files.map((f) => [f.path, f.hunkIds])), [files])
  /** Degraded whole-file units by path — one per commit touching a
   * degraded path, never mixed with line hunks — the file header is
   * their row. */
  const unitsByPath = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const g of visible) {
      for (const h of g.hunks) {
        if (h.kind === 'file') map.set(g.path, [...(map.get(g.path) ?? []), h.id])
      }
    }
    return map
  }, [visible])

  const patch = (key: string, p: Partial<DraftNode>): void => {
    setNodes((ns) => ns.map((n) => (n.key === key ? { ...n, ...p } : n)))
    setCheckResult(null)
  }
  const move = (key: string, dir: -1 | 1): void => {
    setNodes((ns) => {
      const i = ns.findIndex((n) => n.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ns.length) return ns
      const next = [...ns]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setCheckResult(null)
  }
  const addNode = (): void => {
    const node: DraftNode = {
      key: `n${keySeq++}`,
      name: `change-${nodes.length + 1}`,
      summary: '',
      description: '',
      from: [],
    }
    setNodes((ns) => [...ns, node])
    setSelectedKey(node.key)
    setCheckResult(null)
  }
  const removeNode = (key: string): void => {
    setNodes((ns) => ns.filter((n) => n.key !== key))
    if (selectedKey === key) setSelectedKey(null)
    if (filter === key) setFilter('all')
    setCheckResult(null)
  }
  const moveHunks = (ids: string[], toKey: string): void => {
    const moving = new Set(ids)
    setNodes((ns) =>
      ns.map((n) => {
        if (n.key === toKey) {
          const add = ids.filter((h) => !n.from.includes(h))
          return add.length === 0 ? n : { ...n, from: [...n.from, ...add] }
        }
        const kept = n.from.filter((h) => !moving.has(h))
        return kept.length === n.from.length ? n : { ...n, from: kept }
      }),
    )
    setCheckResult(null)
  }
  const togglePick = (id: string, on: boolean): void => {
    setPicked((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const plan = (): unknown => ({
    version: 1,
    snapshot_digest: snapshot?.snapshot_digest,
    base: snapshot?.base,
    head: snapshot?.head,
    order: nodes.map((n) => slugify(n.name)),
    nodes: nodes.map((n) => ({
      name: slugify(n.name),
      summary: n.summary,
      ...(n.description.trim() !== '' ? { description: n.description } : {}),
      from: n.from,
    })),
  })

  const check = async (): Promise<void> => {
    if (!projectId || busy) return
    setBusy('check')
    setProof(null)
    const r = await window.isomer.invoke('ism:check', { projectId, plan: plan() })
    setCheckResult(r.ok ? { ok: true } : { ok: false, errors: [r.error] })
    setBusy(null)
  }

  const apply = async (): Promise<void> => {
    if (!projectId || busy) return
    setBusy('apply')
    const r = await window.isomer.invoke('ism:apply', { projectId, plan: plan() })
    if (!r.ok) {
      setCheckResult({ ok: false, errors: [r.error] })
      setBusy(null)
      return
    }
    // The proof, from the op record itself: old tree hash == new tree hash.
    const opsR = await window.isomer.invoke('ism:ops', { projectId, limit: 1 })
    setProof(opsR.ok && opsR.data.length > 0 ? opsR.data[0] : null)
    setOpsTick((n) => n + 1)
    setCheckResult(null)
    setBusy(null)
    await refreshProject()
  }

  const undo = async (): Promise<void> => {
    if (!projectId || busy) return
    const r = await window.isomer.invoke('ism:undo', { projectId })
    if (!r.ok) setCheckResult({ ok: false, errors: [r.error] })
    setProof(null)
    setOpsTick((n) => n + 1)
    await refreshProject()
  }

  if (!snapshot || snapshot.commits.length === 0) {
    return (
      <section className="pane organize">
        <header className="pane-title">{t('organize.title')}</header>
        <p className="empty">{t('organize.empty')}</p>
        <OpsTimeline ops={ops} onUndo={() => void undo()} />
      </section>
    )
  }

  const total = snapshot.hunks.length
  const assigned = nodes.reduce((n, node) => n + node.from.length, 0)

  /** Draft picker: the current owner's colour dot, or a placeholder when
   * the select is an action ("whole file →", "move to…"). */
  const assignSelect = (
    current: number | undefined,
    onPick: (key: string) => void,
    placeholder: string,
  ): React.JSX.Element => (
    <span className={`select-wrap assign${current === undefined ? '' : ` ${colorClass(current)}`}`}>
      <select
        value={current === undefined ? '' : nodes[current].key}
        onChange={(e) => {
          if (e.target.value !== '') onPick(e.target.value)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {current === undefined && <option value="">{placeholder}</option>}
        {nodes.map((n) => (
          <option key={n.key} value={n.key}>
            {n.name}
          </option>
        ))}
      </select>
    </span>
  )

  /** Cross-draft hard deps of one hunk, as chips. Intra-draft deps are
   * silent (they cannot break); a dep on a LATER draft is the violation
   * the CLI would report, shown where the hunk is. */
  const hunkChips = (id: string, mine: number | undefined): Chip[] => {
    const adj = adjacency.get(id)
    if (!adj) return []
    const chips: Chip[] = []
    const seen = new Set<string>()
    const push = (c: Chip): void => {
      const k = `${c.tone}|${c.label}`
      if (seen.has(k)) return
      seen.add(k)
      chips.push(c)
    }
    for (const dep of adj.needs) {
      const o = ownerIdx.get(dep)
      if (o === undefined) push({ tone: 'muted', label: t('organize.needsUnassigned'), tip: dep })
      else if (mine !== undefined && o === mine) continue
      else if (mine !== undefined && o > mine)
        push({
          tone: 'bad',
          label: t('organize.needsLater', { name: nodes[o].name }),
          tip: t('organize.depConflictTip', { hunk: id, dep, name: nodes[o].name }),
        })
      else push({ tone: 'ok', label: t('organize.needs', { name: nodes[o].name }), tip: dep })
    }
    for (const by of adj.neededBy) {
      const o = ownerIdx.get(by)
      if (o === undefined || (mine !== undefined && o === mine)) continue
      if (mine !== undefined && o < mine)
        push({
          tone: 'bad',
          label: t('organize.neededByEarlier', { name: nodes[o].name }),
          tip: t('organize.depConflictTip', { hunk: by, dep: id, name: nodes[mine].name }),
        })
      else push({ tone: 'muted', label: t('organize.neededBy', { name: nodes[o].name }), tip: by })
    }
    return chips
  }

  const assignBar = (id: string): React.JSX.Element => {
    const mine = ownerIdx.get(id)
    return (
      <>
        <label className="hunk-pick" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={picked.has(id)}
            onChange={(e) => togglePick(id, e.target.checked)}
          />
        </label>
        {hunkChips(id, mine).map((c) => (
          <span key={`${c.tone}|${c.label}`} className={`org-chip ${c.tone}`} title={c.tip}>
            {c.label}
          </span>
        ))}
        {assignSelect(mine, (key) => moveHunks([id], key), t('organize.unassigned'))}
      </>
    )
  }

  const hunkBar = (path: string, ord: number): React.ReactNode => {
    const id = idsByPath.get(path)?.[ord]
    return id === undefined ? null : assignBar(id)
  }

  const fileBar = (path: string): React.ReactNode => {
    const units = unitsByPath.get(path)
    if (units) {
      return units.map((u) => (
        <span key={u} className="file-unit" title={u}>
          {assignBar(u)}
        </span>
      ))
    }
    const all = groups.find((x) => x.path === path)
    const shown = visible.find((x) => x.path === path)
    if (!all || !shown) return null
    // "Whole file" means the whole file, filter or not; the count says
    // how much of it is on screen.
    return (
      <>
        <span className="muted">
          {shown.hunks.length === all.hunks.length
            ? t('review.hunks', { count: all.hunks.length })
            : t('organize.hunksShown', { shown: shown.hunks.length, count: all.hunks.length })}
        </span>
        {assignSelect(
          undefined,
          (key) =>
            moveHunks(
              all.hunks.map((h) => h.id),
              key,
            ),
          t('organize.wholeFile'),
        )}
      </>
    )
  }

  /** Draft-level evidence: independent, or which drafts it leans on /
   * carries — red when the landing order contradicts an edge. */
  const draftChips = (n: DraftNode, i: number): React.JSX.Element[] => {
    const dd = draftDeps.bySha.get(n.key)
    if (!dd) return []
    if (draftDeps.independent.has(n.key) && n.from.length > 0) {
      // The lift ignores edges into unassigned hunks; a draft leaning on
      // one is not independent yet, only undecided.
      const dangling = n.from.some((h) =>
        (adjacency.get(h)?.needs ?? []).some((d) => ownerIdx.get(d) === undefined),
      )
      return [
        dangling ? (
          <span key="dangling" className="org-chip muted">
            {t('organize.needsUnassigned')}
          </span>
        ) : (
          <span key="ind" className="org-chip ok" title={t('organize.independentTip')}>
            {t('organize.independent')}
          </span>
        ),
      ]
    }
    const out: React.JSX.Element[] = []
    for (const e of dd.needs) {
      const j = indexOf(e.target)
      if (j < 0) continue
      const bad = j > i
      out.push(
        <span
          key={`n${e.target}`}
          className={`org-chip ${bad ? 'bad' : 'ok'}`}
          title={e.via
            .map(([hunk, dep]) => t('organize.depConflictTip', { hunk, dep, name: nodes[j].name }))
            .join('\n')}
        >
          {t(bad ? 'organize.needsLater' : 'organize.needs', { name: nodes[j].name })}
        </span>,
      )
    }
    for (const by of dd.neededBy) {
      const j = indexOf(by)
      if (j < 0) continue
      const bad = j < i
      out.push(
        <span key={`b${by}`} className={`org-chip ${bad ? 'bad' : 'muted'}`}>
          {t(bad ? 'organize.neededByEarlier' : 'organize.neededBy', { name: nodes[j].name })}
        </span>,
      )
    }
    return out
  }

  return (
    <div className="organize-view">
      <div className="organize-toolbar">
        <span className="muted">
          {t('organize.status', { nodes: nodes.length, assigned, total })}
        </span>
        <span className="spacer" />
        <button className="ghost-btn" onClick={addNode}>
          <Plus size={12} strokeWidth={2} /> {t('organize.addChange')}
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            setSeededFor(null)
            setCheckResult(null)
            setProof(null)
          }}
        >
          <RotateCcw size={12} strokeWidth={1.8} /> {t('organize.reset')}
        </button>
        <button className="ghost-btn" disabled={busy !== null} onClick={() => void check()}>
          <BadgeCheck size={12} strokeWidth={1.8} />
          {busy === 'check' ? '…' : t('organize.check')}
        </button>
        <button
          className="primary-btn"
          disabled={busy !== null || checkResult?.ok !== true}
          onClick={() => void apply()}
        >
          <Play size={12} strokeWidth={1.8} />
          {busy === 'apply' ? '…' : t('organize.apply')}
        </button>
      </div>

      {checkResult && (
        <div className={`organize-verdict${checkResult.ok ? ' ok' : ' bad'}`}>
          {checkResult.ok
            ? t('organize.checkOk')
            : checkResult.errors?.map((e) => `${e.code}: ${e.message}${e.hint ? ` — ${e.hint}` : ''}`).join('\n')}
        </div>
      )}
      {proof && (
        <div className="organize-verdict ok proof">
          <ShieldCheck size={14} strokeWidth={1.8} />
          <span>
            {t('organize.proof')}{' '}
            <span className="mono">
              {proof.old_tree.slice(0, 12)} == {proof.new_tree.slice(0, 12)}
            </span>
          </span>
          <span className="spacer" />
          <button
            className="icon-btn"
            title={t('verify.copyCommands')}
            onClick={() => void navigator.clipboard.writeText(verifyCommands(proof))}
          >
            <Copy size={12} strokeWidth={1.8} />
          </button>
          <button className="ghost-btn" onClick={() => void undo()}>
            <Undo2 size={12} strokeWidth={1.8} /> {t('organize.undo')}
          </button>
        </div>
      )}

      <div className="organize-board">
        <div className="organize-nodes">
          {nodes.map((n, i) => (
            <div
              key={n.key}
              className={`draft-node ${colorClass(i)}${n.key === selectedKey ? ' active' : ''}`}
              onClick={() => setSelectedKey(n.key)}
            >
              <div className="draft-head">
                <span className="draft-pos mono" title={t('organize.posTip')}>
                  #{i + 1}
                </span>
                <input
                  className="draft-name mono"
                  value={n.name}
                  onChange={(e) =>
                    patch(n.key, {
                      name: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40),
                    })
                  }
                  onBlur={(e) => patch(n.key, { name: slugify(e.target.value) })}
                />
                <span className="spacer" />
                <button
                  className={`count-link${filter === n.key ? ' active' : ''}`}
                  title={t('organize.filterTip')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFilter(filter === n.key ? 'all' : n.key)
                  }}
                >
                  {t('review.hunks', { count: n.from.length })}
                </button>
                <button className="icon-btn" disabled={i === 0} onClick={() => move(n.key, -1)}>
                  <ArrowUp size={12} strokeWidth={1.8} />
                </button>
                <button
                  className="icon-btn"
                  disabled={i === nodes.length - 1}
                  onClick={() => move(n.key, 1)}
                >
                  <ArrowDown size={12} strokeWidth={1.8} />
                </button>
                <button
                  className="icon-btn"
                  disabled={n.from.length > 0}
                  title={t('organize.deleteHint')}
                  onClick={() => removeNode(n.key)}
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </div>
              <div className="draft-chips">{draftChips(n, i)}</div>
              <input
                className="draft-summary"
                placeholder={t('organize.summaryPlaceholder')}
                value={n.summary}
                onChange={(e) => patch(n.key, { summary: e.target.value })}
              />
              {n.key === selectedKey && (
                <textarea
                  className="draft-description"
                  placeholder={t('organize.descriptionPlaceholder')}
                  rows={3}
                  value={n.description}
                  onChange={(e) => patch(n.key, { description: e.target.value })}
                />
              )}
            </div>
          ))}
          <OpsTimeline ops={ops} onUndo={() => void undo()} />
        </div>
        <div className="organize-hunks">
          <header className="board-head">
            <span className="board-title">{t('organize.board')}</span>
            {fetching && <span className="muted">{t('organize.loading')}</span>}
            <span className="spacer" />
            {picked.size > 0 && (
              <span className="pick-bar">
                <span>{t('organize.pickedCount', { count: picked.size })}</span>
                {assignSelect(
                  undefined,
                  (key) => {
                    moveHunks([...picked], key)
                    setPicked(new Set())
                  },
                  t('organize.moveTo'),
                )}
                <button className="ghost-btn" onClick={() => setPicked(new Set())}>
                  {t('organize.clearPicked')}
                </button>
              </span>
            )}
            <span className="select-wrap">
              <select value={filterIdx < 0 ? 'all' : filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">{t('organize.filterAll')}</option>
                {nodes.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.name}
                  </option>
                ))}
              </select>
            </span>
          </header>
          {files.length === 0 ? (
            <p className="empty">{t('organize.noHunks')}</p>
          ) : (
            <DiffView files={files} hunkBar={hunkBar} fileBar={fileBar} foldAfter={FOLD_AFTER} />
          )}
        </div>
      </div>
    </div>
  )
}

/** The append-only op log, newest first; one-click undo of the latest. */
function OpsTimeline({
  ops,
  onUndo,
}: {
  ops: IsmOp[] | null
  onUndo: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (ops === null || ops.length === 0) return null
  return (
    <div className="ops-timeline">
      <h4>{t('organize.opsTitle')}</h4>
      {ops.map((op, i) => (
        <div key={op.sha} className="ops-row">
          <span className={`ops-kind ${op.kind}`}>{op.kind}</span>
          <span className="mono muted">
            {op.old_head.slice(0, 7)} → {op.new_head.slice(0, 7)}
          </span>
          {opProven(op) && (
            <span className="proof-tick" title={t('organize.proof')}>
              <ShieldCheck size={11} strokeWidth={2} />
            </span>
          )}
          <span className="muted">{relTime(Number(op.timestamp), t)}</span>
          <span className="spacer" />
          <button
            className="icon-btn"
            title={t('verify.copyCommands')}
            onClick={() => void navigator.clipboard.writeText(verifyCommands(op))}
          >
            <Copy size={11} strokeWidth={1.8} />
          </button>
          {i === 0 && (
            <button className="ghost-btn" onClick={onUndo}>
              <Undo2 size={11} strokeWidth={1.8} /> {t('organize.undo')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
