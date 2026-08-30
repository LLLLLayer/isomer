import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { registerIpc } from './ipc'
import { realExec } from './services/exec'

let disposeIpc: (() => void) | undefined

/** Headless boot proof: load everything, print a marker, quit. Used by CI
 * and scripted smoke checks; the window is never shown. */
const SMOKE = process.env.ISOMER_SMOKE === '1'

/** Self-screenshot mode: render, capture the page to this path, quit.
 * Shown inactive (no focus steal); used for docs and visual checks. */
const SHOT = process.env.ISOMER_SHOT

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // macOS glass: the sidebar material blurs the desktop through any
    // transparent region of the page (the renderer keeps content panes
    // opaque and lets the chrome areas go translucent).
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'sidebar' as const,
          visualEffectState: 'followWindow' as const,
          backgroundColor: '#00000000',
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses ESM; renderer itself stays non-node
    },
  })
  win.on('ready-to-show', () => {
    if (SMOKE) return
    if (SHOT) win.showInactive()
    else win.show()
  })
  win.webContents.on('did-finish-load', () => {
    if (SMOKE) {
      console.log('ISOMER_SMOKE_OK')
      app.quit()
    }
    if (SHOT) {
      setTimeout(() => {
        void win.webContents.capturePage().then((img) => {
          writeFileSync(SHOT, img.toPNG())
          console.log('ISOMER_SHOT_OK')
          app.exit(0)
        })
      }, 2500)
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`renderer failed to load: ${code} ${desc}`)
    if (SMOKE) app.exit(1)
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
  // No window ⇒ no terminal UI; reap pty sessions so shells never outlive
  // their tabs (on macOS the app itself stays alive).
  disposeIpc?.()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposeIpc?.()
})
