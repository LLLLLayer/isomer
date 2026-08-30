import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { clamp, usePaneSize } from './resize'
import { storage } from './storage'

describe('clamp', () => {
  it('bounds values on both sides', () => {
    expect(clamp(5, 10, 20)).toBe(10)
    expect(clamp(25, 10, 20)).toBe(20)
    expect(clamp(15, 10, 20)).toBe(15)
  })
})

describe('usePaneSize', () => {
  beforeEach(() => storage._clearMemory())

  it('starts at the initial size, applies clamped deltas, persists', () => {
    const { result } = renderHook(() => usePaneSize('t1', 200, 100, 300))
    expect(result.current[0]).toBe(200)
    act(() => result.current[1](50))
    expect(result.current[0]).toBe(250)
    act(() => result.current[1](500))
    expect(result.current[0]).toBe(300)
    expect(storage.get('pane:t1')).toBe('300')
  })

  it('restores the persisted size within bounds', () => {
    storage.set('pane:t2', '9999')
    const { result } = renderHook(() => usePaneSize('t2', 200, 100, 300))
    expect(result.current[0]).toBe(300)
  })
})
