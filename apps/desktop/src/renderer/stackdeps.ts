/** One change-level dependency edge, with the hunk pairs that prove it. */
export interface DepEdge {
  /** The sha of the change this edge points at. */
  target: string
  /** Evidence: [dependentHunk, dependencyHunk] pairs pinning the edge. */
  via: [string, string][]
}

export interface ChangeDeps {
  /** Changes that must exist below this one (earlier in the stack). */
  needs: DepEdge[]
  /** Changes above that are pinned onto this one. */
  neededBy: string[]
}

/** Lift ism's hunk-level hard deps to change level. `independent` holds
 * commits with no edges either way — provably safe to reorder, split out,
 * or land alone. This is the fact no other client can state. */
export function changeDeps(snapshot: {
  commits: { sha: string; hunks: string[] }[]
  deps: [string, string][]
}): {
  bySha: Map<string, ChangeDeps>
  independent: Set<string>
} {
  const owner = new Map<string, string>()
  for (const c of snapshot.commits) for (const h of c.hunks) owner.set(h, c.sha)

  const bySha = new Map<string, ChangeDeps>()
  const entry = (sha: string): ChangeDeps => {
    let e = bySha.get(sha)
    if (!e) {
      e = { needs: [], neededBy: [] }
      bySha.set(sha, e)
    }
    return e
  }
  for (const c of snapshot.commits) entry(c.sha)

  for (const [dependent, dependency] of snapshot.deps) {
    const a = owner.get(dependent)
    const b = owner.get(dependency)
    if (a === undefined || b === undefined || a === b) continue
    const e = entry(a)
    let edge = e.needs.find((x) => x.target === b)
    if (!edge) {
      edge = { target: b, via: [] }
      e.needs.push(edge)
    }
    edge.via.push([dependent, dependency])
    const back = entry(b)
    if (!back.neededBy.includes(a)) back.neededBy.push(a)
  }

  const independent = new Set<string>()
  for (const [sha, e] of bySha) {
    if (e.needs.length === 0 && e.neededBy.length === 0) independent.add(sha)
  }
  return { bySha, independent }
}

/** A draft-order violation: `hunk` (in draft `nodeKey`) hard-depends on
 * `dep`, which sits in a LATER draft (`depNodeKey`) — apply would fail. */
export interface OrderViolation {
  nodeKey: string
  hunk: string
  dep: string
  depNodeKey: string
}

/** Live advisory for the stack editor. Hunks whose dependency is not
 * assigned anywhere are NOT flagged (mid-edit is normal); the CLI's R1–R8
 * check remains the authority — this only explains failures before they
 * happen, in terms of which line identities pin which draft. */
export function orderViolations(
  nodes: { key: string; from: string[] }[],
  deps: [string, string][],
): OrderViolation[] {
  const nodeOf = new Map<string, { key: string; index: number }>()
  nodes.forEach((n, index) => {
    for (const h of n.from) nodeOf.set(h, { key: n.key, index })
  })
  const out: OrderViolation[] = []
  for (const [dependent, dependency] of deps) {
    const a = nodeOf.get(dependent)
    const b = nodeOf.get(dependency)
    if (!a || !b || b.index <= a.index) continue
    out.push({ nodeKey: a.key, hunk: dependent, dep: dependency, depNodeKey: b.key })
  }
  return out
}
