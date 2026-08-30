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
      // Watchdog: a wedged capture must never leave a zombie instance.
      setTimeout(() => {
        console.error('ISOMER_SHOT_TIMEOUT')
        app.exit(2)
      }, 20_000)
      setTimeout(() => {
        const probe = `JSON.stringify((() => {
          const info = (el) => {
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            return { cls: el.className && el.className.slice ? el.className.slice(0, 40) : '',
              x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
              disp: cs.display, wrap: cs.flexWrap, dir: cs.flexDirection }
          }
          const cols = document.querySelector('.columns')
          if (!cols) return { none: true }
          return { self: info(cols), kids: [...cols.children].map(info) }
        })())`
        void win.webContents
          .executeJavaScript(probe)
          .then((r: string) => console.log('LAYOUT:', r))
          .then(() => win.webContents.capturePage())
          .then((img) => {
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
  // Shot tooling: force the initial view (e.g. ISOMER_SHOT_VIEW=stack).
  const viewQuery = process.env.ISOMER_SHOT_VIEW
    ? { view: process.env.ISOMER_SHOT_VIEW }
    : undefined
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (viewQuery) url.searchParams.set('view', viewQuery.view)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: viewQuery,
    })
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
