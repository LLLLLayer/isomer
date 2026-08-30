import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileDiff } from '../diff'
import { splitRows } from '../diff'

/** Shared renderer for full unified diffs (working tree and commits):
 * per-file cards, side-by-side or unified, context rows included. */
export function DiffView({ files }: { files: FileDiff[] }): React.JSX.Element {
  const { t } = useTranslation()
  const [sideBySide, setSideBySide] = useState(true)

  if (files.length === 0) {
    return <p className="empty">{t('diff.empty')}</p>
  }
  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="muted">{t('diff.files', { count: files.length })}</span>
        <span className="spacer" />
        <div className="segmented">
          <button className={sideBySide ? 'active' : ''} onClick={() => setSideBySide(true)}>
            {t('review.sideBySide')}
          </button>
          <button className={sideBySide ? '' : 'active'} onClick={() => setSideBySide(false)}>
            {t('review.unified')}
          </button>
        </div>
      </div>
      {files.map((f) => (
        <article key={f.path} className="diff-hunk">
          <header className="diff-file">
            <span className="hunk-id">{f.path}</span>
          </header>
          {f.note && <p className="diff-note muted">{f.note}</p>}
          {!f.note && sideBySide && (
            <div className="diff-table split">
              {splitRows(f.rows).map((row, i) =>
                row.left === null && row.right === null ? (
                  <div key={i} className="diff-gap" />
                ) : (
                <div key={i} className="diff-split-row">
                  <span className="lineno">{row.left?.lineNo ?? ''}</span>
                  <span className={`code ${row.left ? (row.left.kind === 'del' ? 'del' : 'ctx') : 'void'}`}>
                    {row.left?.text ?? ''}
                  </span>
                  <span className="lineno">{row.right?.lineNo ?? ''}</span>
                  <span className={`code ${row.right ? (row.right.kind === 'add' ? 'add' : 'ctx') : 'void'}`}>
                    {row.right?.text ?? ''}
                  </span>
                </div>
                ),
              )}
            </div>
          )}
          {!f.note && !sideBySide && (
            <div className="diff-table unified">
              {f.rows.map((row, i) =>
                row.kind === 'gap' ? (
                  <div key={i} className="diff-gap" />
                ) : (
                <div key={i} className="diff-uni-row">
                  <span className="lineno">{row.oldNo ?? ''}</span>
                  <span className="lineno">{row.newNo ?? ''}</span>
                  <span className={`code ${row.kind === 'context' ? 'ctx' : row.kind}`}>
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
                    {row.text}
                  </span>
                </div>
                ),
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
