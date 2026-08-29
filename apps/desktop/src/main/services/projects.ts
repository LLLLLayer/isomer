import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
      this.projects = []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.projects, null, 2))
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
}

export const projectsFile = (userData: string): string => join(userData, 'projects.json')
