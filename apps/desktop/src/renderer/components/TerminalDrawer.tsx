import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelBottom, PanelRight, RotateCcw, X } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store/store'

/** Session ids are 36-char uuids; pty:data payloads are id-prefixed. */
const ID_LEN = 36

/** The terminal panel; docks at the bottom or the right (Fork-style). */
export function TerminalDrawer(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.terminalOpen)
  const dock = useAppStore((s) => s.terminalDock)
  const setDock = useAppStore((s) => s.setTerminalDock)
  const toggle = useAppStore((s) => s.toggleTerminal)
  const projectId = useAppStore((s) => s.currentProjectId)
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(0)
  const pendingInput = useAppStore((s) => s.pendingTerminalInput)
  const clearPendingInput = useAppStore((s) => s.clearPendingTerminalInput)

  // Queued input (agent summon) is typed into the shell, never executed —
  // the user reviews the command and presses Enter.
  useEffect(() => {
    const id = sessionRef.current
    if (!pendingInput || !id) return
    void window.isomer.invoke('pty:input', { id, data: pendingInput })
    clearPendingInput()
  }, [pendingInput, ready, clearPendingInput])

  useEffect(() => {
    if (!open || !projectId || !containerRef.current) return
    setError(null)
    const term = new Terminal({
      fontFamily: 'SF Mono, JetBrains Mono, Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    let sessionId: string | null = null
    let disposed = false
    // Subscribe BEFORE creating the session: the shell's first prompt can
    // arrive ahead of the create-response, so buffer payloads until the
    // session id is known, then replay the ones that match.
    const early: string[] = []
    const unsubs: (() => void)[] = [
      window.isomer.on('pty:data', (payload) => {
        if (sessionId === null) early.push(payload)
        else if (payload.slice(0, ID_LEN) === sessionId) term.write(payload.slice(ID_LEN))
      }),
      window.isomer.on('pty:exit', ({ id }) => {
        if (id === sessionId) toggle()
      }),
    ]

    void window.isomer
      .invoke('pty:create', { projectId, cols: term.cols, rows: term.rows })
      .then((r) => {
        if (!r.ok) {
          // Keep the drawer open and say what broke — a flash-close reads
          // as a crash and hides the actual error.
          if (!disposed) setError(`${r.error.code}: ${r.error.message}`)
          return
        }
        if (disposed) {
          // The drawer closed while the session was being created; the
          // cleanup below never saw this id, so reap it here.
          void window.isomer.invoke('pty:kill', { id: r.data.id })
          return
        }
        sessionId = r.data.id
        sessionRef.current = sessionId
        setReady((n) => n + 1)
        for (const payload of early.splice(0)) {
          if (payload.slice(0, ID_LEN) === sessionId) term.write(payload.slice(ID_LEN))
        }
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : String(e))
      })

    const dataSub = term.onData((data) => {
      if (sessionId) void window.isomer.invoke('pty:input', { id: sessionId, data })
    })
    const resizeObserver = new ResizeObserver(() => {
      fit.fit()
      if (sessionId) {
        void window.isomer.invoke('pty:resize', { id: sessionId, cols: term.cols, rows: term.rows })
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      disposed = true
      dataSub.dispose()
      resizeObserver.disconnect()
      for (const u of unsubs) u()
      sessionRef.current = null
      if (sessionId) void window.isomer.invoke('pty:kill', { id: sessionId })
      term.dispose()
    }
  }, [open, projectId, toggle, attempt])

  if (!open) return null
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
      {error ? (
        <div className="terminal-error">
          <p className="mono">{error}</p>
          <button className="ghost-btn" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCcw size={12} strokeWidth={1.8} /> {t('terminal.retry')}
          </button>
        </div>
      ) : (
        <div className="terminal-host" ref={containerRef} />
      )}
    </div>
  )
}
