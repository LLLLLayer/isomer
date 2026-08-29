import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initI18n } from './i18n'
import { DEFAULT_SETTINGS } from '../shared/theme'

initI18n(DEFAULT_SETTINGS.language)

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
