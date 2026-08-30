import type { Project } from '../shared/ipc'

export interface GroupedProjects {
  pinned: Project[]
  /** Named groups, alphabetical; projects within by recency. */
  groups: [string, Project[]][]
  /** Ungrouped, unpinned, by recency. */
  rest: Project[]
}

const byRecency = (a: Project, b: Project): number => b.lastOpenedAt - a.lastOpenedAt

/** Manager layout: pinned first, then named groups, then the rest.
 * A pinned project appears only in the pinned section — pinning is a
 * promotion, not a copy. */
export function groupProjects(projects: Project[]): GroupedProjects {
  const pinned = projects.filter((p) => p.pinned === true).sort(byRecency)
  const unpinned = projects.filter((p) => p.pinned !== true)
  const map = new Map<string, Project[]>()
  const rest: Project[] = []
  for (const p of unpinned) {
    if (p.group) map.set(p.group, [...(map.get(p.group) ?? []), p])
    else rest.push(p)
  }
  const groups: [string, Project[]][] = [...map.entries()]
    .map(([g, list]): [string, Project[]] => [g, [...list].sort(byRecency)])
    .sort((a, b) => a[0].localeCompare(b[0]))
  rest.sort(byRecency)
  return { pinned, groups, rest }
}
