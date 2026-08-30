/** localStorage with an in-memory fallback (tests, exotic environments). */
const memory = new Map<string, string>()

function backing(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export const storage = {
  get(key: string): string | null {
    const b = backing()
    return b ? b.getItem(key) : (memory.get(key) ?? null)
  },
  set(key: string, value: string): void {
    const b = backing()
    if (b) b.setItem(key, value)
    else memory.set(key, value)
  },
  /** Test helper: reset the in-memory fallback. */
  _clearMemory(): void {
    memory.clear()
  },
}
