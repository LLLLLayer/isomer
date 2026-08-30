import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil } from 'lucide-react'
import type { Choice, ConflictSegment, ParsedConflicts } from '../conflicts'
import { choiceLines, parseConflicts, resolveText } from '../conflicts'
import { useAppStore } from '../store/store'
import { Wide } from './Insights'

/** The dedicated conflict editor: ours | result | theirs. Each conflict
 * block resolves per side (or both, or hand-edited); the file is written
 * and staged only once every block has a decision. Labels come from the
 * markers themselves, so rebase/cherry-pick name their real sides. */
export function ConflictEditor({
  path,
  onClose,
}: {
  path: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const projectId = useAppStore((s) => s.currentProjectId)
  const refreshProject = useAppStore((s) => s.refreshProject)
  const setError = useAppStore((s) => s.setError)
  const [parsed, setParsed] = useState<ParsedConflicts | null | undefined>(undefined)
  const [merged, setMerged] = useState<string | null>(null)
  const [eof, setEof] = useState<{ ours: boolean | null; theirs: boolean | null }>({
    ours: null,
    theirs: null,
  })
  const [choices, setChoices] = useState<(Choice | null)[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!projectId) return
    void window.isomer.invoke('git:conflict-file', { projectId, path }).then((r) => {
      if (!r.ok) {
        setError(r.error)
        onClose()
        return
      }
      const p = parseConflicts(r.data.merged)
      setParsed(p)
      setMerged(r.data.merged)
      setEof({
        ours: r.data.ours === null ? null : r.data.ours.endsWith('\n'),
        theirs: r.data.theirs === null ? null : r.data.theirs.endsWith('\n'),
      })
      setChoices(p ? new Array<Choice | null>(p.conflicts).fill(null) : [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path])

  const decided = choices.filter((c) => c !== null).length
  const labels = useMemo(() => {
    const first = parsed?.segments.find((s) => s.kind === 'conflict') as
      | ConflictSegment
      | undefined
    return {
      ours: first?.oursLabel || t('conflict.ours'),
      theirs: first?.theirsLabel || t('conflict.theirs'),
    }
  }, [parsed, t])

  const choose = (index: number, choice: Choice): void => {
    setChoices((cs) => cs.map((c, i) => (i === index ? choice : c)))
    // Only close the editor it belongs to — a decision on another block
    // must not discard an in-progress hand edit.
    setEditing((e) => (e === index ? null : e))
  }
  const chooseAll = (kind: 'ours' | 'theirs'): void => {
    setChoices((cs) => cs.map(() => ({ kind })))
    setEditing(null)
  }
  const startEdit = (index: number, seg: ConflictSegment): void => {
    const current = choices[index]
    setDraft(choiceLines(seg, current ?? { kind: 'both' }).join('\n'))
    setEditing(index)
  }

  const save = async (): Promise<void> => {
    if (!projectId || !parsed || saving) return
    const text = resolveText(parsed, choices, eof)
    if (text === null || merged === null) return
    setSaving(true)
    const r = await window.isomer.invoke('git:conflict-save', {
      projectId,
      path,
      content: text,
      expected: merged,
    })
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    await refreshProject()
    onClose()
  }

  let conflictIndex = -1
  return (
    <Wide title={`${t('conflict.editorTitle')} — ${path}`} onClose={onClose}>
      <div className="conflict-editor">
        <div className="conflict-cols-head">
          <span className="side ours">{labels.ours}</span>
          <span className="side result">{t('conflict.result')}</span>
          <span className="side theirs">{labels.theirs}</span>
        </div>
        <div className="conflict-body">
          {parsed === undefined && <p className="empty">…</p>}
          {parsed === null && <p className="empty">{t('conflict.noMarkers')}</p>}
          {parsed?.segments.map((seg, si) => {
            if (seg.kind === 'text') {
              return (
                <pre key={si} className="conflict-context">
                  {seg.lines.join('\n')}
                </pre>
              )
            }
            conflictIndex += 1
            const index = conflictIndex
            const choice = choices[index]
            const isEditing = editing === index
            return (
              <div key={si} className={`conflict-block${choice ? ' decided' : ''}`}>
                <pre
                  className={`side-pane ours${choice?.kind === 'ours' ? ' picked' : ''}`}
                  onClick={() => choose(index, { kind: 'ours' })}
                >
                  {seg.ours.join('\n')}
                </pre>
                <div className="resolve-cell">
                  <div className="resolve-actions">
                    <button
                      className={`ghost-btn${choice?.kind === 'ours' ? ' active' : ''}`}
                      onClick={() => choose(index, { kind: 'ours' })}
                    >
                      {t('conflict.useOurs')}
                    </button>
                    <button
                      className={`ghost-btn${choice?.kind === 'both' ? ' active' : ''}`}
                      onClick={() => choose(index, { kind: 'both' })}
                    >
                      {t('conflict.useBoth')}
                    </button>
                    <button
                      className={`ghost-btn${choice?.kind === 'theirs' ? ' active' : ''}`}
                      onClick={() => choose(index, { kind: 'theirs' })}
                    >
                      {t('conflict.useTheirs')}
                    </button>
                    <button
                      className={`icon-btn${choice?.kind === 'custom' ? ' active' : ''}`}
                      title={t('conflict.edit')}
                      onClick={() => startEdit(index, seg)}
                    >
                      <Pencil size={12} strokeWidth={1.8} />
                    </button>
                  </div>
                  {isEditing ? (
                    <>
                      <textarea
                        className="resolve-edit mono"
                        rows={Math.min(12, draft.split('\n').length + 1)}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                      />
                      <button
                        className="primary-btn"
                        onClick={() =>
                          choose(index, {
                            kind: 'custom',
                            lines: draft === '' ? [] : draft.split('\n'),
                          })
                        }
                      >
                        <Check size={12} strokeWidth={2} /> {t('conflict.keepEdit')}
                      </button>
                    </>
                  ) : (
                    <pre className={`resolve-preview${choice ? '' : ' undecided'}`}>
                      {choice
                        ? choiceLines(seg, choice).join('\n')
                        : t('conflict.undecided')}
                    </pre>
                  )}
                  {seg.base && !isEditing && (
                    <details className="conflict-base">
                      <summary>{t('conflict.baseLabel')}</summary>
                      <pre>{seg.base.join('\n')}</pre>
                    </details>
                  )}
                </div>
                <pre
                  className={`side-pane theirs${choice?.kind === 'theirs' ? ' picked' : ''}`}
                  onClick={() => choose(index, { kind: 'theirs' })}
                >
                  {seg.theirs.join('\n')}
                </pre>
              </div>
            )
          })}
        </div>
        <footer className="conflict-footer">
          <span className="muted">
            {t('conflict.progress', { decided, total: parsed?.conflicts ?? 0 })}
          </span>
          <span className="spacer" />
          <button className="ghost-btn" onClick={() => chooseAll('ours')}>
            {t('conflict.allOurs')}
          </button>
          <button className="ghost-btn" onClick={() => chooseAll('theirs')}>
            {t('conflict.allTheirs')}
          </button>
          <button
            className="primary-btn"
            disabled={saving || !parsed || decided < (parsed?.conflicts ?? 1)}
            onClick={() => void save()}
          >
            {saving ? '…' : t('conflict.saveStage')}
          </button>
        </footer>
      </div>
    </Wide>
  )
}
