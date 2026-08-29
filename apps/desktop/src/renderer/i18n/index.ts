import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Language } from '../../shared/theme'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const

export function initI18n(language: Language): void {
  void i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })
}

export function setLanguage(language: Language): void {
  void i18next.changeLanguage(language)
}
