import { contextBridge, ipcRenderer } from 'electron'
import type { InvokeChannel, IsomerApi, PushChannel } from '../shared/ipc'

/**
 * The only bridge between worlds. Nothing else from Node/Electron is ever
 * exposed; the renderer sees exactly the IsomerApi contract.
 */
const api: IsomerApi = {
  invoke: (channel: InvokeChannel, req) => ipcRenderer.invoke(channel, req),
  on: (channel: PushChannel, listener) => {
    const wrapped = (_event: unknown, ...args: unknown[]): void =>
      (listener as (payload: unknown) => void)(args[0])
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('isomer', api)
