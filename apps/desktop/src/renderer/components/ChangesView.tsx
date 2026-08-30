import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Eye, History, Trash2 } from 'lucide-react'
import type { Result } from '../../shared/result'
import type { ChangeArea } from '../store/store'
import { useAppStore } from '../store/store'
import { extractHunkPatches, parseUnifiedDiff } from '../diff'
import { DiffView } from './DiffView'
import { Splitter, usePaneSize } from '../resize'
import { splitPath } from '../filetree'
import { storage } from '../storage'
import { type FileMenuItem, useFileContextMenu } from './FileContextMenu'
import { FileListMenu, type FileListMode } from './FileListMenu'
import { FileTreePanel } from './FileTreePanel'
import { BlameModal, FileHistoryModal } from './Insights'
import { ConfirmModal } from './Modals'

/** Porcelain XY with either side unmerged. */
const isConflict = (code: string): boolean =>
  code.includes('U') || code === 'AA' || code === 'DD'

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

  const refreshProject = useAppStore((s) => s.refreshProject)
  const setError = useAppStore((s) => s.setError)
  const stagePathsAction = useAppStore((s) => s.stagePaths)
  const projectId = useAppStore((s) => s.currentProjectId)
  const [confirm, setConfirm] = useState<
    | { kind: 'discard-file'; path: string }
    | { kind: 'discard-hunk'; patch: string; path: string }
    | null
  >(null)
  const [insight, setInsight] = useState<{ kind: 'history' | 'blame'; path: string } | null>(null)

  /** Fire a mutating git verb, surface errors, re-read reality. */
  const run = (p: Promise<Result<unknown>>): void => {
    void p.then((r) => {
      if (!r.ok) setError(r.error)
      void refreshProject()
    })
  }

  const entries = status?.entries ?? []
  const extraFor = (path: string): FileMenuItem[] => {
    if (!projectId) return []
    const entry = entries.find((e) => e.path === path)
    if (!entry) return []
    if (isConflict(entry.code)) {
      return [
        {
          label: t('conflict.takeOurs'),
          action: () =>
            run(window.isomer.invoke('git:conflict-take', { projectId, path, side: 'ours' })),
        },
        {
          label: t('conflict.takeTheirs'),
          action: () =>
            run(window.isomer.invoke('git:conflict-take', { projectId, path, side: 'theirs' })),
        },
        { label: t('conflict.markResolved'), action: () => void stagePathsAction([path]) },
      ]
    }
    return [
      {
        icon: <History size={13} strokeWidth={1.8} />,
        label: t('files.history'),
        action: () => setInsight({ kind: 'history', path }),
      },
      {
        icon: <Eye size={13} strokeWidth={1.8} />,
        label: t('files.blame'),
        action: () => setInsight({ kind: 'blame', path }),
      },
      {
        icon: <Trash2 size={13} strokeWidth={1.8} />,
        label: t('changes.discard'),
        danger: true,
        action: () => setConfirm({ kind: 'discard-file', path }),
      },
    ]
  }
  const fileMenu = useFileContextMenu(extraFor)
  // Porcelain v2 XY: X = staged side, Y = worktree side.
  const unstaged = entries.filter((e) => e.code === '??' || (e.code[1] ?? '.') !== '.')
  const staged = entries.filter((e) => e.code !== '??' && (e.code[0] ?? '.') !== '.')

  const codeOf = (e: { code: string }, area: ChangeArea): string =>
    (area === 'staged' ? e.code[0] : e.code === '??' ? '??' : e.code[1]) ?? 'M'

  const statusChip = (e: { code: string }, area: ChangeArea): React.JSX.Element => (
    <span className={`status-code s-${codeOf(e, area).replace('??', '?')}`}>{codeOf(e, area)}</span>
  )

  const fileRow = (e: { code: string; path: string }, area: ChangeArea): React.JSX.Element => {
    const { base, dir } = splitPath(e.path)
    return (
      <button
        key={`${area}:${e.path}`}
        className={`file-row${e.path === selectedPath && area === selectedArea ? ' active' : ''}`}
        title={e.path}
        onClick={() => void selectPath(e.path, area)}
        onContextMenu={(ev) => fileMenu.onContextMenu(ev, e.path)}
      >
        {statusChip(e, area)}
        {listMode === 'list' ? (
          <span className="file-name plain">
            {base}
            {dir !== '' && <span className="file-dir">{dir}</span>}
          </span>
        ) : (
          <span className="file-name">{e.path}</span>
        )}
      </button>
    )
  }

  const areaList = (
    list: { code: string; path: string }[],
    area: ChangeArea,
  ): React.JSX.Element =>
    listMode === 'tree' ? (
      <FileTreePanel
        paths={list.map((e) => e.path)}
        selected={area === selectedArea ? selectedPath : null}
        onSelect={(path) => void selectPath(path, area)}
        badge={(path) => {
          const e = list.find((x) => x.path === path)
          return e ? statusChip(e, area) : null
        }}
        onFileContextMenu={fileMenu.onContextMenu}
      />
    ) : (
      <>{list.map((e) => fileRow(e, area))}</>
    )

  const [colW, resizeCol] = usePaneSize('stage-column', 280, 180, 460)
  const [listMode, setListMode] = useState<FileListMode>(
    (storage.get('fileListMode') as FileListMode) || 'list',
  )
  const changeMode = (m: FileListMode): void => {
    storage.set('fileListMode', m)
    setListMode(m)
  }
  const hunkFiles = useMemo(
    () => (diffText === null ? [] : extractHunkPatches(diffText)),
    [diffText],
  )
  const hunkBar = (path: string, i: number): React.ReactNode => {
    if (!projectId) return null
    const patch = hunkFiles.find((f) => f.path === path)?.patches[i]
    if (!patch) return null
    if (selectedArea === 'staged') {
      return (
        <button
          className="ghost-btn"
          onClick={() => run(window.isomer.invoke('git:unstage-hunk', { projectId, patch }))}
        >
          {t('changes.unstageHunk')}
        </button>
      )
    }
    return (
      <>
        <button
          className="ghost-btn"
          onClick={() => run(window.isomer.invoke('git:stage-hunk', { projectId, patch }))}
        >
          {t('changes.stageHunk')}
        </button>
        <button
          className="ghost-btn"
          onClick={() => setConfirm({ kind: 'discard-hunk', patch, path })}
        >
          {t('changes.discardHunk')}
        </button>
      </>
    )
  }

  const op = status?.opInProgress ?? null
  return (
    <div className="changes-wrap">
      {op && projectId && (
        <div className="conflict-banner">
          <AlertTriangle size={14} strokeWidth={1.8} />
          <span>{t(`conflict.inProgress.${op}`)}</span>
          <span className="spacer" />
          <button
            className="ghost-btn"
            onClick={() => run(window.isomer.invoke('git:op-continue', { projectId, op }))}
          >
            {t('conflict.continue')}
          </button>
          <button
            className="ghost-btn"
            onClick={() => run(window.isomer.invoke('git:op-abort', { projectId, op }))}
          >
            {t('conflict.abort')}
          </button>
        </div>
      )}
      <div className="changes-view">
      {fileMenu.menu}
      <aside className="stage-column" style={{ width: colW }}>
        <div className="area-header">
          <span>{t('changes.unstaged')}</span>
          <span className="spacer" />
          <FileListMenu mode={listMode} onChange={changeMode} />
          <button
            className="ghost-btn"
            disabled={unstaged.length === 0}
            onClick={() => void stagePaths(unstaged.map((e) => e.path))}
          >
            {t('changes.stageAll')}
          </button>
        </div>
        <div className="area-list">{areaList(unstaged, 'unstaged')}</div>
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
        <div className="area-list">{areaList(staged, 'staged')}</div>
      </aside>
      <Splitter axis="x" onDelta={resizeCol} />
      <section className="changes-main">
        <div className="pane diff-pane">
          {entries.length === 0 ? (
            <p className="empty">{t('changes.clean')}</p>
          ) : diffText === null ? (
            <p className="empty">…</p>
          ) : (
            <DiffView files={parseUnifiedDiff(diffText)} hunkBar={hunkBar} />
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
      {confirm?.kind === 'discard-file' && projectId && (
        <ConfirmModal
          title={t('changes.discardTitle', { path: confirm.path })}
          command={
            entries.find((e) => e.path === confirm.path)?.code === '??'
              ? `git clean -f -- ${confirm.path}`
              : `git checkout HEAD -- ${confirm.path}`
          }
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const untracked = entries.find((e) => e.path === confirm.path)?.code === '??'
            run(
              window.isomer.invoke('git:discard', {
                projectId,
                tracked: untracked ? [] : [confirm.path],
                untracked: untracked ? [confirm.path] : [],
              }),
            )
            setConfirm(null)
          }}
        />
      )}
      {confirm?.kind === 'discard-hunk' && projectId && (
        <ConfirmModal
          title={t('changes.discardHunkTitle', { path: confirm.path })}
          command="git apply -R <hunk>"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            run(window.isomer.invoke('git:discard-hunk', { projectId, patch: confirm.patch }))
            setConfirm(null)
          }}
        />
      )}
      {insight?.kind === 'history' && (
        <FileHistoryModal path={insight.path} onClose={() => setInsight(null)} />
      )}
      {insight?.kind === 'blame' && (
        <BlameModal path={insight.path} onClose={() => setInsight(null)} />
      )}
    </div>
  )
}
