import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Download,
  GitBranch,
  PanelLeft,
  Settings,
  SquareTerminal,
} from 'lucide-react'
import { useState } from 'react'
import { ChangesView } from './components/ChangesView'
import { HistoryView } from './components/HistoryView'
import { OrganizeView } from './components/OrganizeView'
import { QuickLaunch } from './components/QuickLaunch'
import { Inspector } from './components/Inspector'
import { ProjectRail } from './components/ProjectRail'
import { ReviewView } from './components/ReviewView'
import { SettingsPage } from './components/SettingsPage'
import { RepoManager } from './components/RepoManager'
import { Sidebar } from './components/Sidebar'
import { StackView } from './components/StackView'
import { TerminalDrawer } from './components/TerminalDrawer'
import { useAppStore } from './store/store'
import { useTheme } from './theme/useTheme'
import { Splitter, usePaneSize } from './resize'
import './app.css'

function StackColumns(): React.JSX.Element {
  const [stackW, resizeStack] = usePaneSize('stack-col', 300, 220, 480)
  const [inspW, resizeInsp] = usePaneSize('inspector-col', 320, 240, 520)
  return (
    <main className="columns">
      <div className="pane-wrap" style={{ width: stackW }}>
        <StackView />
      </div>
      <Splitter axis="x" onDelta={resizeStack} />
      <ReviewView />
      <Splitter axis="x" onDelta={(d) => resizeInsp(-d)} />
      <div className="pane-wrap" style={{ width: inspW }}>
        <Inspector />
      </div>
    </main>
  )
}

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const snapshot = useAppStore((s) => s.snapshot)
  const view = useAppStore((s) => s.view)
  const netBusy = useAppStore((s) => s.netBusy)
  const netNote = useAppStore((s) => s.netNote)
  const runNet = useAppStore((s) => s.runNet)
  const doStash = useAppStore((s) => s.doStash)
  const status = useAppStore((s) => s.status)
  const bootstrap = useAppStore((s) => s.bootstrap)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const openSettings = useAppStore((s) => s.openSettings)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const updateInfo = useAppStore((s) => s.updateInfo)
  const openExternal = useAppStore((s) => s.openExternal)
  const lastError = useAppStore((s) => s.lastError)
  const clearError = useAppStore((s) => s.clearError)
  useTheme(settings.theme)

  const [palette, setPalette] = useState(false)
  const [pushMenu, setPushMenu] = useState(false)

  useEffect(() => {
    if (window.isomer.platform === 'darwin') {
      document.documentElement.dataset.vibrancy = '1'
    }
    void bootstrap()
  }, [bootstrap])

  // Fork's Quick Launch: Cmd+P (Ctrl+P elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const project = projects.find((p) => p.id === currentProjectId)
  const terminalOpen = useAppStore((s) => s.terminalOpen)
  const terminalDock = useAppStore((s) => s.terminalDock)
  const [sidebarW, resizeSidebar] = usePaneSize('sidebar', 200, 150, 340)
  const [termH, resizeTermH] = usePaneSize('terminal-h', 240, 120, 560)
  const [termW, resizeTermW] = usePaneSize('terminal-w', 380, 240, 720)
  const ICONS = {
    fetch: <ArrowDownToLine size={16} strokeWidth={1.8} />,
    pull: <ArrowDown size={16} strokeWidth={1.8} />,
    push: <ArrowUp size={16} strokeWidth={1.8} />,
  }
  const netBtn = (verb: 'fetch' | 'pull' | 'push'): React.JSX.Element => (
    <button
      className="toolbar-btn"
      disabled={netBusy !== null || !project}
      onClick={() => void runNet(verb)}
      onContextMenu={
        verb === 'push'
          ? (e) => {
              e.preventDefault()
              setPushMenu(true)
            }
          : undefined
      }
    >
      <span className="toolbar-icon">{netBusy === verb ? '…' : ICONS[verb]}</span>
      <span>{t(`toolbar.${verb}`)}</span>
    </button>
  )

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="toolbar">
          <button
            className={`toolbar-btn icon-only${sidebarCollapsed ? '' : ' active'}`}
            title={t('sidebar.toggle')}
            onClick={toggleSidebar}
          >
            <span className="toolbar-icon">
              <PanelLeft size={16} strokeWidth={1.8} />
            </span>
          </button>
          {netBtn('fetch')}
          {netBtn('pull')}
          {netBtn('push')}
          <button
            className="toolbar-btn"
            disabled={!project || (status?.entries.length ?? 0) === 0}
            onClick={() => void doStash()}
          >
            <span className="toolbar-icon">
              <Archive size={16} strokeWidth={1.8} />
            </span>
            <span>{t('toolbar.stash')}</span>
          </button>
        </div>
        <div className="repo-card">
          <span className="titlebar-project">{project?.name ?? t('app.title')}</span>
          {snapshot && (
            <span className="titlebar-branch mono">
              <GitBranch size={11} strokeWidth={2} /> {snapshot.branch}
            </span>
          )}
        </div>
        <span className="spacer" />
        {updateInfo && (
          <button
            className="update-chip"
            title={t('settings.updateAvailable', { version: updateInfo.version })}
            onClick={() => void openExternal(updateInfo.url)}
          >
            <Download size={13} strokeWidth={1.8} />
            {t('app.updateReady', { version: updateInfo.version })}
          </button>
        )}
        {netNote && <span className="net-note mono">{netNote}</span>}
        {lastError && (
          <button className="error-chip" onClick={clearError} title={lastError.hint ?? ''}>
            {lastError.code}: {lastError.message}
          </button>
        )}
      </header>
      <div className="main-row">
        <ProjectRail />
        {!sidebarCollapsed && (
          <>
            <div className="pane-wrap" style={{ width: sidebarW }}>
              <Sidebar />
            </div>
            <Splitter axis="x" onDelta={resizeSidebar} />
          </>
        )}
        {view === 'changes' && <ChangesView />}
        {view === 'history' && <HistoryView />}
        {view === 'stack' && <StackColumns />}
        {view === 'organize' && <OrganizeView />}
        {terminalOpen && terminalDock === 'right' && (
          <>
            <Splitter axis="x" onDelta={(d) => resizeTermW(-d)} />
            <div className="pane-wrap" style={{ width: termW }}>
              <TerminalDrawer />
            </div>
          </>
        )}
      </div>
      {terminalOpen && terminalDock === 'bottom' && (
        <>
          <Splitter axis="y" onDelta={(d) => resizeTermH(-d)} />
          <div className="pane-wrap" style={{ height: termH }}>
            <TerminalDrawer />
          </div>
        </>
      )}
      <SettingsPage />
      <RepoManager />
      {palette && <QuickLaunch onClose={() => setPalette(false)} />}
      {pushMenu && (
        <div className="modal-backdrop" onClick={() => setPushMenu(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <span>{t('toolbar.pushOptions')}</span>
            </header>
            <div className="push-options">
              <button
                className="ghost-btn"
                onClick={() => {
                  void runNet('push')
                  setPushMenu(false)
                }}
              >
                {t('toolbar.push')}
              </button>
              <button
                className="ghost-btn danger"
                onClick={() => {
                  void runNet('push', { forceWithLease: true })
                  setPushMenu(false)
                }}
              >
                {t('toolbar.forcePush')}
              </button>
            </div>
            <p className="settings-hint">{t('toolbar.forcePushHint')}</p>
          </div>
        </div>
      )}
      <footer className="statusbar">
        <button className="icon-btn labeled" onClick={toggleTerminal}>
          <SquareTerminal size={14} strokeWidth={1.8} />
          {t('terminal.open')}
        </button>
        <span className="spacer" />
        <button className="icon-btn" title={t('settings.title')} onClick={openSettings}>
          <Settings size={14} strokeWidth={1.8} />
        </button>
      </footer>
    </div>
  )
}
