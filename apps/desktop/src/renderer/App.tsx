import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Inspector } from './components/Inspector'
import { ProjectRail } from './components/ProjectRail'
import { ReviewView } from './components/ReviewView'
import { StackView } from './components/StackView'
import { TerminalDrawer } from './components/TerminalDrawer'
import { useAppStore } from './store/store'
import { useTheme } from './theme/useTheme'
import './app.css'

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const bootstrap = useAppStore((s) => s.bootstrap)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const lastError = useAppStore((s) => s.lastError)
  const clearError = useAppStore((s) => s.clearError)
  useTheme(settings.theme)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  return (
    <div className="app-shell">
      <div className="main-row">
        <ProjectRail />
        <main className="columns">
          <StackView />
          <ReviewView />
          <Inspector />
        </main>
      </div>
      <TerminalDrawer />
      <footer className="statusbar">
        <button className="link" onClick={toggleTerminal}>
          {t('terminal.open')}
        </button>
        <span className="spacer" />
        {lastError && (
          <button className="error mono" onClick={clearError} title={lastError.hint ?? ''}>
            {lastError.code}: {lastError.message}
          </button>
        )}
        <select
          value={settings.theme}
          onChange={(e) => void updateSettings({ theme: e.target.value as never })}
        >
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
        <select
          value={settings.language}
          onChange={(e) => void updateSettings({ language: e.target.value as never })}
        >
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
      </footer>
    </div>
  )
}
