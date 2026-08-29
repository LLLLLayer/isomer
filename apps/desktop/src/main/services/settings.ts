import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../../shared/theme'
import { DEFAULT_SETTINGS } from '../../shared/theme'

export class SettingsStore {
  private value: Settings

  constructor(private file: string) {
    this.value = { ...DEFAULT_SETTINGS }
    try {
      if (existsSync(file)) {
        this.value = { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, 'utf8')) as object) }
      }
    } catch {
      /* defaults stand */
    }
  }

  get(): Settings {
    return { ...this.value }
  }

  update(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.value, null, 2))
    return this.get()
  }
}

export const settingsFile = (userData: string): string => join(userData, 'settings.json')
