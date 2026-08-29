import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBatcher } from './pty'

const ID = '0'.repeat(36)

describe('DataBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces writes inside the window into one prefixed payload', () => {
    const out: string[] = []
    const b = new DataBatcher(ID, (p) => out.push(p), 16, 1000)
    b.push('hello ')
    b.push('world')
    expect(out).toEqual([])
    vi.advanceTimersByTime(16)
    expect(out).toEqual([ID + 'hello world'])
  })

  it('flushes immediately when maxBytes is reached', () => {
    const out: string[] = []
    const b = new DataBatcher(ID, (p) => out.push(p), 16, 8)
    b.push('12345678')
    expect(out).toEqual([ID + '12345678'])
  })

  it('flush() is a no-op when empty and drains pending data otherwise', () => {
    const out: string[] = []
    const b = new DataBatcher(ID, (p) => out.push(p))
    b.flush()
    expect(out).toEqual([])
    b.push('x')
    b.flush()
    expect(out).toEqual([ID + 'x'])
    vi.advanceTimersByTime(100)
    expect(out).toEqual([ID + 'x'])
  })
})
