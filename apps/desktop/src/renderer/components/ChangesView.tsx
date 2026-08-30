import { useTranslation } from 'react-i18next'
import type { ChangeArea } from '../store/store'
import { useAppStore } from '../store/store'
import { parseUnifiedDiff } from '../diff'
import { DiffView } from './DiffView'

/** Fork-style local changes: Unstaged / Staged areas with stage buttons,
 * the selected file's diff, and the commit box (staged set only). */
export function ChangesView(): React.JSX.Element {
  const { t } = useTranslation()
  const status = useAppStore((s) => s.status)
  const selectedPath = useAppStore((s) => s.selectedPath)
  const selectedArea = useAppStore((s) => s.selectedArea)
  const selectPath = useAppStore((s) => s.selectPath)
  const diffText = useAppStore((s) => s.workingDiffText)
  const stagePaths = useAppStore((s) => s.stagePaths)
  const unstagePaths = useAppStore((s) => s.unstagePaths)
  const commitSubject = useAppStore((s) => s.commitSubject)
  const commitDescription = useAppStore((s) => s.commitDescription)
  const commitAmend = useAppStore((s) => s.commitAmend)
  const committing = useAppStore((s) => s.committing)
  const setCommitField = useAppStore((s) => s.setCommitField)
  const setCommitAmend = useAppStore((s) => s.setCommitAmend)
  const doCommit = useAppStore((s) => s.doCommit)

  const entries = status?.entries ?? []
  // Porcelain v2 XY: X = staged side, Y = worktree side.
  const unstaged = entries.filter((e) => e.code === '??' || (e.code[1] ?? '.') !== '.')
  const staged = entries.filter((e) => e.code !== '??' && (e.code[0] ?? '.') !== '.')

  const fileRow = (e: { code: string; path: string }, area: ChangeArea): React.JSX.Element => (
    <button
      key={`${area}:${e.path}`}
      className={`file-row${e.path === selectedPath && area === selectedArea ? ' active' : ''}`}
      title={e.path}
      onClick={() => void selectPath(e.path, area)}
    >
      <span className={`status-code s-${(area === 'staged' ? e.code[0] : e.code === '??' ? '?' : e.code[1]) ?? 'M'}`}>
        {area === 'staged' ? e.code[0] : e.code === '??' ? '??' : e.code[1]}
      </span>
      <span className="file-name">{e.path}</span>
    </button>
  )

  return (
    <div className="changes-view">
      <aside className="stage-column">
        <div className="area-header">
          <span>{t('changes.unstaged')}</span>
          <span className="spacer" />
          <button
            className="ghost-btn"
            disabled={unstaged.length === 0}
            onClick={() => void stagePaths(unstaged.map((e) => e.path))}
          >
            {t('changes.stageAll')}
          </button>
        </div>
        <div className="area-list">{unstaged.map((e) => fileRow(e, 'unstaged'))}</div>
        <div className="area-header">
          <span>{t('changes.staged')}</span>
          <span className="spacer" />
          <button
            className="ghost-btn"
            disabled={staged.length === 0}
            onClick={() => void unstagePaths(staged.map((e) => e.path))}
          >
            {t('changes.unstageAll')}
          </button>
        </div>
        <div className="area-list">{staged.map((e) => fileRow(e, 'staged'))}</div>
      </aside>
      <section className="changes-main">
        <div className="pane diff-pane">
          {entries.length === 0 ? (
            <p className="empty">{t('changes.clean')}</p>
          ) : diffText === null ? (
            <p className="empty">…</p>
          ) : (
            <DiffView files={parseUnifiedDiff(diffText)} />
          )}
        </div>
        <form
          className="commit-box"
          onSubmit={(e) => {
            e.preventDefault()
            void doCommit()
          }}
        >
          <input
            className="commit-subject"
            placeholder={t('changes.commitSubject')}
            value={commitSubject}
            onChange={(e) => setCommitField('subject', e.target.value)}
          />
          <textarea
            className="commit-description"
            placeholder={t('changes.commitDescription')}
            rows={2}
            value={commitDescription}
            onChange={(e) => setCommitField('description', e.target.value)}
          />
          <div className="commit-actions">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={commitAmend}
                onChange={(e) => setCommitAmend(e.target.checked)}
              />
              {t('changes.amend')}
            </label>
            <span className="spacer" />
            <button
              type="submit"
              className="primary-btn"
              disabled={committing || commitSubject.trim() === '' || (staged.length === 0 && !commitAmend)}
            >
              {t('changes.commit')}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
