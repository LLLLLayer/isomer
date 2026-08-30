import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvokeChannel } from '../../shared/ipc'
import { firstError, useAppStore } from './store'

type Handler = (req: unknown) => unknown

/** Install a fake preload bridge; returns the per-channel call log. */
function fakeBridge(handlers: Partial<Record<InvokeChannel, Handler>>): string[] {
  const calls: string[] = []
  ;(window as unknown as { isomer: unknown }).isomer = {
    invoke: (channel: InvokeChannel, req: unknown) => {
      calls.push(channel)
      const h = handlers[channel]
      if (!h) throw new Error(`unstubbed channel ${channel}`)
      return Promise.resolve(h(req))
    },
    on: () => () => {},
  }
  return calls
}

describe('firstError', () => {
  it('returns null when everything succeeded', () => {
    expect(firstError([{ ok: true }, { ok: true }])).toBeNull()
  })
  it('returns the first failure', () => {
    const e = { code: 'E010', message: 'stale' }
    expect(firstError([{ ok: true }, { ok: false, error: e }])).toBe(e)
  })
})

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState({
      projects: [],
      currentProjectId: null,
      comments: [],
      lastError: null,
      terminalOpen: false,
    })
  })

  it('openProject resets state then loads the project data sources', async () => {
    fakeBridge({
      'git:status': () => ({ ok: true, data: { branch: 'feat', upstream: null, ahead: 0, behind: 0, entries: [] } }),
      'git:log': () => ({ ok: true, data: [] }),
      'repo:watch': () => undefined,
      'projects:update': () => [],
      'git:refs': () => ({ ok: true, data: { current: 'feat', locals: { feat: 'aaaa' }, remotes: {}, tags: {}, stashes: 0, submodules: [] } }),
      'git:stash-list': () => ({ ok: true, data: [] }),
      'ism:snapshot': () => ({ ok: false, error: { code: 'E101', message: 'empty stack' } }),
      'ism:comment-list': () => ({ ok: true, data: [] }),
    })
    await useAppStore.getState().openProject('p1')
    const s = useAppStore.getState()
    expect(s.currentProjectId).toBe('p1')
    expect(s.status?.branch).toBe('feat')
    // A failed snapshot leaves the stack empty but is not fatal.
    expect(s.snapshot).toBeNull()
  })

  it('resolveComment swaps the resolved comment in place', async () => {
    const resolved = { id: 'c-1', change: 'i-1', body: 'x', resolved: true }
    fakeBridge({ 'ism:comment-resolve': () => ({ ok: true, data: resolved }) })
    useAppStore.setState({
      currentProjectId: 'p1',
      comments: [{ id: 'c-1', change: 'i-1', body: 'x', resolved: false } as never],
    })
    await useAppStore.getState().resolveComment('c-1')
    expect(useAppStore.getState().comments[0].resolved).toBe(true)
  })

  it('surfaces bridge errors on lastError', async () => {
    fakeBridge({
      'ism:comment-resolve': () => ({ ok: false, error: { code: 'E002', message: 'unknown' } }),
    })
    useAppStore.setState({ currentProjectId: 'p1' })
    await useAppStore.getState().resolveComment('c-missing')
    expect(useAppStore.getState().lastError?.code).toBe('E002')
  })

  it('drops slow responses that arrive after a project switch', async () => {
    let releaseA: () => void = () => {}
    const gate = new Promise<void>((res) => (releaseA = res))
    const slowStatus = { branch: 'stale-A', upstream: null, ahead: 0, behind: 0, entries: [] }
    fakeBridge({
      'git:status': async () => {
        await gate
        return { ok: true, data: slowStatus }
      },
      'git:log': () => ({ ok: true, data: [] }),
      'repo:watch': () => undefined,
      'projects:update': () => [],
      'git:refs': () => ({ ok: true, data: { current: '', locals: {}, remotes: {}, tags: {}, stashes: 0, submodules: [] } }),
      'git:stash-list': () => ({ ok: true, data: [] }),
      'ism:snapshot': () => ({ ok: false, error: { code: 'E101', message: 'x' } }),
      'ism:comment-list': () => ({ ok: true, data: [] }),
    })
    const first = useAppStore.getState().openProject('A')
    // The user switches before A's status resolves.
    useAppStore.setState({ currentProjectId: 'B', status: null })
    releaseA()
    await first
    expect(useAppStore.getState().status?.branch).not.toBe('stale-A')
  })

  it('toggleTerminal flips the drawer', () => {
    expect(useAppStore.getState().terminalOpen).toBe(false)
    useAppStore.getState().toggleTerminal()
    expect(useAppStore.getState().terminalOpen).toBe(true)
  })
})

// Silence unused-import lint for vi if config changes later.
void vi
