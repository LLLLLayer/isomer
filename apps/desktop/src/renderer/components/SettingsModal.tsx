import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useAppStore } from '../store/store'

/** Fork-style preferences: a modal panel over the app, saved on change. */
export function SettingsModal(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
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

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <span>{t('settings.title')}</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={close} title={t('settings.close')}>
            <X size={15} />
          </button>
        </header>

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
        </section>

        <section className="settings-section">
          <h4>{t('settings.integration')}</h4>
          <div className="settings-row">
            <label>{t('settings.agentCommand')}</label>
            <input
              className="settings-input mono"
              value={settings.agentCommand}
              onChange={(e) => void updateSettings({ agentCommand: e.target.value })}
            />
          </div>
          <p className="settings-hint">{t('settings.agentCommandHint')}</p>
          <div className="settings-row">
            <label>{t('settings.ismPath')}</label>
            <input
              className="settings-input mono"
              placeholder="ism"
              value={settings.ismPath}
              onChange={(e) => void updateSettings({ ismPath: e.target.value })}
            />
          </div>
          <p className="settings-hint">{t('settings.ismPathHint')}</p>
        </section>

        <footer className="modal-footer muted">
          Isomer {version && `v${version}`}
        </footer>
      </div>
    </div>
  )
}
