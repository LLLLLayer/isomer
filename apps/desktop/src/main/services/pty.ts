import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Coalesce pty output for up to `waitMs` or `maxBytes`, whichever first,
 * and prefix every flush with the 36-char session id — the renderer splits
 * positionally instead of paying per-chunk envelope costs (Hyper's trick).
 * Pure class, unit-tested without a real pty.
 */
export class DataBatcher {
  private buffer = ''
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private sessionId: string,
    private emit: (payload: string) => void,
    private waitMs = 16,
    private maxBytes = 200 * 1024,
  ) {}

  push(data: string): void {
    this.buffer += data
    if (this.buffer.length >= this.maxBytes) {
      this.flush()
      return
    }
    this.timer ??= setTimeout(() => this.flush(), this.waitMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.buffer === '') return
    const payload = this.sessionId + this.buffer
    this.buffer = ''
    this.emit(payload)
  }
}

interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
}

interface Session {
  pty: PtyLike
  batcher: DataBatcher
}

export interface PtyEvents {
  onData(payload: string): void
  onExit(id: string, exitCode: number): void
}

/** Sessions keyed by uuid; node-pty is required lazily (native module). */
export class PtyService {
  private sessions = new Map<string, Session>()

  constructor(private events: PtyEvents) {}

  create(cwd: string, cols: number, rows: number): string {
    // Lazy require keeps the native module out of startup and test paths.
    const nativeRequire = createRequire(import.meta.url)
    // npm does not always preserve the exec bit on node-pty's spawn-helper
    // (symptom: "posix_spawnp failed"); heal it before every spawn.
    try {
      const ptyRoot = dirname(nativeRequire.resolve('node-pty/package.json'))
      chmodSync(
        join(ptyRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
        0o755,
      )
    } catch {
      /* no prebuild for this platform — node-gyp builds are fine */
    }
    const nodePty = nativeRequire('node-pty') as {
      spawn(file: string, args: string[], opts: object): PtyLike & {
        onData(cb: (d: string) => void): void
        onExit(cb: (e: { exitCode: number }) => void): void
      }
    }
    const shell =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    const id = randomUUID()
    const pty = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env,
    })
    const batcher = new DataBatcher(id, (payload) => this.events.onData(payload))
    pty.onData((d) => batcher.push(d))
    pty.onExit(({ exitCode }) => {
      batcher.flush()
      this.sessions.delete(id)
      this.events.onExit(id, exitCode)
    })
    this.sessions.set(id, { pty, batcher })
    return id
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    this.sessions.get(id)?.pty.kill()
    this.sessions.delete(id)
  }

  disposeAll(): void {
    for (const [id] of this.sessions) this.kill(id)
  }
}
