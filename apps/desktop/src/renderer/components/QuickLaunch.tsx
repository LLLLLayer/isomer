import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Command, CornerDownLeft } from 'lucide-react'
import { useAppStore } from '../store/store'

interface Entry {
  id: string
  label: string
  hint: string
  run: () => void
}

/** Subsequence fuzzy score: higher is better, -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const s = text.toLowerCase()
  if (q === '') return 0
  let qi = 0
  let score = 0
  let streak = 0
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      qi++
      streak++
      score += streak * 2 + (i === 0 || s[i - 1] === ' ' || s[i - 1] === '/' ? 5 : 0)
    } else {
      streak = 0
    }
  }
  return qi === q.length ? score - s.length * 0.01 : -1
}

/** Fork's Quick Launch: Cmd+P palette over views, actions, branches,
 * and recent commits. */
export function QuickLaunch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const setView = useAppStore((s) => s.setView)
  const refs = useAppStore((s) => s.refs)
  const log = useAppStore((s) => s.log)
  const branchOp = useAppStore((s) => s.branchOp)
  const selectCommit = useAppStore((s) => s.selectCommit)
  const runNet = useAppStore((s) => s.runNet)
  const doStash = useAppStore((s) => s.doStash)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const openSettings = useAppStore((s) => s.openSettings)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const entries = useMemo((): Entry[] => {
    const out: Entry[] = [
      { id: 'v-changes', label: t('sidebar.localChanges'), hint: t('quick.view'), run: () => setView('changes') },
      { id: 'v-history', label: t('sidebar.allCommits'), hint: t('quick.view'), run: () => setView('history') },
      { id: 'v-stack', label: t('sidebar.stack'), hint: t('quick.view'), run: () => setView('stack') },
      { id: 'v-organize', label: t('sidebar.organize'), hint: t('quick.view'), run: () => setView('organize') },
      { id: 'a-fetch', label: t('toolbar.fetch'), hint: t('quick.action'), run: () => void runNet('fetch') },
      { id: 'a-pull', label: t('toolbar.pull'), hint: t('quick.action'), run: () => void runNet('pull') },
      { id: 'a-push', label: t('toolbar.push'), hint: t('quick.action'), run: () => void runNet('push') },
      { id: 'a-stash', label: t('toolbar.stash'), hint: t('quick.action'), run: () => void doStash() },
      { id: 'a-term', label: t('terminal.open'), hint: t('quick.action'), run: toggleTerminal },
      { id: 'a-settings', label: t('settings.title'), hint: t('quick.action'), run: openSettings },
    ]
    for (const name of Object.keys(refs?.locals ?? {})) {
      out.push({
        id: `b-${name}`,
        label: name,
        hint: t('quick.checkout'),
        run: () => void branchOp({ kind: 'checkout', branch: name }),
      })
    }
    for (const e of log.slice(0, 50)) {
      out.push({
        id: `c-${e.sha}`,
        label: e.title,
        hint: e.sha.slice(0, 8),
        run: () => {
          setView('history')
          void selectCommit(e.sha)
        },
      })
    }
    return out
  }, [t, refs, log, setView, branchOp, selectCommit, runNet, doStash, toggleTerminal, openSettings])

  const matches = useMemo(() => {
    const scored = entries
      .map((e) => ({ e, score: fuzzyScore(query, e.label) }))
      .filter((x) => x.score >= 0)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 12).map((x) => x.e)
  }, [entries, query])

  const active = matches[Math.min(cursor, matches.length - 1)]

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && active) {
      active.run()
      onClose()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Command size={14} strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('quick.placeholder')}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKey}
          />
        </div>
        <div className="palette-list">
          {matches.map((m, i) => (
            <button
              key={m.id}
              className={`palette-row${m === active ? ' active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => {
                m.run()
                onClose()
              }}
            >
              <span className="palette-label">{m.label}</span>
              <span className="spacer" />
              <span className="palette-hint">{m.hint}</span>
              {m === active && <CornerDownLeft size={12} strokeWidth={1.8} />}
            </button>
          ))}
          {matches.length === 0 && <p className="empty">{t('insight.none')}</p>}
        </div>
      </div>
    </div>
  )
}
