import { useTranslation } from 'react-i18next'
import { parseUnifiedDiff } from '../diff'
import { useAppStore } from '../store/store'
import { DiffView } from './DiffView'

/** Working-tree changes: file list on the left, diff against HEAD on the right. */
export function ChangesView(): React.JSX.Element {
  const { t } = useTranslation()
  const status = useAppStore((s) => s.status)
  const selectedPath = useAppStore((s) => s.selectedPath)
  const selectPath = useAppStore((s) => s.selectPath)
  const diffText = useAppStore((s) => s.workingDiffText)

  const entries = status?.entries ?? []
  if (entries.length === 0) {
    return (
      <section className="pane">
        <header className="pane-title">{t('sidebar.localChanges')}</header>
        <p className="empty">{t('changes.clean')}</p>
      </section>
    )
  }

  return (
    <div className="changes-view">
      <aside className="file-list">
        {entries.map((e) => (
          <button
            key={e.path}
            className={`file-row${e.path === selectedPath ? ' active' : ''}`}
            title={e.origPath ? `${e.origPath} → ${e.path}` : e.path}
            onClick={() => void selectPath(e.path)}
          >
            <span className={`status-code s-${e.code.replace(/[^A-Za-z?]/g, '') || 'M'}`}>
              {e.code.trim()}
            </span>
            <span className="file-name">{e.path}</span>
          </button>
        ))}
      </aside>
      <section className="pane diff-pane">
        {diffText === null ? (
          <p className="empty">…</p>
        ) : (
          <DiffView files={parseUnifiedDiff(diffText)} />
        )}
      </section>
    </div>
  )
}
