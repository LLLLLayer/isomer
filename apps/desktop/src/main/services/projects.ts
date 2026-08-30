import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Project } from '../../shared/ipc'

/** Multi-project registry persisted as JSON under userData. */
export class ProjectRegistry {
  private projects: Project[] = []

  constructor(private file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.file)) {
        this.projects = JSON.parse(readFileSync(this.file, 'utf8')) as Project[]
      }
    } catch {
      // Preserve the corrupt file instead of silently overwriting it with
      // an empty registry on the next save.
      try {
        renameSync(this.file, `${this.file}.corrupt`)
      } catch {
        /* best effort */
      }
      this.projects = []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    // tmp + rename: a crash mid-write must not truncate the registry.
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.projects, null, 2))
    renameSync(tmp, this.file)
  }

  list(): Project[] {
    return [...this.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id)
  }

  add(path: string): Project {
    const existing = this.projects.find((p) => p.path === path)
    if (existing) {
      existing.lastOpenedAt = Date.now()
      this.save()
      return existing
    }
    const project: Project = {
      id: randomUUID(),
      path,
      name: basename(path),
      lastOpenedAt: Date.now(),
    }
    this.projects.push(project)
    this.save()
    return project
  }

  remove(id: string): void {
    this.projects = this.projects.filter((p) => p.id !== id)
    this.save()
  }

  /** Manager metadata; '' and null both clear the group. `touch` bumps
   * recency (called on every open, so "Recent" means recently OPENED). */
  update(id: string, patch: { group?: string | null; pinned?: boolean; touch?: boolean }): Project[] {
    const p = this.projects.find((x) => x.id === id)
    if (p) {
      if (patch.touch === true) p.lastOpenedAt = Date.now()
      if (patch.group !== undefined) {
        const g = patch.group?.trim()
        if (g) p.group = g
        else delete p.group
      }
      if (patch.pinned !== undefined) {
        if (patch.pinned) p.pinned = true
        else delete p.pinned
      }
      this.save()
    }
    return this.list()
  }
}

export const projectsFile = (userData: string): string => join(userData, 'projects.json')
