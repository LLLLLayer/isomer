import { existsSync, statSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'

/** Trailing-edge debouncer; pure logic, unit-tested with fake timers. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private fn: () => void,
    private waitMs: number,
  ) {}

  poke(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.fn()
    }, this.waitMs)
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

/**
 * Watches the active project's .git for external activity (commits made in
 * a terminal, ism applies, rebases…) and fires a debounced callback.
 * Detect-and-refresh, never lock — the guest philosophy, in the app.
 */
export class RepoWatcher {
  private watcher: FSWatcher | null = null
  private debouncer: Debouncer | null = null

  watch(repoPath: string, onChange: () => void): void {
    this.dispose()
    const gitPath = join(repoPath, '.git')
    if (!existsSync(gitPath)) return
    const debouncer = new Debouncer(onChange, 350)
    this.debouncer = debouncer
    try {
      const recursive = statSync(gitPath).isDirectory()
      this.watcher = watch(gitPath, { recursive }, (_event, filename) => {
        // Lockfiles churn on every optional-lock-free write anyway; ignore.
        if (filename && filename.toString().endsWith('.lock')) return
        debouncer.poke()
      })
    } catch {
      this.watcher = null
    }
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
    this.debouncer?.cancel()
    this.debouncer = null
  }
}
