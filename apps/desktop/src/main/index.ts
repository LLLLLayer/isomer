import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { registerIpc } from './ipc'
import { realExec } from './services/exec'

let disposeIpc: (() => void) | undefined

/** Headless boot proof: load everything, print a marker, quit. Used by CI
 * and scripted smoke checks; the window is never shown. */
const SMOKE = process.env.ISOMER_SMOKE === '1'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses ESM; renderer itself stays non-node
    },
  })
  win.on('ready-to-show', () => {
    if (!SMOKE) win.show()
  })
  win.webContents.on('did-finish-load', () => {
    if (SMOKE) {
      console.log('ISOMER_SMOKE_OK')
      app.quit()
    }
  })
  // External links go to the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  const { dispose } = registerIpc(realExec)
  disposeIpc = dispose
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposeIpc?.()
})
