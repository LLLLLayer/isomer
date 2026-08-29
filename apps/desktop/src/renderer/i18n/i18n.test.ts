import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

/** Flatten nested locale objects into dotted key paths. */
function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

describe('locale parity', () => {
  it('en and zh-CN define exactly the same keys', () => {
    expect(keysOf(zhCN).sort()).toEqual(keysOf(en).sort())
  })

  it('no locale value is empty', () => {
    for (const locale of [en, zhCN]) {
      for (const key of keysOf(locale)) {
        const value = key.split('.').reduce<unknown>(
          (o, k) => (o as Record<string, unknown>)[k],
          locale,
        )
        expect(value, key).toBeTruthy()
      }
    }
  })
})
