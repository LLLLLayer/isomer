import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initI18n } from './i18n'
import { DEFAULT_SETTINGS } from '../shared/theme'

// Read the persisted language before the first paint — otherwise non-English
// users get an English flash on every launch.
async function start(): Promise<void> {
  let language = DEFAULT_SETTINGS.language
  try {
    language = (await window.isomer.invoke('settings:get', undefined)).language
  } catch {
    /* defaults stand (e.g. tests without a bridge) */
  }
  initI18n(language)
  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void start()
