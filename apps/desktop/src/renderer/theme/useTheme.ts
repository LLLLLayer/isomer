import { useEffect } from 'react'
import type { ThemePreference } from '../../shared/theme'

/** Apply the theme preference to <html data-theme>; 'system' tracks the OS. */
export function applyTheme(pref: ThemePreference): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const effective = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
  document.documentElement.dataset.theme = effective
}

export function useTheme(pref: ThemePreference): void {
  useEffect(() => {
    applyTheme(pref)
    if (pref !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [pref])
}
