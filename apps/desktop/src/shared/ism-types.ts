/**
 * Hand-written mirror of ism's serde types (crates/ism-core/src/model.rs).
 * The CLI's JSON output IS the contract; a fixture round-trip test guards
 * against drift (see ism-types.test.ts).
 */

export interface Snapshot {
  snapshot_digest: string
  base: string
  head: string
  branch: string
  commits: CommitInfo[]
  hunks: HunkMeta[]
  /** Hard dependency edges: [dependent, dependency]. */
  deps: [string, string][]
  anomalies: Anomaly[]
}

export interface CommitInfo {
  sha: string
  title: string
  change_id: string | null
  hunks: string[]
}

export type HunkKind = 'add' | 'mod' | 'del' | 'file'

export interface HunkMeta {
  id: string
  commit: string
  kind: HunkKind
  old_range: [number, number]
  new_range: [number, number]
  lines: { add: number; del: number }
  patch?: string
}

export type Anomaly =
  | { kind: 'untracked'; commit: string }
  | { kind: 'duplicate_id'; change_id: string; commits: string[] }
  | { kind: 'unknown_id'; change_id: string; commit: string }
  | { kind: 'merged'; commit: string; change_ids: string[] }
  | { kind: 'orphan'; change_id: string }
  | { kind: 'merge_in_stack'; commit: string }
  | { kind: 'dangling_op_voided'; op: string }

export interface Plan {
  version: 1
  snapshot_digest: string
  base?: string
  head?: string
  nodes: PlanNode[]
  order: string[]
}

export interface PlanNode {
  name?: string
  change?: string
  summary: string
  body?: string
  from: string | string[]
  deps?: string[]
}

export interface ApplyOutcome {
  new_head: string
  changes: AppliedChange[]
  op: string
}

export interface AppliedChange {
  id: string
  name?: string
  commit: string
  summary: string
}

export interface VerifyOutcome {
  ok: boolean
  branch: string
  op: string
  old_head: string
  new_head: string
  old_tree: string
  new_tree: string
  live: boolean
  reproduce: string[]
}

export interface Comment {
  id: string
  change: string
  path?: string
  line?: number
  parent?: string
  body: string
  author_name: string
  author_email: string
  created_at: string
  resolved: boolean
}

/** One entry of `ism show hunk <id>...`. */
export interface HunkPatch {
  id: string
  commit: string
  patch: string
}

export interface IsmErrorReport {
  code: string
  message: string
  hint: string
  context?: unknown
}
