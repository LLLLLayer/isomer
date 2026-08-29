import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyTheme } from './useTheme'

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

function varsInBlock(selectorMatch: RegExp): string[] {
  const m = css.match(selectorMatch)
  if (!m) return []
  return [...m[0].matchAll(/--([a-z-]+):/g)].map((v) => v[1])
}

describe('design tokens', () => {
  it('light and dark define the same variable set', () => {
    const light = varsInBlock(/:root\[data-theme='light'\] \{[^}]+\}|:root,\n:root\[data-theme='light'\] \{[^}]+\}/)
    const dark = varsInBlock(/:root\[data-theme='dark'\] \{[^}]+\}/)
    expect(light.length).toBeGreaterThan(0)
    expect([...dark].sort()).toEqual([...light].sort())
  })

  it('components never hardcode hex colors outside tokens.css', () => {
    const appCss = readFileSync(join(__dirname, '..', 'app.css'), 'utf8')
    const withoutImport = appCss.replace(/@import[^;]+;/, '')
    expect(withoutImport).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('applyTheme', () => {
  it('sets the explicit preference on <html>', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
