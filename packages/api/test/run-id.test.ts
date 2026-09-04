import { describe, expect, it } from 'vitest'
import { makeRunId, randomSuffix } from '../src/routes/runs'

/**
 * The run id is the PRIMARY KEY, an R2 prefix, and the thing a person reads off
 * a screen and quotes back. Each of those puts a different constraint on it,
 * and none of them announces itself when broken: a collision surfaces as a 500
 * for whoever pressed Run second, and an ambiguous character surfaces as a
 * search that finds nothing.
 */

describe('the random suffix', () => {
  it('is the requested length', () => {
    expect(randomSuffix()).toHaveLength(6)
    expect(randomSuffix(4)).toHaveLength(4)
  })

  /**
   * Crockford's alphabet, and the reason for it: `I`/`L` against `1`, and
   * `O` against `0`, are the pairs a person transcribing an id gets wrong.
   * Excluding them means a misread id does not silently become a valid
   * different one.
   */
  it('never emits a character that can be misread for another', () => {
    const suffixes = Array.from({ length: 400 }, () => randomSuffix()).join('')

    expect(suffixes).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]+$/)
    expect(suffixes).not.toMatch(/[ilou]/)
  })

  /**
   * The property that matters — two calls must not agree.
   *
   * 400 draws from 32^6 collide with probability around 1 in 13,000, so this
   * is not flaky in any practical sense; it would fail immediately for the
   * failure that matters, which is a generator returning a constant.
   */
  it('does not repeat itself', () => {
    const drawn = new Set(Array.from({ length: 400 }, () => randomSuffix()))

    expect(drawn.size).toBe(400)
  })

  /**
   * Uniformity, loosely. A generator biased to a corner of the alphabet still
   * passes every test above while quietly shrinking the space a collision has
   * to avoid. 400 draws of six characters is 2,400 symbols over 32 values —
   * 75 expected each — so requiring at least 20 distinct values is far below
   * any real distribution and far above a broken one.
   */
  it('spreads across the alphabet rather than favouring a corner', () => {
    const symbols = new Set(Array.from({ length: 400 }, () => randomSuffix()).join(''))

    expect(symbols.size).toBeGreaterThan(20)
  })
})

describe('the run id', () => {
  it('is sortable, readable, and carries what it covered', () => {
    const id = makeRunId('items')

    // YYYYMMDD-HHMM-<service>-<suffix>
    expect(id).toMatch(/^\d{8}-\d{4}-items-[0-9abcdefghjkmnpqrstvwxyz]{6}$/)
  })

  /**
   * The case the suffix exists for: two people running the same service in the
   * same minute. Without it both ids are identical and the second INSERT fails
   * on the primary key.
   */
  it('differs for two runs of the same service in the same minute', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeRunId('items')))

    expect(ids.size).toBe(200)
  })

  /**
   * Lexicographic order has to match chronological order, because the run list
   * is ordered by `started_at` but R2 keys are listed by prefix — and a prefix
   * that sorts differently from the rows makes a listing impossible to line up
   * with the history it belongs to.
   */
  it('sorts lexicographically in the same order as time', () => {
    const early = '20260101-0900-items-aaaaaa'
    const later = '20260101-1000-items-000000'

    expect([later, early].sort()).toEqual([early, later])
  })
})
