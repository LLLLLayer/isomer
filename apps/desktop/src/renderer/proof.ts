import type { IsmOp } from '../shared/ipc'

type OpLike = Pick<IsmOp, 'sha' | 'old_head' | 'new_head' | 'old_tree' | 'new_tree'>

/** True when the op's recorded before/after trees are identical — the
 * bit-for-bit "no code changed" proof. */
export function opProven(op: Pick<IsmOp, 'old_tree' | 'new_tree'>): boolean {
  return op.old_tree !== '' && op.old_tree === op.new_tree
}

/** The strip-worthy claim: a REORGANIZE happened and changed no bytes.
 * Undo ops also record equal trees (the tree never changes), but showing
 * "proven reorganize" over a restored original stack would be a lie. */
export function appliedProof(
  op: Pick<IsmOp, 'kind' | 'old_tree' | 'new_tree'>,
): boolean {
  return op.kind === 'apply' && opProven(op)
}

/** Copyable bare-git commands that re-derive the proof without ism. */
export function verifyCommands(op: OpLike): string {
  return [
    `# Isomer op ${op.sha.slice(0, 12)} — verify the reorganize changed no bytes:`,
    `git rev-parse ${op.old_head}^{tree}  # ${op.old_tree}`,
    `git rev-parse ${op.new_head}^{tree}  # ${op.new_tree}`,
    `# identical tree hashes => identical code`,
  ].join('\n')
}
