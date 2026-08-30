import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Small text prompt (branch names etc.), Enter to submit, Esc to cancel. */
export function PromptModal({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string
  initial: string
  onSubmit: (value: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal narrow"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim() !== '') onSubmit(value.trim())
        }}
      >
        <header className="modal-header">{title}</header>
        <input
          autoFocus
          className="settings-input mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary-btn" disabled={value.trim() === ''}>
            {t('common.ok')}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Confirmation with the equivalent git command shown (transparency rule). */
export function ConfirmModal({
  title,
  command,
  danger,
  onConfirm,
  onClose,
}: {
  title: string
  command: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">{title}</header>
        <pre className="modal-command mono">{command}</pre>
        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={`primary-btn${danger ? ' danger' : ''}`} onClick={onConfirm}>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
