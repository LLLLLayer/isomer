import type { IsomerApi } from '../shared/ipc'

declare global {
  interface Window {
    isomer: IsomerApi
  }
}
