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

  it('matches by marker id and keeps pushing to the immutable PR head', () => {
    const pr = {
      number: 7,
      headRefName: 'stack/old-name',
      baseRefName: 'main',
      body: `whatever\n${stackMarker('i-bbbb3333')}`,
    }
    const plan = planStack(stack, [pr], opts)
    const update = plan.actions[1]
    expect(update.kind).toBe('update')
    // GitHub cannot move a PR to a new head branch — the push must target
    // the existing head even though the change was renamed since.
    expect(update.push.branch).toBe('stack/old-name')
    if (update.kind === 'update') {
      expect(update.number).toBe(7)
      expect(update.retarget).toBe('stack/core-model')
    }
  })

  it('converges a same-title reorder without retargeting a PR onto its own head', () => {
    const a = { id: 'i-aaaa2222', name: 'core-model', summary: 'First', sha: '1' }
    const b = { id: 'i-bbbb3333', name: 'core-model', summary: 'Second', sha: '2' }
    const prA = { number: 10, headRefName: 'stack/core-model', baseRefName: 'main', body: stackMarker(a.id) }
    const prB = { number: 11, headRefName: 'stack/core-model-2', baseRefName: 'stack/core-model', body: stackMarker(b.id) }
    // Reordered: b now sits at the bottom.
    const plan = planStack([b, a], [prA, prB], opts)
    expect(plan.pushes.map((p) => [p.branch, p.base])).toEqual([
      ['stack/core-model-2', 'main'],
      ['stack/core-model', 'stack/core-model-2'],
    ])
    for (const act of plan.actions) {
      if (act.kind === 'update') expect(act.retarget).not.toBe(act.push.branch)
    }
  })

  it('keeps the lowest PR number on duplicate markers and orphans the rest', () => {
    const lo = { number: 3, headRefName: 'stack/x', baseRefName: 'main', body: stackMarker('i-aaaa2222') }
    const hi = { number: 9, headRefName: 'stack/y', baseRefName: 'main', body: stackMarker('i-aaaa2222') }
    const plan = planStack(stack, [hi, lo], opts)
    const a0 = plan.actions[0]
    expect(a0.kind === 'update' && a0.number).toBe(3)
    expect(plan.orphans).toContain(hi)
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
  const names = ['stack/core-model', 'stack/wire-ui']

  it('carries description, the stack table with a this-PR marker, and the identity', () => {
    const body = prBody(stack[1], stack, names)
    expect(body).toContain('Long form.')
    expect(body).toContain('1. `stack/core-model` — Core model')
    expect(body).toContain('2. `stack/wire-ui` — Wire the UI ← **this PR**')
    expect(markerIdOf(body)).toBe('i-bbbb3333')
  })

  it('cannot be identity-hijacked by a stale marker quoted in the description', () => {
    const poisoned = {
      ...stack[1],
      description: `quoting an old PR:\n${stackMarker('i-stale000')}\nend quote`,
    }
    const body = prBody(poisoned, stack, names)
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
