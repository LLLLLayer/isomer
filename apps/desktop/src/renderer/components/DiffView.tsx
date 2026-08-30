import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Columns2, Copy, MessageSquarePlus, X } from 'lucide-react'
import type { Comment } from '../../shared/ism-types'
import type { EmphRange, FileDiff, UnifiedRow } from '../diff'
import { emphasisRanges, intraline, splitRows } from '../diff'
import { highlightLineEmph, langFor } from '../highlight'
import { useAppStore } from '../store/store'

/** Review affordances threaded into the diff: line anchoring for new
 * comments plus inline threads under commented lines. */
export interface ReviewHooks {
  anchor: { path: string; line: number } | null
  onAnchor: (path: string, line: number) => void
  comments: Comment[]
  onResolve: (id: string) => void
  onReply: (parent: Comment, body: string) => void
  /** Create a line-anchored comment directly (selection popover / inline). */
  onAddComment: (path: string, line: number, body: string) => void
}

/** The one diff renderer: split or unified (persisted preference), hunk
 * header bars, intraline emphasis, selectable code, optional review hooks. */
export function DiffView({
  files,
  review,
  hunkBar,
}: {
  files: FileDiff[]
  review?: ReviewHooks
  /** Optional per-hunk action bar (stage/discard surgery), by hunk ordinal. */
  hunkBar?: (path: string, hunkIndex: number) => React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const layout = useAppStore((s) => s.settings.diffLayout)
  const containerRef = useRef<HTMLDivElement>(null)

  // Split view needs real width; in a narrow pane it degrades into a
  // one-word-per-line transpose, so fall back to unified automatically.
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const narrow = width < 700
  const split = layout === 'split' && !narrow

  // Threads keyed by path:line — top-level comments only; replies render
  // inside their parent's thread wherever it is anchored.
  const threads = useMemo(() => {
    const map = new Map<string, Comment[]>()
    for (const c of review?.comments ?? []) {
      if (c.parent || !c.path || typeof c.line !== 'number') continue
      const key = `${c.path}:${c.line}`
      map.set(key, [...(map.get(key) ?? []), c])
    }
    return map
  }, [review?.comments])

  // Select-to-comment: a floating button near the selection opens an
  // inline composer anchored to the selection's post-image line.
  const [selPop, setSelPop] = useState<{
    x: number
    y: number
    below: boolean
    path: string
    line: number
    quote: string
  } | null>(null)
  const [draftAt, setDraftAt] = useState<{ path: string; line: number; quote: string } | null>(
    null,
  )

  const onMouseUp = (): void => {
    if (!review) return
    setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelPop(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!containerRef.current?.contains(range.commonAncestorContainer)) {
        setSelPop(null)
        return
      }
      const rowOf = (node: Node | null): HTMLElement | null => {
        let el: HTMLElement | null =
          node instanceof HTMLElement ? node : (node?.parentElement ?? null)
        while (el && el.dataset.line === undefined) el = el.parentElement
        return el
      }
      const row = rowOf(sel.focusNode) ?? rowOf(sel.anchorNode)
      if (!row?.dataset.line || !row.dataset.path) {
        setSelPop(null)
        return
      }
      const rect = range.getBoundingClientRect()
      const box = containerRef.current.getBoundingClientRect()
      // Centered above the selection, kept inside the diff pane; flips
      // below when the selection starts at the very top.
      const below = rect.top - 40 < box.top + 4
      setSelPop({
        x: Math.max(box.left + 10, Math.min(rect.left + rect.width / 2 - 44, box.right - 106)),
        y: below ? rect.bottom + 10 : rect.top - 38,
        below,
        path: row.dataset.path,
        line: Number(row.dataset.line),
        quote: sel.toString().slice(0, 400),
      })
    }, 0)
  }

  // Bring the anchored line into view (set from a comment or a click).
  const anchorKey = review?.anchor ? `${review.anchor.path}:${review.anchor.line}` : null
  useEffect(() => {
    if (!anchorKey) return
    containerRef.current
      ?.querySelector(`[data-anchor="${CSS.escape(anchorKey)}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [anchorKey])

  if (files.length === 0) {
    return <p className="empty">{t('diff.empty')}</p>
  }
  return (
    <div
      className="diff-view"
      ref={containerRef}
      onMouseUp={onMouseUp}
      onScroll={() => setSelPop(null)}
    >
      {selPop && review && (
        <button
          className={`sel-comment-btn${selPop.below ? ' below' : ''}`}
          style={{ left: selPop.x, top: selPop.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            review.onAnchor(selPop.path, selPop.line)
            setDraftAt({ path: selPop.path, line: selPop.line, quote: selPop.quote })
            setSelPop(null)
            window.getSelection()?.removeAllRanges()
          }}
        >
          <MessageSquarePlus size={13} strokeWidth={2} /> {t('inspector.addComment')}
        </button>
      )}
      <div className="diff-toolbar">
        <span className="muted">{t('diff.files', { count: files.length })}</span>
        <span className="spacer" />
        {narrow && layout === 'split' && (
          <span className="muted">{t('review.narrowAuto')}</span>
        )}
        <DiffViewMenu />
      </div>
      {files.map((f) => (
        <FileCard
          key={f.path}
          file={f}
          split={split}
          review={review}
          threads={threads}
          hunkBar={hunkBar}
          draftAt={draftAt}
          onCloseDraft={() => setDraftAt(null)}
        />
      ))}
    </div>
  )
}

/** Fork-style view options for the diff (View as Split / Unified). */
function DiffViewMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const layout = useAppStore((s) => s.settings.diffLayout)
  const updateSettings = useAppStore((s) => s.updateSettings)
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

  const item = (key: 'split' | 'unified', label: string): React.JSX.Element => (
    <button
      key={key}
      className="menu-item"
      onClick={() => {
        void updateSettings({ diffLayout: key })
        setOpen(false)
      }}
    >
      <span className="menu-check">{layout === key && <Check size={13} strokeWidth={2} />}</span>
      {label}
    </button>
  )

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="icon-btn" title={t('files.viewOptions')} onClick={() => setOpen(!open)}>
        <Columns2 size={14} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="menu">
          {item('split', t('review.viewSplit'))}
          {item('unified', t('review.viewUnified'))}
        </div>
      )}
    </div>
  )
}

function FileCard({
  file: f,
  split,
  review,
  threads,
  hunkBar,
  draftAt,
  onCloseDraft,
}: {
  file: FileDiff
  split: boolean
  review?: ReviewHooks
  threads: Map<string, Comment[]>
  hunkBar?: (path: string, hunkIndex: number) => React.ReactNode
  draftAt: { path: string; line: number; quote: string } | null
  onCloseDraft: () => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const lang = langFor(f.path)
  const emph = useMemo(() => emphasisRanges(f.rows), [f.rows])
  const stat = useMemo(() => {
    let add = 0
    let del = 0
    for (const r of f.rows) {
      if (r.kind === 'add') add++
      else if (r.kind === 'del') del++
    }
    return { add, del }
  }, [f.rows])

  const anchored = (line: number | null): boolean =>
    review?.anchor?.path === f.path && review?.anchor?.line === line

  const html = (text: string, range: EmphRange | null): { __html: string } => ({
    __html: highlightLineEmph(text, lang, range),
  })

  /** The inline thread under a post-image line, if any. */
  const threadAt = (line: number | null): Comment[] | null => {
    if (line === null || !review) return null
    return threads.get(`${f.path}:${line}`) ?? null
  }

  const linenoBtn = (line: number | null, key?: string): React.JSX.Element =>
    review && line !== null ? (
      <button
        key={key}
        className={`lineno clickable${anchored(line) ? ' anchored' : ''}`}
        data-anchor={`${f.path}:${line}`}
        onClick={() => review.onAnchor(f.path, line)}
      >
        <span className="lineno-num">{line}</span>
        <MessageSquarePlus className="lineno-bubble" size={12} strokeWidth={2} />
      </button>
    ) : (
      <span key={key} className="lineno">
        {line ?? ''}
      </span>
    )

  const inline = (line: number | null): React.JSX.Element | null => {
    if (!review || line === null) return null
    const thread = threadAt(line)
    const draft = draftAt !== null && draftAt.path === f.path && draftAt.line === line
    if (!thread && !draft) return null
    return (
      <div className="inline-threads">
        {thread?.map((parent) => (
          <InlineThread key={parent.id} parent={parent} review={review} />
        ))}
        {draft && (
          <InlineDraft
            path={f.path}
            line={line}
            quote={draftAt.quote}
            review={review}
            onClose={onCloseDraft}
          />
        )}
      </div>
    )
  }

  // Hunk ordinal per gap row (both layouts render gaps in source order).
  const gapOrdinals = useMemo(() => {
    const map = new Map<number, number>()
    let ord = 0
    f.rows.forEach((r, i) => {
      if (r.kind === 'gap') map.set(i, ord++)
    })
    return map
  }, [f.rows])

  const hunkHead = (key: number, text: string, ordinal: number): React.JSX.Element => (
    <div key={key} className="hunk-head mono">
      <span className="hunk-head-text">{text}</span>
      {hunkBar && <span className="hunk-actions">{hunkBar(f.path, ordinal)}</span>}
    </div>
  )

  const unifiedRow = (row: UnifiedRow, i: number): React.JSX.Element => {
    if (row.kind === 'gap') {
      return hunkHead(i, row.text, gapOrdinals.get(i) ?? 0)
    }
    const kind = row.kind === 'context' ? 'ctx' : row.kind
    return (
      <div key={i}>
        <div
          className={`diff-row uni ${kind}${anchored(row.newNo) ? ' anchored' : ''}`}
          {...(review && row.newNo !== null
            ? { 'data-path': f.path, 'data-line': row.newNo }
            : {})}
        >
          <span className="lineno">{row.oldNo ?? ''}</span>
          {linenoBtn(row.newNo)}
          <span className={`marker ${kind}`}>
            {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''}
          </span>
          <span
            className="code"
            dangerouslySetInnerHTML={html(row.text, emph.get(i) ?? null)}
          />
        </div>
        {inline(row.newNo)}
      </div>
    )
  }

  const splitBody = (): React.JSX.Element => {
    let gapOrd = -1
    return (
    <div className="diff-table split">
      {splitRows(f.rows).map((row, i) => {
        if (row.gap !== undefined) {
          gapOrd++
          return hunkHead(i, row.gap, gapOrd)
        }
        const pair =
          row.left?.kind === 'del' && row.right?.kind === 'add'
            ? intraline(row.left.text, row.right.text)
            : null
        const line = row.right?.lineNo ?? null
        return (
          <div key={i}>
            <div
              className={`diff-row split${anchored(line) ? ' anchored' : ''}`}
              {...(review && line !== null ? { 'data-path': f.path, 'data-line': line } : {})}
            >
              <span className="lineno">{row.left?.lineNo ?? ''}</span>
              <span
                className={`code ${row.left ? (row.left.kind === 'del' ? 'del' : 'ctx') : 'void'}`}
                dangerouslySetInnerHTML={row.left ? html(row.left.text, pair?.a ?? null) : undefined}
              />
              {linenoBtn(line)}
              <span
                className={`code ${row.right ? (row.right.kind === 'add' ? 'add' : 'ctx') : 'void'}`}
                dangerouslySetInnerHTML={
                  row.right ? html(row.right.text, pair?.b ?? null) : undefined
                }
              />
            </div>
            {inline(line)}
          </div>
        )
      })}
    </div>
    )
  }

  return (
    <article className="diff-hunk">
      <header className="diff-file">
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? (
            <ChevronRight size={13} strokeWidth={2} />
          ) : (
            <ChevronDown size={13} strokeWidth={2} />
          )}
        </button>
        <span className="hunk-id">{f.path}</span>
        <span className="spacer" />
        <span className="linestat">
          {stat.add > 0 && <span className="plus">+{stat.add}</span>}
          {stat.del > 0 && <span className="minus">-{stat.del}</span>}
        </span>
      </header>
      {!collapsed && f.note && <p className="diff-note muted">{f.note}</p>}
      {!collapsed && !f.note && (split ? splitBody() : (
        <div className="diff-table unified">{f.rows.map(unifiedRow)}</div>
      ))}
    </article>
  )
}

/** One comment thread rendered under its anchored line. */
function InlineThread({
  parent,
  review,
}: {
  parent: Comment
  review: ReviewHooks
}): React.JSX.Element {
  const { t } = useTranslation()
  const [reply, setReply] = useState('')
  const replies = review.comments.filter((c) => c.parent === parent.id)
  const item = (c: Comment): React.JSX.Element => (
    <div key={c.id} className={`inline-comment${c.resolved ? ' resolved' : ''}`}>
      <div className="comment-head">
        <span className="author">{c.author_name}</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title={t('inspector.copy')}
          onClick={() => void navigator.clipboard.writeText(c.body)}
        >
          <Copy size={12} strokeWidth={1.8} />
        </button>
        {!c.resolved && !c.parent && (
          <button className="ghost-btn" onClick={() => review.onResolve(c.id)}>
            {t('inspector.resolve')}
          </button>
        )}
      </div>
      <div className="comment-body">{c.body}</div>
    </div>
  )
  return (
    <div className="inline-thread">
      {item(parent)}
      {replies.map(item)}
      <form
        className="inline-reply"
        onSubmit={(e) => {
          e.preventDefault()
          if (reply.trim() === '') return
          review.onReply(parent, reply)
          setReply('')
        }}
      >
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t('inspector.reply')}
        />
        <button type="submit" className="ghost-btn" disabled={reply.trim() === ''}>
          {t('inspector.reply')}
        </button>
      </form>
    </div>
  )
}

/** Inline composer opened from the selection popover (or a line anchor):
 * quotes the selection, submits a path:line-anchored comment in place. */
function InlineDraft({
  path,
  line,
  quote,
  review,
  onClose,
}: {
  path: string
  line: number
  quote: string
  review: ReviewHooks
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [body, setBody] = useState('')
  const submit = (): void => {
    if (body.trim() === '') return
    const quoted =
      quote.trim() !== ''
        ? quote
            .split('\n')
            .slice(0, 6)
            .map((l) => `> ${l}`)
            .join('\n') + '\n\n'
        : ''
    review.onAddComment(path, line, quoted + body)
    onClose()
  }
  return (
    <div className="inline-thread draft">
      <div className="inline-draft-head">
        <span className="mono muted">
          {path}:{line}
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose}>
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      {quote.trim() !== '' && <blockquote className="inline-quote mono">{quote}</blockquote>}
      <form
        className="inline-draft-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          autoFocus
          rows={2}
          value={body}
          placeholder={t('inspector.addComment')}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="inline-draft-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary-btn" disabled={body.trim() === ''}>
            {t('inspector.addComment')}
          </button>
        </div>
      </form>
    </div>
  )
}
