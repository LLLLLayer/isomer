import { describe, expect, it } from 'vitest'
import { appliedProof, opProven, verifyCommands } from './proof'

const op = {
  sha: 'op123456789abc',
  old_head: 'aaa111',
  new_head: 'bbb222',
  old_tree: 'tree333',
  new_tree: 'tree333',
}

describe('opProven', () => {
  it('holds only when both trees are recorded and equal', () => {
    expect(opProven(op)).toBe(true)
    expect(opProven({ ...op, new_tree: 'other' })).toBe(false)
    expect(opProven({ old_tree: '', new_tree: '' })).toBe(false)
  })
})

describe('appliedProof', () => {
  it('accepts only APPLY ops — an undo also has equal trees but proves nothing new', () => {
    expect(appliedProof({ kind: 'apply', ...op })).toBe(true)
    expect(appliedProof({ kind: 'undo', ...op })).toBe(false)
  })
})

describe('verifyCommands', () => {
  it('emits bare-git commands naming both heads and both trees', () => {
    const s = verifyCommands(op)
    expect(s).toContain('git rev-parse aaa111^{tree}')
    expect(s).toContain('git rev-parse bbb222^{tree}')
    expect(s.match(/tree333/g)).toHaveLength(2)
    expect(s).toContain(op.sha.slice(0, 12))
  })
})
