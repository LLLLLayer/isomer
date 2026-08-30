import { describe, expect, it } from 'vitest'
import { branchNameFor, markerIdOf, planStack, prBody, stackMarker } from './stackplan'

const stack = [
  { id: 'i-aaaa2222', name: 'core-model', summary: 'Core model', sha: '1111111' },
  { id: 'i-bbbb3333', name: 'wire-ui', summary: 'Wire the UI', sha: '2222222', description: 'Long form.' },
]
const opts = { trunk: 'main', prefix: 'stack/' }

describe('planStack', () => {
  it('chains bases bottom→top starting at the trunk', () => {
    const plan = planStack(stack, [], opts)
    expect(plan.pushes.map((p) => [p.branch, p.base])).toEqual([
      ['stack/core-model', 'main'],
      ['stack/wire-ui', 'stack/core-model'],
    ])
    expect(plan.actions.every((a) => a.kind === 'create')).toBe(true)
  })

  it('matches existing PRs by marker id, not branch name', () => {
    const pr = {
      number: 7,
      headRefName: 'stack/old-name',
      baseRefName: 'main',
      body: `whatever\n${stackMarker('i-bbbb3333')}`,
    }
    const plan = planStack(stack, [pr], opts)
    const update = plan.actions[1]
    expect(update.kind).toBe('update')
    if (update.kind === 'update') {
      expect(update.number).toBe(7)
      expect(update.retarget).toBe('stack/core-model')
    }
  })

  it('keeps an aligned base untouched and reports orphans', () => {
    const aligned = {
      number: 1,
      headRefName: 'stack/core-model',
      baseRefName: 'main',
      body: stackMarker('i-aaaa2222'),
    }
    const orphan = { number: 9, headRefName: 'stack/gone', baseRefName: 'main', body: stackMarker('i-dead0000') }
    const unrelated = { number: 3, headRefName: 'feature-x', baseRefName: 'main', body: 'no marker' }
    const plan = planStack(stack, [aligned, orphan, unrelated], opts)
    const a0 = plan.actions[0]
    expect(a0.kind === 'update' && a0.retarget).toBe(null)
    expect(plan.orphans).toEqual([orphan])
  })
})

describe('prBody', () => {
  it('carries description, the stack table with a this-PR marker, and the identity', () => {
    const body = prBody(stack[1], stack, 'stack/')
    expect(body).toContain('Long form.')
    expect(body).toContain('1. `stack/core-model` — Core model')
    expect(body).toContain('2. `stack/wire-ui` — Wire the UI ← **this PR**')
    expect(markerIdOf(body)).toBe('i-bbbb3333')
  })
})

describe('branchNames', () => {
  it('dedupes equal titles deterministically and never loops', () => {
    const twin = { id: 'i-cccc4444', name: 'core-model', summary: 'Again', sha: '3' }
    const twin2 = { id: 'i-dddd5555', name: 'core-model', summary: 'Thrice', sha: '4' }
    const plan = planStack([stack[0], twin, twin2], [], opts)
    expect(plan.pushes.map((p) => p.branch)).toEqual([
      'stack/core-model',
      'stack/core-model-2',
      'stack/core-model-3',
    ])
    expect(plan.pushes[2].base).toBe('stack/core-model-2')
  })
})

describe('branchNameFor', () => {
  it('slugs hostile names and falls back to the change id', () => {
    expect(branchNameFor({ ...stack[0], name: 'Wéird Name!' }, 'stack/')).toBe('stack/w-ird-name')
    expect(branchNameFor({ ...stack[0], name: '###' }, 'stack/')).toBe('stack/i-aaaa2222')
  })
})
