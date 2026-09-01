import { describe, expect, it } from 'vitest'
import {
  branchNameFor,
  changeNeeds,
  markerIdOf,
  planStack,
  prBody,
  stackMarker,
} from './stackplan'

const stack = [
  { id: 'i-aaaa2222', name: 'core-model', summary: 'Core model', sha: '1111111' },
  {
    id: 'i-bbbb3333',
    name: 'wire-ui',
    summary: 'Wire the UI',
    sha: '2222222',
    description: 'Long form.',
    needs: ['i-aaaa2222'],
  },
]
const opts = { trunk: 'main', prefix: 'stack/' }

describe('planStack (forest)', () => {
  it('bases a change on its single dependency, the root on the trunk', () => {
    const plan = planStack(stack, [], opts)
    expect(plan.pushes.map((p) => [p.branch, p.base])).toEqual([
      ['stack/core-model', 'main'],
      ['stack/wire-ui', 'stack/core-model'],
    ])
    expect(plan.actions.every((a) => a.kind === 'create')).toBe(true)
  })

  it('submits independent changes as parallel roots on the trunk', () => {
    const free = [
      { id: 'i-aaaa2222', name: 'one', summary: 'One', sha: '1' },
      { id: 'i-bbbb3333', name: 'two', summary: 'Two', sha: '2' },
    ]
    const plan = planStack(free, [], opts)
    expect(plan.pushes.map((p) => p.base)).toEqual(['main', 'main'])
  })

  it('lets siblings share a base — a tree of PRs', () => {
    const tree = [
      { id: 'i-aaaa2222', name: 'root', summary: 'Root', sha: '1' },
      { id: 'i-bbbb3333', name: 'left', summary: 'Left', sha: '2', needs: ['i-aaaa2222'] },
      { id: 'i-cccc4444', name: 'right', summary: 'Right', sha: '3', needs: ['i-aaaa2222'] },
    ]
    const plan = planStack(tree, [], opts)
    expect(plan.pushes.map((p) => p.base)).toEqual(['main', 'stack/root', 'stack/root'])
    // Sibling histories share the root prefix but never each other.
    expect(plan.pushes.map((p) => p.history)).toEqual([
      ['i-aaaa2222'],
      ['i-aaaa2222', 'i-bbbb3333'],
      ['i-aaaa2222', 'i-cccc4444'],
    ])
  })

  it('degrades a diamond component to a chain in landing order', () => {
    const diamond = [
      { id: 'i-aaaa2222', name: 'a', summary: 'A', sha: '1' },
      { id: 'i-bbbb3333', name: 'b', summary: 'B', sha: '2', needs: ['i-aaaa2222'] },
      { id: 'i-cccc4444', name: 'c', summary: 'C', sha: '3', needs: ['i-aaaa2222'] },
      {
        id: 'i-dddd5555',
        name: 'd',
        summary: 'D',
        sha: '4',
        needs: ['i-bbbb3333', 'i-cccc4444'],
      },
    ]
    const plan = planStack(diamond, [], opts)
    expect(plan.pushes.map((p) => p.base)).toEqual(['main', 'stack/a', 'stack/b', 'stack/c'])
  })

  it('keeps an independent change parallel beside a degraded diamond', () => {
    const mixed = [
      { id: 'i-aaaa2222', name: 'a', summary: 'A', sha: '1' },
      { id: 'i-eeee6666', name: 'solo', summary: 'Solo', sha: '5' },
      { id: 'i-bbbb3333', name: 'b', summary: 'B', sha: '2', needs: ['i-aaaa2222'] },
      { id: 'i-cccc4444', name: 'c', summary: 'C', sha: '3', needs: ['i-aaaa2222'] },
      {
        id: 'i-dddd5555',
        name: 'd',
        summary: 'D',
        sha: '4',
        needs: ['i-bbbb3333', 'i-cccc4444'],
      },
    ]
    const plan = planStack(mixed, [], opts)
    expect(plan.pushes.map((p) => p.history)).toEqual([
      ['i-aaaa2222'],
      ['i-eeee6666'],
      ['i-aaaa2222', 'i-bbbb3333'],
      ['i-aaaa2222', 'i-bbbb3333', 'i-cccc4444'],
      ['i-aaaa2222', 'i-bbbb3333', 'i-cccc4444', 'i-dddd5555'],
    ])
    // The solo change never enters the diamond's chain.
    expect(plan.pushes.map((p) => [p.branch, p.base])).toEqual([
      ['stack/a', 'main'],
      ['stack/solo', 'main'],
      ['stack/b', 'stack/a'],
      ['stack/c', 'stack/b'],
      ['stack/d', 'stack/c'],
    ])
  })

  it('ignores forward and out-of-stack needs instead of trusting them', () => {
    const weird = [
      { id: 'i-aaaa2222', name: 'a', summary: 'A', sha: '1', needs: ['i-bbbb3333'] },
      { id: 'i-bbbb3333', name: 'b', summary: 'B', sha: '2', needs: ['i-gone0000'] },
    ]
    const plan = planStack(weird, [], opts)
    expect(plan.pushes.map((p) => p.base)).toEqual(['main', 'main'])
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

  it('retargets a matched PR when its change turns independent', () => {
    // Yesterday b chained on a; today's reorganize dissolved the dep.
    const now = [
      { id: 'i-aaaa2222', name: 'core-model', summary: 'Core model', sha: '1' },
      { id: 'i-bbbb3333', name: 'wire-ui', summary: 'Wire the UI', sha: '2' },
    ]
    const prB = {
      number: 8,
      headRefName: 'stack/wire-ui',
      baseRefName: 'stack/core-model',
      body: stackMarker('i-bbbb3333'),
    }
    const plan = planStack(now, [prB], opts)
    const b = plan.actions[1]
    expect(b.kind === 'update' && b.retarget).toBe('main')
  })

  it('converges a same-title reorder without retargeting a PR onto its own head', () => {
    const a = { id: 'i-aaaa2222', name: 'core-model', summary: 'First', sha: '1' }
    const b = {
      id: 'i-bbbb3333',
      name: 'core-model',
      summary: 'Second',
      sha: '2',
      needs: ['i-aaaa2222'],
    }
    const prA = {
      number: 10,
      headRefName: 'stack/core-model',
      baseRefName: 'main',
      body: stackMarker(a.id),
    }
    const prB = {
      number: 11,
      headRefName: 'stack/core-model-2',
      baseRefName: 'stack/core-model',
      body: stackMarker(b.id),
    }
    // b still needs a; the stack merely lists them in a new order — bases
    // must follow the dep, not the listing.
    const plan = planStack([a, b], [prA, prB], opts)
    expect(plan.pushes.map((p) => [p.branch, p.base])).toEqual([
      ['stack/core-model', 'main'],
      ['stack/core-model-2', 'stack/core-model'],
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

describe('changeNeeds', () => {
  it('lifts hunk deps to change ids, dropping intra-change and unknown pairs', () => {
    const needs = changeNeeds(
      [
        { change_id: 'i-aaaa2222', hunks: ['f:1#a', 'f:5#b'] },
        { change_id: 'i-bbbb3333', hunks: ['f:9#c'] },
      ],
      [
        ['f:9#c', 'f:1#a'],
        ['f:9#c', 'f:5#b'],
        ['f:5#b', 'f:1#a'],
        ['f:9#c', 'gone:1#x'],
      ],
    )
    expect(needs.get('i-bbbb3333')).toEqual(['i-aaaa2222'])
    expect(needs.get('i-aaaa2222')).toEqual([])
  })
})

describe('prBody', () => {
  const names = ['stack/core-model', 'stack/wire-ui']
  const bases = ['main', 'stack/core-model']

  it('carries description, the based-on table with a this-PR marker, and the identity', () => {
    const body = prBody(stack[1], stack, names, bases)
    expect(body).toContain('Long form.')
    expect(body).toContain('1. `stack/core-model` ← `main` — Core model')
    expect(body).toContain('2. `stack/wire-ui` ← `stack/core-model` — Wire the UI ← **this PR**')
    expect(markerIdOf(body)).toBe('i-bbbb3333')
  })

  it('cannot be identity-hijacked by a stale marker quoted in the description', () => {
    const poisoned = {
      ...stack[1],
      description: `quoting an old PR:\n${stackMarker('i-stale000')}\nend quote`,
    }
    const body = prBody(poisoned, stack, names, bases)
    expect(markerIdOf(body)).toBe('i-bbbb3333')
  })
})

describe('branchNames', () => {
  it('dedupes equal titles deterministically and never loops', () => {
    const twin = { id: 'i-cccc4444', name: 'core-model', summary: 'Again', sha: '3' }
    const twin2 = { id: 'i-dddd5555', name: 'core-model', summary: 'Thrice', sha: '4' }
    const plan = planStack([{ ...stack[0] }, twin, twin2], [], opts)
    expect(plan.pushes.map((p) => p.branch)).toEqual([
      'stack/core-model',
      'stack/core-model-2',
      'stack/core-model-3',
    ])
    // All three are independent — parallel roots, not a chain.
    expect(plan.pushes.map((p) => p.base)).toEqual(['main', 'main', 'main'])
  })
})

describe('branchNameFor', () => {
  it('slugs hostile names and falls back to the change id', () => {
    expect(branchNameFor({ ...stack[0], name: 'Wéird Name!' }, 'stack/')).toBe('stack/w-ird-name')
    expect(branchNameFor({ ...stack[0], name: '###' }, 'stack/')).toBe('stack/i-aaaa2222')
  })
})
