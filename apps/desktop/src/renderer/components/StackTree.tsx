import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Link2, Unlink } from 'lucide-react'
import type { CommitInfo } from '../../shared/ism-types'
import type { changeDeps } from '../stackdeps'
import { lineage, stackTree } from '../stacktree'

/** Tree mode: the stack as an outline. Indentation means "builds on it"
 * (base always first), and every row keeps its #n landing position — the
 * subtree grouping may locally reorder rows, the badge never lies.
 * Diamond arms beyond the tree edge become clickable "+ needs" chips.
 * Selecting or hovering a change adds color to its upstream (accent) and
 * downstream (graph-5) lineage — nothing is dimmed. */
export function StackTree(props: {
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

  const rows = useMemo(() => stackTree(commits, deps.bySha), [commits, deps])
  // Within one render a sha can still be unknown (selection from another
  // view); an unknown focus would return empty lineage sets.
  const known = (sha: string | null): string | null =>
    sha !== null && commits.some((c) => c.sha === sha) ? sha : null
  const focus = known(hover) ?? known(selected)
  const focusLineage = useMemo(
    () => (focus !== null ? lineage(focus, deps.bySha) : null),
    [focus, deps],
  )

  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const titleOf = (sha: string): string => bySha.get(sha)?.title ?? sha.slice(0, 7)
  // Chip labels must never outgrow the card — the full title stays in the
  // tooltip.
  const short = (title: string): string => {
    const points = [...title]
    return points.length > 18 ? `${points.slice(0, 17).join('')}…` : title
  }
  const cardClass = (sha: string): string => {
    let cls = sha === selected ? ' active' : ''
    if (focusLineage !== null && sha !== focus) {
      if (focusLineage.up.has(sha)) cls += ' up'
      else if (focusLineage.down.has(sha)) cls += ' down'
    }
    return cls
  }

  return (
    <div className="stack-graph">
      <ol className="outline-list">
        {rows.map((row) => {
          const c = bySha.get(row.sha)
          if (!c) return null
          const free = deps.independent.has(row.sha)
          const unresolved = props.unresolvedBySha.get(row.sha) ?? 0
          return (
            <li key={row.sha} className="outline-row">
              {row.guides.map((line, i) => (
                <span key={i} className={`outline-guide${line ? ' line' : ''}`} />
              ))}
              {row.depth > 0 && (
                <span className={`outline-elbow${row.last ? '' : ' mid'}`} />
              )}
              <button
                className={`change-card sg-card${cardClass(row.sha)}`}
                title={c.title}
                onClick={() => onSelect(row.sha)}
                onMouseEnter={() => setHover(row.sha)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(row.sha)}
                onBlur={() => setHover(null)}
              >
                <span className="summary">{c.title}</span>
                <span className="badges">
                  <span className="outline-pos" title={t('stack.posTip', { n: row.pos })}>
                    #{row.pos}
                  </span>
                  {free && (
                    <span className="dep-chip free" title={t('stack.independentTip')}>
                      <Unlink size={10} strokeWidth={2} /> {t('stack.independent')}
                    </span>
                  )}
                  {props.approvedShas.has(row.sha) && (
                    <span className="sg-approved">
                      <CheckCircle2 size={10} strokeWidth={2} />
                    </span>
                  )}
                  <span className="sha">{row.sha.slice(0, 7)}</span>
                  {unresolved > 0 && <span className="count-pill">{unresolved}</span>}
                  {row.extraNeeds.map((n) => (
                    <span
                      key={n.target}
                      className="dep-chip"
                      title={t('stack.needsTip', { target: titleOf(n.target), count: n.via })}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onSelect(n.target)
                      }}
                    >
                      <Link2 size={10} strokeWidth={2} />{' '}
                      {t('stack.extraNeeds', { target: short(titleOf(n.target)) })}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <footer className="sg-legend" title={t('stack.legendTip')}>
        <span className="sg-legend-item">
          <span className="sg-key up" /> {t('stack.legendUp')}
        </span>
        <span className="sg-legend-item">
          <span className="sg-key down" /> {t('stack.legendDown')}
        </span>
        <span className="spacer" />
        <span>{t('stack.legendFlow')}</span>
      </footer>
    </div>
  )
}
