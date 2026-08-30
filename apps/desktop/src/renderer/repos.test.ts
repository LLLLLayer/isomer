import { describe, expect, it } from 'vitest'
import { groupProjects } from './repos'

const p = (id: string, at: number, extra: object = {}) => ({
  id,
  path: `/r/${id}`,
  name: id,
  lastOpenedAt: at,
  ...extra,
})

describe('groupProjects', () => {
  it('promotes pinned out of groups and sorts every section', () => {
    const g = groupProjects([
      p('old', 1),
      p('work-a', 5, { group: 'work' }),
      p('work-b', 9, { group: 'work' }),
      p('alpha', 3, { group: 'aaa' }),
      p('star', 2, { pinned: true, group: 'work' }),
      p('fresh', 8),
    ])
    expect(g.pinned.map((x) => x.id)).toEqual(['star'])
    expect(g.groups.map(([name]) => name)).toEqual(['aaa', 'work'])
    expect(g.groups[1][1].map((x) => x.id)).toEqual(['work-b', 'work-a'])
    expect(g.rest.map((x) => x.id)).toEqual(['fresh', 'old'])
  })

  it('handles the empty registry', () => {
    expect(groupProjects([])).toEqual({ pinned: [], groups: [], rest: [] })
  })
})
