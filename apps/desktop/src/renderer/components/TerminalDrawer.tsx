import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store/store'

/** Session ids are 36-char uuids; pty:data payloads are id-prefixed. */
const ID_LEN = 36

export function TerminalDrawer(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.terminalOpen)
  const toggle = useAppStore((s) => s.toggleTerminal)
  const projectId = useAppStore((s) => s.currentProjectId)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !projectId || !containerRef.current) return
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
    const unsubs: (() => void)[] = []

    void window.isomer
      .invoke('pty:create', { projectId, cols: term.cols, rows: term.rows })
      .then((r) => {
        if (!r.ok || disposed) return
        sessionId = r.data.id
        unsubs.push(
          window.isomer.on('pty:data', (payload) => {
            if (payload.slice(0, ID_LEN) === sessionId) term.write(payload.slice(ID_LEN))
          }),
          window.isomer.on('pty:exit', ({ id }) => {
            if (id === sessionId) toggle()
          }),
        )
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
      if (sessionId) void window.isomer.invoke('pty:kill', { id: sessionId })
      term.dispose()
    }
  }, [open, projectId, toggle])

  if (!open) return null
  return (
    <div className="terminal-drawer">
      <header className="pane-title">
        {t('terminal.title')}
        <span className="spacer" />
        <button className="link" onClick={toggle}>
          {t('terminal.close')}
        </button>
      </header>
      <div className="terminal-host" ref={containerRef} />
    </div>
  )
}
