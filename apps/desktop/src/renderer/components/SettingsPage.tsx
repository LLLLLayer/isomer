import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  Download,
  Info,
  Palette,
  RefreshCw,
  TerminalSquare,
  XCircle,
} from 'lucide-react'
import { useAppStore } from '../store/store'

type SectionKey = 'general' | 'integration' | 'updates' | 'about'

const AGENT_PRESETS = ['claude', 'claude --continue', 'codex', 'aider']

/** Full-page preferences (the user asked for a page, not a floating box):
 * left section nav, roomy content, everything saved on change. */
export function SettingsPage(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const detection = useAppStore((s) => s.ismDetection)
  const detectIsm = useAppStore((s) => s.detectIsm)
  const updateInfo = useAppStore((s) => s.updateInfo)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const checkUpdate = useAppStore((s) => s.checkUpdate)
  const openExternal = useAppStore((s) => s.openExternal)
  const [section, setSection] = useState<SectionKey>('general')
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (!open) return
    void window.isomer.invoke('app:version', undefined).then(setVersion)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const segmented = <T extends string>(
    value: T,
    options: { value: T; label: string }[],
    onChange: (v: T) => void,
  ): React.JSX.Element => (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )

  const NAV: { key: SectionKey; icon: React.JSX.Element; label: string }[] = [
    { key: 'general', icon: <Palette size={14} strokeWidth={1.8} />, label: t('settings.general') },
    {
      key: 'integration',
      icon: <TerminalSquare size={14} strokeWidth={1.8} />,
      label: t('settings.integration'),
    },
    {
      key: 'updates',
      icon: <Download size={14} strokeWidth={1.8} />,
      label: t('settings.updates'),
    },
    { key: 'about', icon: <Info size={14} strokeWidth={1.8} />, label: t('settings.about') },
  ]

  return (
    <div className="settings-page">
      <header className="settings-top">
        <button className="icon-btn labeled" onClick={close}>
          <ArrowLeft size={14} strokeWidth={1.8} />
          {t('settings.back')}
        </button>
        <span className="settings-title">{t('settings.title')}</span>
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`side-item${section === n.key ? ' active' : ''}`}
              onClick={() => setSection(n.key)}
            >
              <span className="side-icon">{n.icon}</span>
              <span className="side-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === 'general' && (
            <>
              <section className="settings-section">
                <h4>{t('settings.appearance')}</h4>
                <div className="settings-row">
                  <label>{t('settings.theme')}</label>
                  {segmented(
                    settings.theme,
                    [
                      { value: 'system' as const, label: t('settings.themeSystem') },
                      { value: 'light' as const, label: t('settings.themeLight') },
                      { value: 'dark' as const, label: t('settings.themeDark') },
                    ],
                    (theme) => void updateSettings({ theme }),
                  )}
                </div>
                <div className="settings-row">
                  <label>{t('settings.language')}</label>
                  {segmented(
                    settings.language,
                    [
                      { value: 'en' as const, label: 'English' },
                      { value: 'zh-CN' as const, label: '中文' },
                    ],
                    (language) => void updateSettings({ language }),
                  )}
                </div>
                <div className="settings-row">
                  <label>{t('settings.diffLayout')}</label>
                  {segmented(
                    settings.diffLayout,
                    [
                      { value: 'split' as const, label: t('review.sideBySide') },
                      { value: 'unified' as const, label: t('review.unified') },
                    ],
                    (diffLayout) => void updateSettings({ diffLayout }),
                  )}
                </div>
              </section>
            </>
          )}

          {section === 'integration' && (
            <>
              <section className="settings-section">
                <h4>
                  <Bot size={13} strokeWidth={1.8} /> {t('settings.agentCommand')}
                </h4>
                <p className="settings-hint">{t('settings.agentCommandHint')}</p>
                <div className="preset-row">
                  {AGENT_PRESETS.map((cmd) => (
                    <button
                      key={cmd}
                      className={`preset-chip mono${settings.agentCommand === cmd ? ' active' : ''}`}
                      onClick={() => void updateSettings({ agentCommand: cmd })}
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
                <input
                  className="settings-input mono"
                  value={settings.agentCommand}
                  onChange={(e) => void updateSettings({ agentCommand: e.target.value })}
                />
              </section>

              <section className="settings-section">
                <h4>{t('settings.ismPath')}</h4>
                <div className={`detect-card${detection ? ' ok' : detection === null ? ' bad' : ''}`}>
                  {detection === undefined && <span>{t('settings.detecting')}</span>}
                  {detection === null && (
                    <>
                      <XCircle size={14} strokeWidth={1.8} />
                      <span>{t('settings.ismMissing')}</span>
                    </>
                  )}
                  {detection && (
                    <>
                      <CheckCircle2 size={14} strokeWidth={1.8} />
                      <span>
                        ism {detection.version} · <span className="mono">{detection.path}</span> ·{' '}
                        {t(`settings.source.${detection.source}`)}
                      </span>
                    </>
                  )}
                  <span className="spacer" />
                  <button className="ghost-btn" onClick={() => void detectIsm()}>
                    <RefreshCw size={12} strokeWidth={1.8} /> {t('settings.redetect')}
                  </button>
                </div>
                <p className="settings-hint">{t('settings.ismPathHint')}</p>
                <input
                  className="settings-input mono"
                  placeholder={t('settings.ismPathPlaceholder')}
                  value={settings.ismPath}
                  onChange={(e) => void updateSettings({ ismPath: e.target.value })}
                  onBlur={() => void detectIsm()}
                />
              </section>
            </>
          )}

          {section === 'updates' && (
            <section className="settings-section">
              <h4>{t('settings.updates')}</h4>
              <div className="settings-row">
                <label>{t('settings.currentVersion')}</label>
                <span className="mono">{version ? `v${version}` : '…'}</span>
                <span className="spacer" />
                <button
                  className="ghost-btn"
                  disabled={updateStatus === 'checking'}
                  onClick={() => void checkUpdate()}
                >
                  <RefreshCw size={12} strokeWidth={1.8} />
                  {updateStatus === 'checking'
                    ? t('settings.checking')
                    : t('settings.checkUpdates')}
                </button>
              </div>
              {updateStatus === 'error' && (
                <p className="settings-hint">{t('settings.updateError')}</p>
              )}
              {updateInfo === null && updateStatus === 'idle' && (
                <p className="settings-hint">{t('settings.upToDate')}</p>
              )}
              {updateInfo && (
                <div className="update-card">
                  <div className="update-head">
                    <Download size={14} strokeWidth={1.8} />
                    <strong>{t('settings.updateAvailable', { version: updateInfo.version })}</strong>
                    <span className="spacer" />
                    <button
                      className="primary-btn"
                      onClick={() => void openExternal(updateInfo.url)}
                    >
                      {t('settings.download')}
                    </button>
                  </div>
                  {updateInfo.notes && <pre className="update-notes">{updateInfo.notes}</pre>}
                </div>
              )}
            </section>
          )}

          {section === 'about' && (
            <section className="settings-section">
              <h4>{t('settings.about')}</h4>
              <p className="settings-hint">{t('settings.aboutBlurb')}</p>
              <div className="settings-row">
                <label>{t('settings.repository')}</label>
                <button
                  className="link"
                  onClick={() => void openExternal('https://github.com/LLLLLayer/isomer')}
                >
                  github.com/LLLLLayer/isomer
                </button>
              </div>
              <div className="settings-row">
                <label>{t('settings.cliHint')}</label>
                <code className="mono">ism comment list --unresolved</code>
                <button
                  className="icon-btn"
                  title={t('inspector.copy')}
                  onClick={() =>
                    void navigator.clipboard.writeText('ism comment list --unresolved')
                  }
                >
                  <Copy size={12} strokeWidth={1.8} />
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
