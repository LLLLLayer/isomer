import { describe, expect, it } from 'vitest'
import { buildFileTree, splitPath } from './filetree'

describe('buildFileTree', () => {
  it('nests by directory and collapses single-child chains', () => {
    const tree = buildFileTree([
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/ipc.ts',
      'README.md',
    ])
    expect(tree.map((n) => n.name)).toEqual(['apps/desktop/src/main', 'README.md'])
    const main = tree[0]
    expect(main.isFile).toBe(false)
    expect(main.children.map((c) => c.name)).toEqual(['index.ts', 'ipc.ts'])
    expect(main.children[0].path).toBe('apps/desktop/src/main/index.ts')
    expect(tree[1].isFile).toBe(true)
  })

  it('keeps directories that fan out', () => {
    const tree = buildFileTree(['src/a/x.ts', 'src/b/y.ts'])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('src')
    expect(tree[0].children.map((c) => c.name)).toEqual(['a', 'b'])
  })
})

describe('splitPath', () => {
  it('splits directory and basename', () => {
    expect(splitPath('apps/desktop/src/a.ts')).toEqual({ base: 'a.ts', dir: 'apps/desktop/src' })
    expect(splitPath('README.md')).toEqual({ base: 'README.md', dir: '' })
  })
})
