import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelBottom, PanelRight, RotateCcw, X } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store/store'

/** Session ids are 36-char uuids; pty:data payloads are id-prefixed. */
const ID_LEN = 36

/**
 * The pty session lives OUTSIDE the component. Docking the drawer left or
 * bottom moves it to a different tree position, and React remounts across
 * parents — a component-owned session would kill the running shell (and any
 * agent in it) on every dock switch. The component only borrows the session:
 * it attaches the xterm element on mount and detaches on unmount; disposal
 * happens when nothing re-attaches (drawer closed) or the project changes.
 */
interface LiveSession {
  projectId: string
  term: Terminal
  fit: FitAddon
  sessionId: string | null
  creating: boolean
  error: string | null
  unsubs: (() => void)[]
  /** Re-render hook for the currently mounted drawer, if any. */
  onState: (() => void) | null
}

let live: LiveSession | null = null
let attachCount = 0

function disposeLive(): void {
  if (!live) return
  const s = live
  live = null
  for (const u of s.unsubs) u()
  if (s.sessionId) void window.isomer.invoke('pty:kill', { id: s.sessionId })
  s.term.dispose()
}

function createLive(projectId: string): LiveSession {
  const term = new Terminal({
    fontFamily: 'SF Mono, JetBrains Mono, Menlo, monospace',
    fontSize: 12,
    cursorBlink: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const s: LiveSession = {
    projectId,
    term,
    fit,
    sessionId: null,
    creating: false,
    error: null,
    unsubs: [],
    onState: null,
  }
  // Subscribe BEFORE creating the session: the shell's first prompt can
  // arrive ahead of the create-response, so buffer payloads until the
  // session id is known, then replay the ones that match.
  const early: string[] = []
  s.unsubs.push(
    window.isomer.on('pty:data', (payload) => {
      if (s.sessionId === null) early.push(payload)
      else if (payload.slice(0, ID_LEN) === s.sessionId) term.write(payload.slice(ID_LEN))
    }),
    window.isomer.on('pty:exit', ({ id }) => {
      if (id === s.sessionId && live === s) {
        disposeLive()
        useAppStore.setState({ terminalOpen: false })
      }
    }),
  )
  const dataSub = term.onData((data) => {
    if (s.sessionId) void window.isomer.invoke('pty:input', { id: s.sessionId, data })
  })
  s.unsubs.push(() => dataSub.dispose())
  ;(s as { earlyBuf?: string[] }).earlyBuf = early
  return s
}

function spawnPty(s: LiveSession): void {
  if (s.creating || s.sessionId) return
  s.creating = true
  void window.isomer
    .invoke('pty:create', { projectId: s.projectId, cols: s.term.cols, rows: s.term.rows })
    .then((r) => {
      s.creating = false
      if (!r.ok) {
        // Keep the drawer open and say what broke — a flash-close reads
        // as a crash and hides the actual error.
        s.error = `${r.error.code}: ${r.error.message}`
        s.onState?.()
        return
      }
      if (live !== s) {
        // Disposed while the session was being created; reap it here.
        void window.isomer.invoke('pty:kill', { id: r.data.id })
        return
      }
      s.sessionId = r.data.id
      const early = (s as { earlyBuf?: string[] }).earlyBuf ?? []
      for (const payload of early.splice(0)) {
        if (payload.slice(0, ID_LEN) === s.sessionId) s.term.write(payload.slice(ID_LEN))
      }
      s.onState?.()
    })
    .catch((e: unknown) => {
      s.creating = false
      s.error = e instanceof Error ? e.message : String(e)
      s.onState?.()
    })
}

/** The terminal panel; docks at the bottom or the right (Fork-style). */
export function TerminalDrawer(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.terminalOpen)
  const dock = useAppStore((s) => s.terminalDock)
  const setDock = useAppStore((s) => s.setTerminalDock)
  const toggle = useAppStore((s) => s.toggleTerminal)
  const projectId = useAppStore((s) => s.currentProjectId)
  const pendingInput = useAppStore((s) => s.pendingTerminalInput)
  const clearPendingInput = useAppStore((s) => s.clearPendingTerminalInput)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tick, force] = useState(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || !projectId || !containerRef.current) return
    if (live && live.projectId !== projectId) disposeLive()
    if (!live) live = createLive(projectId)
    const s = live
    attachCount++
    s.onState = () => force((n) => n + 1)

    const el = containerRef.current
    if (s.term.element) el.appendChild(s.term.element)
    else s.term.open(el)
    s.fit.fit()
    spawnPty(s)

    const resizeObserver = new ResizeObserver(() => {
      s.fit.fit()
      if (s.sessionId) {
        void window.isomer.invoke('pty:resize', {
          id: s.sessionId,
          cols: s.term.cols,
          rows: s.term.rows,
        })
      }
    })
    resizeObserver.observe(el)

    return () => {
      attachCount--
      resizeObserver.disconnect()
      if (s.onState) s.onState = null
      s.term.element?.remove()
      // Dispose only when nothing re-attaches (dock switches remount the
      // drawer in the same tick; a real close leaves the count at zero).
      setTimeout(() => {
        if (attachCount === 0 && live === s) disposeLive()
      }, 50)
    }
  }, [open, projectId, attempt])

  // Queued input (agent summon) is typed into the shell, never executed —
  // the user reviews the command and presses Enter.
  useEffect(() => {
    if (!pendingInput || !live?.sessionId) return
    void window.isomer.invoke('pty:input', { id: live.sessionId, data: pendingInput })
    clearPendingInput()
  }, [pendingInput, tick, clearPendingInput])

  if (!open) return null
  const error = live?.error ?? null
  return (
    <div className={`terminal-drawer ${dock}`}>
      <header className="pane-title">
        {t('terminal.title')}
        <span className="spacer" />
        <button
          className={`icon-btn${dock === 'bottom' ? ' active' : ''}`}
          title={t('terminal.dockBottom')}
          onClick={() => setDock('bottom')}
        >
          <PanelBottom size={14} strokeWidth={1.8} />
        </button>
        <button
          className={`icon-btn${dock === 'right' ? ' active' : ''}`}
          title={t('terminal.dockRight')}
          onClick={() => setDock('right')}
        >
          <PanelRight size={14} strokeWidth={1.8} />
        </button>
        <button className="icon-btn" title={t('terminal.close')} onClick={toggle}>
          <X size={14} strokeWidth={1.8} />
        </button>
      </header>
      <div
        className="terminal-host"
        ref={containerRef}
        style={error ? { display: 'none' } : undefined}
      />
      {error && (
        <div className="terminal-error">
          <p className="mono">{error}</p>
          <button
            className="ghost-btn"
            onClick={() => {
              disposeLive()
              setAttempt((a) => a + 1)
            }}
          >
            <RotateCcw size={12} strokeWidth={1.8} /> {t('terminal.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
