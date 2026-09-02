/** Pure helpers behind the stack editor's hunk board: the stack's hunks
 * regrouped by file (the unit a human reads and splits), per-hunk hard-dep
 * adjacency, and the renderable diff of one file group. */

import type { HunkMeta } from '../shared/ism-types'
import type { FileDiff } from './diff'
import { parseHunkPatch } from './diff'

export interface FileGroup {
  path: string
  /** This file's hunks in post-image line order. */
  hunks: HunkMeta[]
}

/** Group hunks by file. Files keep first-touch (landing) order; within a
 * file hunks sort by the start line of each hunk's own step, ties by stack
 * order. Exact file order within one commit; across commits the
 * coordinates belong to different post-images, so it is a reading
 * approximation — the header's line numbers and heading say where a hunk
 * really is. */
export function fileGroups(hunks: HunkMeta[]): FileGroup[] {
  const byPath = new Map<string, { hunk: HunkMeta; index: number }[]>()
  hunks.forEach((hunk, index) => {
    const path = pathOf(hunk.id)
    const list = byPath.get(path)
    if (list) list.push({ hunk, index })
    else byPath.set(path, [{ hunk, index }])
  })
  return [...byPath.entries()].map(([path, list]) => ({
    path,
    hunks: list
      .sort((a, b) => a.hunk.new_range[0] - b.hunk.new_range[0] || a.index - b.index)
      .map((e) => e.hunk),
  }))
}

/** The file part of a `path:line#digest` hunk id. Paths may contain ':'
 * — the line/digest tail is the LAST ':' segment. */
export function pathOf(hunkId: string): string {
  const cut = hunkId.lastIndexOf(':')
  return cut < 0 ? hunkId : hunkId.slice(0, cut)
}

export interface HunkAdjacency {
  /** Hunks this one hard-depends on (their created lines pin it). */
  needs: string[]
  /** Hunks pinned onto this one. */
  neededBy: string[]
}

/** Per-hunk adjacency from ism's `[dependent, dependency]` pairs. */
export function hunkDeps(deps: [string, string][]): Map<string, HunkAdjacency> {
  const map = new Map<string, HunkAdjacency>()
  const entry = (id: string): HunkAdjacency => {
    let e = map.get(id)
    if (!e) {
      e = { needs: [], neededBy: [] }
      map.set(id, e)
    }
    return e
  }
  for (const [dependent, dependency] of deps) {
    const a = entry(dependent)
    if (!a.needs.includes(dependency)) a.needs.push(dependency)
    const b = entry(dependency)
    if (!b.neededBy.includes(dependent)) b.neededBy.push(dependent)
  }
  return map
}

/** The hunk header as a human reads it: ranges plus git's function heading. */
export function hunkHeader(hunk: HunkMeta): string {
  const [os, ol] = hunk.old_range
  const [ns, nl] = hunk.new_range
  const head = `@@ -${os},${ol} +${ns},${nl} @@`
  return hunk.context ? `${head} ${hunk.context}` : head
}

export interface GroupDiff extends FileDiff {
  /** Hunk ids in header (gap row) order — the diff renderer's per-hunk
   * ordinal indexes this. Empty for a degraded whole-file unit. */
  hunkIds: string[]
}

/** Renderable diff for one file group. Every line-level hunk contributes a
 * header row; its removed/added rows follow once the patch is loaded (a
 * still-loading hunk shows its header alone, so it can be assigned before
 * the code arrives). Degraded whole-file units (one per commit touching a
 * degraded path — they never mix with line hunks) become the file's note,
 * one line each. */
export function groupDiff(group: FileGroup, patches: Record<string, string>): GroupDiff {
  const out: GroupDiff = { path: group.path, note: null, rows: [], hunkIds: [] }
  const notes: string[] = []
  for (const hunk of group.hunks) {
    if (hunk.kind === 'file') {
      const note = patches[hunk.id]?.trim()
      if (note) notes.push(note)
      out.note = notes.length > 0 ? notes.join('\n') : null
      continue
    }
    out.hunkIds.push(hunk.id)
    out.rows.push({ kind: 'gap', oldNo: null, newNo: null, text: hunkHeader(hunk) })
    const patch = patches[hunk.id]
    const parsed = patch === undefined ? null : parseHunkPatch(patch)
    if (!parsed) continue
    parsed.removed.forEach((text, i) =>
      out.rows.push({ kind: 'del', oldNo: parsed.oldStart + i, newNo: null, text }),
    )
    parsed.added.forEach((text, i) =>
      out.rows.push({ kind: 'add', oldNo: null, newNo: parsed.newStart + i, text }),
    )
  }
  return out
}
