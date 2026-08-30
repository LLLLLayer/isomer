import { useState } from 'react'
import { ChevronRight, FileText, Folder } from 'lucide-react'
import { buildFileTree, type TreeNode } from '../filetree'

/** Interactive file tree (Fork's File Tree pane): collapsible directories,
 * file rows selectable; an optional badge renders per file (status codes). */
export function FileTreePanel({
  paths,
  selected,
  onSelect,
  badge,
}: {
  paths: string[]
  selected: string | null
  onSelect: (path: string) => void
  badge?: (path: string) => React.ReactNode
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const render = (nodes: TreeNode[], depth: number): React.JSX.Element[] =>
    nodes.flatMap((n) => {
      const pad = { paddingLeft: 8 + depth * 16 }
      if (!n.isFile) {
        const closed = collapsed.has(n.path)
        return [
          <button key={n.path} className="tree-row dir" style={pad} onClick={() => toggle(n.path)}>
            <ChevronRight
              size={13}
              strokeWidth={2}
              className={`tree-chevron${closed ? '' : ' open'}`}
            />
            <Folder size={14} strokeWidth={1.8} className="tree-glyph dir" />
            <span className="tree-name">{n.name}</span>
          </button>,
          ...(closed ? [] : render(n.children, depth + 1)),
        ]
      }
      return [
        <button
          key={n.path}
          className={`tree-row file${n.path === selected ? ' active' : ''}`}
          style={pad}
          title={n.path}
          onClick={() => onSelect(n.path)}
        >
          <span className="tree-chevron-spacer" />
          <FileText size={14} strokeWidth={1.8} className="tree-glyph" />
          <span className="tree-name">{n.name}</span>
          {badge?.(n.path)}
        </button>,
      ]
    })

  return <div className="file-tree-panel">{render(buildFileTree(paths), 0)}</div>
}
