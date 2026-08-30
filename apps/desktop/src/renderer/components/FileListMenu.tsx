import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ListTree } from 'lucide-react'

export type FileListMode = 'tree' | 'list' | 'combined'

/** Fork's file-list view options: Tree / List / Combined List. */
export function FileListMenu({
  mode,
  onChange,
}: {
  mode: FileListMode
  onChange: (mode: FileListMode) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const item = (key: FileListMode, label: string): React.JSX.Element => (
    <button
      key={key}
      className="menu-item"
      onClick={() => {
        onChange(key)
        setOpen(false)
      }}
    >
      <span className="menu-check">{mode === key && <Check size={13} strokeWidth={2} />}</span>
      {label}
    </button>
  )

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="icon-btn" title={t('files.viewOptions')} onClick={() => setOpen(!open)}>
        <ListTree size={14} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="menu">
          {item('tree', t('files.viewAsTree'))}
          {item('list', t('files.viewAsList'))}
          {item('combined', t('files.viewAsCombined'))}
        </div>
      )}
    </div>
  )
}
