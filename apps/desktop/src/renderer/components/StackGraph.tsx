import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import type { CommitInfo } from '../../shared/ism-types'
import type { changeDeps } from '../stackdeps'
import { lineage, stackGraphLayout } from '../stackgraph'

const NODE_W = 150
const NODE_H = 44
const COL_GAP = 26
const LAYER_GAP = 30
const PAD = 14
const MIN_SCALE = 0.72

/** The change-level dependency DAG, drawn bottom→top (base → head) so it
 * reads like the stack it linearizes into. Hovering or selecting a change
 * lights its upstream lineage in accent and its downstream lineage in the
 * graph-5 hue; everything else dims. The SVG shrinks to the pane width
 * (viewBox scaling) and never grows past its natural size. */
export function StackGraph(props: {
  commits: CommitInfo[]
  deps: ReturnType<typeof changeDeps>
  selected: string | null
  onSelect: (sha: string) => void
  approvedShas: Set<string>
  unresolvedBySha: Map<string, number>
}): React.JSX.Element {
  const { t } = useTranslation()
  const { commits, deps, selected, onSelect } = props
  const [hover, setHover] = useState<string | null>(null)

  const layout = useMemo(() => stackGraphLayout(commits, deps.bySha), [commits, deps])
  // A sha can go stale mid-hover (snapshot refresh); an unknown focus would
  // return empty lineage sets and dim the whole graph until the next move.
  const known = (sha: string | null): string | null =>
    sha !== null && commits.some((c) => c.sha === sha) ? sha : null
  const focus = known(hover) ?? known(selected)
  const focusLineage = useMemo(
    () => (focus !== null ? lineage(focus, deps.bySha) : null),
    [focus, deps],
  )

  const at = new Map(layout.nodes.map((n) => [n.sha, n]))
  const titleOf = new Map(commits.map((c) => [c.sha, c.title]))
  // Rows spread horizontally; layers stack vertically with base at the
  // bottom, so every edge points upward: dependency below, dependent above.
  const x = (row: number): number => PAD + row * (NODE_W + COL_GAP)
  const y = (layer: number): number =>
    PAD + (layout.columns - 1 - layer) * (NODE_H + LAYER_GAP)
  const width = PAD * 2 + layout.rows * NODE_W + Math.max(0, layout.rows - 1) * COL_GAP
  const height =
    PAD * 2 + layout.columns * NODE_H + Math.max(0, layout.columns - 1) * LAYER_GAP

  const edgeClass = (from: string, to: string): string => {
    if (focus === null || focusLineage === null) return ''
    const { up, down } = focusLineage
    if ((to === focus || up.has(to)) && up.has(from)) return ' up'
    if ((from === focus || down.has(from)) && down.has(to)) return ' down'
    return ' dim'
  }
  const nodeClass = (sha: string): string => {
    let cls = deps.independent.has(sha) ? ' free' : ''
    if (sha === focus) return `${cls} focus`
    if (focusLineage !== null) {
      if (focusLineage.up.has(sha)) cls += ' up'
      else if (focusLineage.down.has(sha)) cls += ' down'
      else cls += ' dim'
    }
    return cls
  }

  return (
    <div className="stack-graph">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        // Shrink to the pane, but never below MIN_SCALE — past that a bushy
        // DAG turns unreadable, so the container scrolls instead.
        style={{ width: '100%', height: 'auto', maxWidth: width, minWidth: width * MIN_SCALE }}
        aria-label={t('stack.viewGraph')}
      >
        <defs>
          {(['sg-arrow', 'sg-arrow-up', 'sg-arrow-down'] as const).map((id) => (
            <marker
              key={id}
              id={id}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" />
            </marker>
          ))}
        </defs>
        {layout.edges.map((e) => {
          const a = at.get(e.from)
          const b = at.get(e.to)
          if (!a || !b) return null
          const x1 = x(a.row) + NODE_W / 2
          const y1 = y(a.layer)
          const x2 = x(b.row) + NODE_W / 2
          const y2 = y(b.layer) + NODE_H + 2
          const my = (y1 + y2) / 2
          const cls = edgeClass(e.from, e.to)
          const marker = cls === ' up' ? 'sg-arrow-up' : cls === ' down' ? 'sg-arrow-down' : 'sg-arrow'
          return (
            <path
              key={`${e.from}→${e.to}`}
              className={`sg-edge${cls}`}
              d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
              strokeWidth={1.2 + Math.min(e.via, 5) * 0.35}
              markerEnd={`url(#${marker})`}
            >
              <title>
                {t('stack.edgeTip', {
                  from: titleOf.get(e.from) ?? e.from.slice(0, 7),
                  to: titleOf.get(e.to) ?? e.to.slice(0, 7),
                  count: e.via,
                })}
              </title>
            </path>
          )
        })}
        {commits.map((c) => {
          const n = at.get(c.sha)
          if (!n) return null
          const approved = props.approvedShas.has(c.sha)
          const unresolved = props.unresolvedBySha.get(c.sha) ?? 0
          return (
            <g
              key={c.sha}
              className={`sg-node${nodeClass(c.sha)}`}
              transform={`translate(${x(n.row)}, ${y(n.layer)})`}
              role="button"
              tabIndex={0}
              aria-label={c.title}
              onClick={() => onSelect(c.sha)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  onSelect(c.sha)
                }
              }}
              onMouseEnter={() => setHover(c.sha)}
              onMouseLeave={() => setHover(null)}
            >
              <rect width={NODE_W} height={NODE_H} rx={10}>
                <title>{c.title}</title>
              </rect>
              <foreignObject width={NODE_W} height={NODE_H}>
                <div className="sg-label">
                  <span className="sg-title">{c.title}</span>
                  <span className="sg-meta">
                    {deps.independent.has(c.sha) && (
                      <span className="sg-free">{t('stack.independent')}</span>
                    )}
                    {approved && (
                      <span className="sg-approved">
                        <CheckCircle2 size={10} strokeWidth={2} />
                      </span>
                    )}
                    <span className="sha">{c.sha.slice(0, 7)}</span>
                    {unresolved > 0 && <span className="count-pill">{unresolved}</span>}
                  </span>
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>
      <footer className="sg-legend" title={t('stack.legendTip')}>
        <span className="sg-legend-item">
          <span className="sg-key up" /> {t('stack.legendUp')}
        </span>
        <span className="sg-legend-item">
          <span className="sg-key down" /> {t('stack.legendDown')}
        </span>
        <span className="sg-legend-item">
          <span className="sg-key free" /> {t('stack.independent')}
        </span>
        <span className="spacer" />
        <span>{t('stack.legendFlow')}</span>
      </footer>
    </div>
  )
}
