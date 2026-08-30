import { useCallback, useRef, useState } from 'react'
import { storage } from './storage'

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Persistent, draggable pane size. `invert` grows the pane when dragging
 * toward the start (right/bottom-anchored panes). */
export function usePaneSize(
  key: string,
  initial: number,
  min: number,
  max: number,
): [number, (delta: number) => void] {
  const storageKey = `pane:${key}`
  const [size, setSize] = useState(() => {
    const raw = Number(storage.get(storageKey))
    return clamp(Number.isFinite(raw) && raw > 0 ? raw : initial, min, max)
  })
  const apply = useCallback(
    (delta: number) => {
      setSize((prev) => {
        const next = clamp(prev + delta, min, max)
        storage.set(storageKey, String(next))
        return next
      })
    },
    [storageKey, min, max],
  )
  return [size, apply]
}

/** Drag handle between panes. Reports pointer deltas along one axis. */
export function Splitter({
  axis,
  onDelta,
}: {
  axis: 'x' | 'y'
  onDelta: (delta: number) => void
}): React.JSX.Element {
  const last = useRef(0)
  return (
    <div
      className={`splitter ${axis}`}
      onPointerDown={(e) => {
        last.current = axis === 'x' ? e.clientX : e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const now = axis === 'x' ? e.clientX : e.clientY
        onDelta(now - last.current)
        last.current = now
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
    />
  )
}
