import { contextBridge, ipcRenderer } from 'electron'
import type { InvokeChannel, IsomerApi, PushChannel } from '../shared/ipc'
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '../shared/ipc'

// Runtime enforcement of the contract table: TypeScript types vanish at the
// bridge, so a compromised renderer must not be able to reach arbitrary
// channels through it.
const invokeAllowed: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const pushAllowed: ReadonlySet<string> = new Set(PUSH_CHANNELS)

/**
 * The only bridge between worlds. Nothing else from Node/Electron is ever
 * exposed; the renderer sees exactly the IsomerApi contract.
 */
const api: IsomerApi = {
  platform: process.platform,
  invoke: (channel: InvokeChannel, req) => {
    if (!invokeAllowed.has(channel)) {
      return Promise.reject(new Error(`unknown IPC channel: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel, req)
  },
  on: (channel: PushChannel, listener) => {
    if (!pushAllowed.has(channel)) {
      throw new Error(`unknown IPC channel: ${String(channel)}`)
    }
    const wrapped = (_event: unknown, ...args: unknown[]): void =>
      (listener as (payload: unknown) => void)(args[0])
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('isomer', api)
