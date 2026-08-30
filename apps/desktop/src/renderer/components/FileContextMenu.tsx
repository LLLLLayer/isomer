import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, FolderOpen } from 'lucide-react'
import { useAppStore } from '../store/store'

export interface FileMenuItem {
  icon?: React.JSX.Element
  label: string
  danger?: boolean
  action: () => void
}

/** Right-click menu for repo files: reveal in Finder, open with the
 * default app, copy the repo-relative path — plus view-specific extras
 * (discard, history, blame, conflict sides). One instance per view. */
export function useFileContextMenu(extra?: (path: string) => FileMenuItem[]): {
  onContextMenu: (e: React.MouseEvent, path: string) => void
  menu: React.JSX.Element | null
} {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const setError = useAppStore((s) => s.setError)
  const [state, setState] = useState<{ x: number; y: number; path: string } | null>(null)

  useEffect(() => {
    if (!state) return
    const close = (): void => setState(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setState(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [state])

  const run = (channel: 'shell:reveal' | 'shell:open-path', path: string): void => {
    if (!projectId) return
    void window.isomer.invoke(channel, { projectId, path }).then((r) => {
      if (!r.ok) setError(r.error)
    })
  }

  const item = (
    icon: React.JSX.Element | undefined,
    label: string,
    action: () => void,
    danger = false,
  ): React.JSX.Element => (
    <button
      key={label}
      className={`menu-item${danger ? ' danger' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        action()
        setState(null)
      }}
    >
      <span className="menu-check">{icon}</span>
      {label}
    </button>
  )

  return {
    onContextMenu: (e, path) => {
      e.preventDefault()
      // Clamp so the menu never renders off the bottom/right window edge.
      setState({
        x: Math.min(e.clientX, window.innerWidth - 210),
        y: Math.min(e.clientY, window.innerHeight - 120),
        path,
      })
    },
    menu: state && (
      <div className="context-menu" style={{ left: state.x, top: state.y }}>
        {item(<FolderOpen size={13} strokeWidth={1.8} />, t('files.reveal'), () =>
          run('shell:reveal', state.path),
        )}
        {item(<ExternalLink size={13} strokeWidth={1.8} />, t('files.openDefault'), () =>
          run('shell:open-path', state.path),
        )}
        <div className="menu-sep" />
        {item(<Copy size={13} strokeWidth={1.8} />, t('files.copyPath'), () =>
          void navigator.clipboard.writeText(state.path),
        )}
        {extra && extra(state.path).length > 0 && <div className="menu-sep" />}
        {extra?.(state.path).map((it) => item(it.icon, it.label, it.action, it.danger))}
      </div>
    ),
  }
}
