import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
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
import { opProven, verifyCommands } from '../proof'
import { orderViolations } from '../stackdeps'
import { useAppStore } from '../store/store'
import { relTime } from '../time'

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

/** The stack editor: draft changes on the left, the selected draft's hunks
 * on the right, hunks movable between drafts. Check runs the CLI's full
 * R1–R8 validation; apply rebuilds the chain and shows the tree proof. */
export function OrganizeView(): React.JSX.Element {
  const { t } = useTranslation()
  const storeSnapshot = useAppStore((s) => s.snapshot)
  const status = useAppStore((s) => s.status)
  const projectId = useAppStore((s) => s.currentProjectId)
  const refreshProject = useAppStore((s) => s.refreshProject)
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
  const [nodes, setNodes] = useState<DraftNode[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<string | null>(null)
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
    setCheckResult(null)
    setProof(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackId, seededFor])

  useEffect(() => {
    if (!projectId) return
    void window.isomer
      .invoke('ism:ops', { projectId, limit: 20 })
      .then((r) => setOps(r.ok ? r.data : []))
  }, [projectId, opsTick])

  const hunkById = useMemo(() => {
    const map = new Map<string, { kind: string; add: number; del: number }>()
    for (const h of snapshot?.hunks ?? []) {
      map.set(h.id, { kind: h.kind, add: h.lines.add, del: h.lines.del })
    }
    return map
  }, [snapshot])

  // Live advisory: which assigned hunks depend on a LATER draft. The CLI
  // check stays authoritative; this explains the failure before it happens.
  const violations = useMemo(
    () => (snapshot ? orderViolations(nodes, snapshot.deps) : []),
    [nodes, snapshot],
  )
  const violationsByNode = useMemo(() => {
    const map = new Map<string, typeof violations>()
    for (const v of violations) map.set(v.nodeKey, [...(map.get(v.nodeKey) ?? []), v])
    return map
  }, [violations])
  const violatingHunks = useMemo(() => new Set(violations.map((v) => v.hunk)), [violations])
  const nodeName = (key: string): string => nodes.find((n) => n.key === key)?.name ?? key

  const selected = nodes.find((n) => n.key === selectedKey) ?? null

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
    setCheckResult(null)
  }
  const moveHunk = (hunkId: string, toKey: string): void => {
    setNodes((ns) =>
      ns.map((n) => {
        const has = n.from.includes(hunkId)
        if (n.key === toKey && !has) return { ...n, from: [...n.from, hunkId] }
        if (n.key !== toKey && has) return { ...n, from: n.from.filter((h) => h !== hunkId) }
        return n
      }),
    )
    setCheckResult(null)
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
              className={`draft-node${n.key === selectedKey ? ' active' : ''}`}
              onClick={() => setSelectedKey(n.key)}
            >
              <div className="draft-head">
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
                {violationsByNode.has(n.key) && (
                  <span
                    className="badge warn"
                    title={(violationsByNode.get(n.key) ?? [])
                      .map((v) =>
                        t('organize.depConflictTip', {
                          hunk: v.hunk,
                          dep: v.dep,
                          name: nodeName(v.depNodeKey),
                        }),
                      )
                      .join('\n')}
                  >
                    <AlertTriangle size={10} strokeWidth={2} />{' '}
                    {t('organize.depConflicts', {
                      count: (violationsByNode.get(n.key) ?? []).length,
                    })}
                  </span>
                )}
                <span className="muted">{t('review.hunks', { count: n.from.length })}</span>
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
          <header className="pane-title">
            {selected
              ? t('organize.hunksOf', { name: selected.name })
              : t('organize.pickChange')}
          </header>
          {selected?.from.map((id) => {
            const meta = hunkById.get(id)
            const path = id.split(':')[0]
            const violated = violatingHunks.has(id)
            return (
              <div key={id} className={`organize-hunk${violated ? ' violated' : ''}`}>
                {violated && (
                  <span className="dep-warn" title={t('organize.depNeedsLater')}>
                    <AlertTriangle size={11} strokeWidth={2} />
                  </span>
                )}
                <span className="hunk-id" title={id}>
                  {path}
                </span>
                {meta && (
                  <span className="linestat">
                    {meta.add > 0 && <span className="plus">+{meta.add}</span>}
                    {meta.del > 0 && <span className="minus">-{meta.del}</span>}
                  </span>
                )}
                <span className="spacer" />
                <div className="select-wrap">
                  <select
                    value={selected.key}
                    onChange={(e) => moveHunk(id, e.target.value)}
                  >
                    {nodes.map((n) => (
                      <option key={n.key} value={n.key}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
          {selected && selected.from.length === 0 && (
            <p className="empty">{t('organize.noHunks')}</p>
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
