import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, FolderOpen } from 'lucide-react'
import { useAppStore } from '../store/store'

/** Right-click menu for repo files: reveal in Finder, open with the
 * default app, copy the repo-relative path. One instance per view. */
export function useFileContextMenu(): {
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
    icon: React.JSX.Element,
    label: string,
    action: () => void,
  ): React.JSX.Element => (
    <button
      className="menu-item"
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
      </div>
    ),
  }
}
