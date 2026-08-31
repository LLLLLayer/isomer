import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Unlink } from 'lucide-react'
import type { CommitInfo } from '../../shared/ism-types'
import type { changeDeps } from '../stackdeps'
import { lineage, railLayout } from '../stackgraph'

const CARD_H = 56
const CARD_GAP = 8
const LANE_W = 12
const RAIL_PAD = 8

/** Graph mode: the list's full-width cards (head first, base at the
 * bottom) plus a left rail where dependency edges run as brackets, arrows
 * pointing from dependency up into dependent. Hovering or selecting a
 * change lights its upstream lineage in accent and its downstream lineage
 * in the graph-5 hue; everything else dims. Cards stay readable at any
 * pane width — only the rail is extra. */
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
  // A hover sha held across a snapshot refresh is meaningless — and if the
  // same sha ever re-enters the stack (undo), it would light up with the
  // mouse nowhere near it.
  useEffect(() => setHover(null), [commits])

  const layout = useMemo(() => railLayout(commits, deps.bySha), [commits, deps])
  // Within one render a sha can still be unknown (selection from another
  // view); an unknown focus would return empty lineage sets and dim the
  // whole graph.
  const known = (sha: string | null): string | null =>
    sha !== null && commits.some((c) => c.sha === sha) ? sha : null
  const focus = known(hover) ?? known(selected)
  const focusLineage = useMemo(
    () => (focus !== null ? lineage(focus, deps.bySha) : null),
    [focus, deps],
  )

  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const rowOf = new Map(layout.order.map((sha, row) => [sha, row]))
  const railW = RAIL_PAD * 2 + Math.max(1, layout.lanes) * LANE_W
  const yc = (row: number): number => row * (CARD_H + CARD_GAP) + CARD_H / 2
  const height =
    layout.order.length * CARD_H + Math.max(0, layout.order.length - 1) * CARD_GAP

  const edgeClass = (from: string, to: string): string => {
    if (focus === null || focusLineage === null) return ''
    const { up, down } = focusLineage
    if ((to === focus || up.has(to)) && up.has(from)) return ' up'
    if ((from === focus || down.has(from)) && down.has(to)) return ' down'
    return ' dim'
  }
  const cardClass = (sha: string): string => {
    let cls = sha === selected ? ' active' : ''
    if (focusLineage !== null && sha !== focus) {
      if (focusLineage.up.has(sha)) cls += ' up'
      else if (focusLineage.down.has(sha)) cls += ' down'
      else cls += ' dim'
    }
    return cls
  }

  return (
    <div className="stack-graph">
      <div className="sg-body">
        <svg className="sg-rail" width={railW} height={height} aria-hidden="true">
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
            const a = rowOf.get(e.from)
            const b = rowOf.get(e.to)
            if (a === undefined || b === undefined) return null
            const lx = railW - RAIL_PAD - (e.lane + 1) * LANE_W + LANE_W / 2
            const y1 = yc(a)
            const y2 = yc(b)
            const cls = edgeClass(e.from, e.to)
            const marker =
              cls === ' up' ? 'sg-arrow-up' : cls === ' down' ? 'sg-arrow-down' : 'sg-arrow'
            return (
              <path
                key={`${e.from}→${e.to}`}
                className={`sg-edge${cls}`}
                d={`M ${railW} ${y1} C ${lx} ${y1}, ${lx} ${y2}, ${railW - 3} ${y2}`}
                strokeWidth={1.2 + Math.min(e.via, 5) * 0.35}
                markerEnd={`url(#${marker})`}
              >
                <title>
                  {t('stack.edgeTip', {
                    from: bySha.get(e.from)?.title ?? e.from.slice(0, 7),
                    to: bySha.get(e.to)?.title ?? e.to.slice(0, 7),
                    count: e.via,
                  })}
                </title>
              </path>
            )
          })}
        </svg>
        <ol className="sg-cards">
          {layout.order.map((sha) => {
            const c = bySha.get(sha)
            if (!c) return null
            const free = deps.independent.has(sha)
            const unresolved = props.unresolvedBySha.get(sha) ?? 0
            return (
              <li key={sha}>
                <button
                  className={`change-card sg-card${cardClass(sha)}`}
                  title={c.title}
                  onClick={() => onSelect(sha)}
                  onMouseEnter={() => setHover(sha)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(sha)}
                  onBlur={() => setHover(null)}
                >
                  <span className="summary">{c.title}</span>
                  <span className="badges">
                    {free && (
                      <span className="dep-chip free" title={t('stack.independentTip')}>
                        <Unlink size={10} strokeWidth={2} /> {t('stack.independent')}
                      </span>
                    )}
                    {props.approvedShas.has(sha) && (
                      <span className="sg-approved">
                        <CheckCircle2 size={10} strokeWidth={2} />
                      </span>
                    )}
                    <span className="sha">{sha.slice(0, 7)}</span>
                    {unresolved > 0 && <span className="count-pill">{unresolved}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
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
