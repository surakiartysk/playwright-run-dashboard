import { describe, expect, it } from 'vitest'
import { MAX_FAILURES, parseDetails, sampleFailures, sanitizeFailures } from '../src/details'

/**
 * What a callback's failure list is allowed to become.
 *
 * The callback is signed, not trusted: the text in it is whatever an assertion
 * happened to say, and it is shown to whoever may read the run. Bounded, typed
 * and cut — and never a reason to refuse the totals that arrived with it.
 */

const failure = (over: Record<string, unknown> = {}) => ({
  title: 'should list items',
  file: 'items/list.spec.ts',
  line: 12,
  style: 'class-style',
  tags: ['items', 'smoke'],
  message: 'expected 200, got 500',
  ...over,
})

describe('sanitizeFailures', () => {
  it('keeps a well-formed failure as it is', () => {
    expect(sanitizeFailures([failure()], 0)).toEqual({ failures: [failure()], omitted: 0 })
  })

  it('has nothing to store when there are no failures, or no list at all', () => {
    expect(sanitizeFailures([], 0)).toBeNull()
    expect(sanitizeFailures(undefined, undefined)).toBeNull()
    expect(sanitizeFailures('not a list', 3)).toBeNull()
    expect(sanitizeFailures({ title: 'x' }, 0)).toBeNull()
  })

  it('drops an entry that says nothing, and keeps the rest', () => {
    const r = sanitizeFailures([failure({ title: '   ' }), null, 7, failure({ title: 'b' })], 0)
    expect(r?.failures.map((f) => f.title)).toEqual(['b'])
  })

  it('cuts every text to its limit', () => {
    const r = sanitizeFailures(
      [
        failure({
          title: 't'.repeat(900),
          file: 'f'.repeat(900),
          message: 'm'.repeat(900),
          style: 's'.repeat(900),
        }),
      ],
      0,
    )!.failures[0]!
    expect(r.title).toHaveLength(300)
    expect(r.file).toHaveLength(200)
    expect(r.message).toHaveLength(240)
    expect(r.style).toHaveLength(40)
  })

  /** A workflow that sends a hundred must not be able to store a hundred. */
  it('keeps twenty and counts the rest into omitted', () => {
    const many = Array.from({ length: MAX_FAILURES + 5 }, (_, i) => failure({ title: `t${i}` }))
    const r = sanitizeFailures(many, 0)!
    expect(r.failures).toHaveLength(MAX_FAILURES)
    expect(r.omitted).toBe(5)
  })

  it('adds the workflow’s own count of what it left out', () => {
    const many = Array.from({ length: MAX_FAILURES + 5 }, (_, i) => failure({ title: `t${i}` }))
    expect(sanitizeFailures(many, 40)!.omitted).toBe(45)
    expect(sanitizeFailures([failure()], 7)!.omitted).toBe(7)
  })

  it.each([-3, 1.5, 'many', null, Number.NaN])('ignores an omitted count of %j', (omitted) => {
    expect(sanitizeFailures([failure()], omitted)!.omitted).toBe(0)
  })

  it('caps an absurd omitted count rather than storing it', () => {
    expect(sanitizeFailures([failure()], 5_000_000)!.omitted).toBe(1_000_000)
  })

  it('keeps a line only when it is a positive whole number', () => {
    expect(sanitizeFailures([failure({ line: 7 })], 0)!.failures[0]).toHaveProperty('line', 7)
    for (const line of [0, -1, 2.5, '12', null]) {
      expect(
        sanitizeFailures([failure({ line })], 0)!.failures[0],
        String(line),
      ).not.toHaveProperty('line')
    }
  })

  it('keeps only tags that look like tags, and at most ten', () => {
    const r = sanitizeFailures(
      [
        failure({
          tags: ['smoke', '<script>', 'UPPER', 'a b', 5, 'items', ...'abcdefghijkl'.split('')],
        }),
      ],
      0,
    )!.failures[0]!
    expect(r.tags.slice(0, 2)).toEqual(['smoke', 'items'])
    expect(r.tags).not.toContain('<script>')
    expect(r.tags).not.toContain('UPPER')
    expect(r.tags.length).toBeLessThanOrEqual(10)
  })

  it('treats a missing tag list as none', () => {
    expect(sanitizeFailures([failure({ tags: undefined })], 0)!.failures[0]!.tags).toEqual([])
  })

  it('does not keep fields it was not told about', () => {
    const r = sanitizeFailures([failure({ secret: 'x', __proto__: { y: 1 } })], 0)!.failures[0]!
    expect(Object.keys(r).sort()).toEqual(['file', 'line', 'message', 'style', 'tags', 'title'])
  })
})

describe('parseDetails', () => {
  it('reads back what was stored', () => {
    const stored = JSON.stringify({ failures: [failure()], omitted: 2 })
    expect(parseDetails(stored)).toEqual({ failures: [failure()], omitted: 2 })
  })

  it('is null for nothing stored, and never throws on what is not JSON', () => {
    expect(parseDetails(null)).toBeNull()
    expect(parseDetails('')).toBeNull()
    expect(parseDetails('{not json')).toBeNull()
    expect(parseDetails('42')).toBeNull()
    expect(parseDetails('null')).toBeNull()
  })

  it('applies the same limits to a row written by something else', () => {
    const stored = JSON.stringify({ failures: [failure({ message: 'm'.repeat(900) })], omitted: 0 })
    expect(parseDetails(stored)!.failures[0]!.message).toHaveLength(240)
  })
})

describe('sampleFailures', () => {
  it('gives as many as the run failed, up to what it has', () => {
    expect(sampleFailures('api', 2)!.failures).toHaveLength(2)
    expect(sampleFailures('ui', 3)!.failures).toHaveLength(3)
  })

  it('counts the rest as omitted rather than inventing more', () => {
    const r = sampleFailures('api', 8)!
    expect(r.failures).toHaveLength(3)
    expect(r.omitted).toBe(5)
  })

  it('has nothing to say for a run that failed nothing', () => {
    expect(sampleFailures('api', 0)).toBeNull()
  })

  it('draws from each suite’s own vocabulary and names the style that ran it', () => {
    expect(sampleFailures('api', 1)!.failures[0]!.style).toBe('functional-style')
    expect(sampleFailures('ui', 1)!.failures[0]!.style).toBe('locator-first')
    expect(sampleFailures('ui', 3)!.failures.every((f) => f.file.endsWith('.spec.ts'))).toBe(true)
  })

  it('produces failures that survive the same sanitising as a real callback', () => {
    for (const suite of ['api', 'ui'] as const) {
      const sample = sampleFailures(suite, 3)!
      expect(sanitizeFailures(sample.failures, sample.omitted)).toEqual(sample)
    }
  })
})
