import { spawn } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export type Exec = (
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number; stdin?: string; env?: Record<string, string> },
) => Promise<ExecResult>

/** Real spawn-based executor. Services take `Exec` injected so unit tests
 * can substitute a fake without touching the filesystem. */
export const realExec: Exec = (command, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin)
      child.stdin?.end()
    }
    // Accumulate raw buffers and decode once: per-chunk decoding corrupts
    // multi-byte UTF-8 characters that straddle pipe-chunk boundaries.
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
      : undefined
    child.stdout?.on('data', (d: Buffer) => stdout.push(d))
    child.stderr?.on('data', (d: Buffer) => stderr.push(d))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
