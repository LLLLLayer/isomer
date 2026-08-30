import { describe, expect, it } from 'vitest'
import { highlightLine, langFor } from './highlight'

describe('langFor', () => {
  it('maps common extensions', () => {
    expect(langFor('src/main/index.ts')).toBe('typescript')
    expect(langFor('crates/core/src/lib.rs')).toBe('rust')
    expect(langFor('shop.py')).toBe('python')
    expect(langFor('a/b/style.scss')).toBe('css')
  })
  it('returns null for unknown extensions', () => {
    expect(langFor('LICENSE')).toBeNull()
    expect(langFor('img.png')).toBeNull()
  })
})

describe('highlightLine', () => {
  it('emits hljs token spans for known languages', () => {
    const html = highlightLine('def checkout(cart):', 'python')
    expect(html).toContain('hljs-')
    expect(html).toContain('checkout')
  })
  it('escapes HTML for unknown languages (no injection)', () => {
    expect(highlightLine('<script>alert(1)</script>', null)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })
  it('escapes HTML inside highlighted code too', () => {
    const html = highlightLine('const a = "<b>"', 'typescript')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })
})
