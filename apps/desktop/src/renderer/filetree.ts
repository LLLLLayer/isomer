/** Build a nested tree from changed-file paths (Fork's File Tree tab). */

export interface TreeNode {
  name: string
  path: string
  children: TreeNode[]
  isFile: boolean
}

export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [], isFile: false }
  for (const p of [...paths].sort()) {
    const parts = p.split('/')
    let node = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc === '' ? parts[i] : `${acc}/${parts[i]}`
      const isFile = i === parts.length - 1
      let child = node.children.find((c) => c.name === parts[i] && c.isFile === isFile)
      if (!child) {
        child = { name: parts[i], path: acc, children: [], isFile }
        node.children.push(child)
      }
      node = child
    }
  }
  // Collapse single-child directory chains (a/b/c → "a/b/c"), Fork-style.
  const order = (a: TreeNode, b: TreeNode): number =>
    a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1
  const collapse = (n: TreeNode): TreeNode => {
    while (!n.isFile && n.children.length === 1 && !n.children[0].isFile) {
      const only = n.children[0]
      n = { ...only, name: n.name === '' ? only.name : `${n.name}/${only.name}` }
    }
    return { ...n, children: [...n.children].sort(order).map(collapse) }
  }
  return root.children.map(collapse).sort(order)
}

/** "a/b/c.ts" → { base: "c.ts", dir: "a/b" } (Fork's "View as List" row). */
export function splitPath(path: string): { base: string; dir: string } {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? { base: path, dir: '' } : { base: path.slice(idx + 1), dir: path.slice(0, idx) }
}
