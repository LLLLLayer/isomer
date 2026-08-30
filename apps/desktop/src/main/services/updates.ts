/** Release check against GitHub — no updater daemon, no silent installs.
 * The app only learns "a newer version exists" and walks the user to the
 * release page; downloading stays an explicit user action. */

export interface UpdateInfo {
  version: string
  url: string
  notes: string
}

const RELEASES_LATEST = 'https://api.github.com/repos/LLLLLayer/isomer/releases/latest'

/** Numeric dotted-version compare; returns >0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (Number.isNaN(d)) return 0
    if (d !== 0) return d
  }
  return 0
}

/** Extract an update offer from the GitHub latest-release payload. */
export function parseLatestRelease(payload: unknown, current: string): UpdateInfo | null {
  if (typeof payload !== 'object' || payload === null) return null
  const rel = payload as { tag_name?: string; html_url?: string; body?: string; draft?: boolean; prerelease?: boolean }
  if (!rel.tag_name || !rel.html_url || rel.draft || rel.prerelease) return null
  const version = rel.tag_name.replace(/^v/, '')
  if (compareVersions(version, current) <= 0) return null
  return { version, url: rel.html_url, notes: (rel.body ?? '').slice(0, 2000) }
}

export async function checkForUpdate(
  current: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  const res = await fetchImpl(RELEASES_LATEST, {
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
  return parseLatestRelease(await res.json(), current)
}
