import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Debouncer } from './watcher'

describe('Debouncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once on the trailing edge of a burst', () => {
    let calls = 0
    const d = new Debouncer(() => calls++, 100)
    d.poke()
    vi.advanceTimersByTime(50)
    d.poke()
    vi.advanceTimersByTime(50)
    d.poke()
    expect(calls).toBe(0)
    vi.advanceTimersByTime(100)
    expect(calls).toBe(1)
  })

  it('cancel suppresses a pending fire', () => {
    let calls = 0
    const d = new Debouncer(() => calls++, 100)
    d.poke()
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(calls).toBe(0)
  })
})
