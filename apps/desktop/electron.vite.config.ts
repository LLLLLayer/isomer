import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  // node-pty is a native module: keep it (and everything in dependencies)
  // out of the bundle graph; electron-vite externalizes deps by default.
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
})
