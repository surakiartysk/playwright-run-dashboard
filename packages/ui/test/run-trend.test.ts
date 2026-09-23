import { describe, expect, it } from 'vitest'
import {
  trendPoints,
  MAX_TREND_POINTS,
  bars,
  describe as describeBar,
  domain,
  PLOT_WIDTH,
  PLOT_HEIGHT,
} from '../src/components/RunTrend'
import type { Run, RunStatus } from '../src/api'
import { resultShares } from '../src/components/RunHistory'
import { point, run as fixture } from './fixtures'

/**
 * The two things a trend chart gets silently wrong.
 *
 * **Direction.** The API returns newest first and a chart reads left to right,
 * so the list has to be reversed. Get it backwards and the chart is not
 * broken — it is *inverted*, which reads as a suite recovering when it is
 * degrading. Nothing about the rendering would look wrong.
 *
 * **Division.** Laying bars out divides the width by the number of runs, and
 * the range by its own height — both of which a real list can make zero: one
 * run, or a dozen runs all at the same rate.
 */

const run = (
  status: RunStatus,
  { total = 10, passed = 10, id = Math.random().toString(36).slice(2, 8) } = {},
): Run => fixture({ status, total, passed, id })

describe('trendPoints', () => {
  /**
   * The assertion that catches an inverted chart. Given newest-first input,
   * the oldest run must come out first.
   */
  it('reverses the list, because the API is newest-first and a chart is not', () => {
    const points = trendPoints([
      run('passed', { id: 'newest', passed: 10 }),
      run('failed', { id: 'middle', passed: 5 }),
      run('passed', { id: 'oldest', passed: 8 }),
    ])

    expect(points.map((p) => p.id)).toEqual(['oldest', 'middle', 'newest'])
  })

  /**
   * The chart used to take every loaded run, and "Load more" has no end: at a
   * hundred and more the minimum bar width stops fitting and bars overlap.
   * The newest are kept, because they are what "the trend" is about.
   */
  it('keeps only the newest MAX_TREND_POINTS runs', () => {
    const newestFirst = Array.from({ length: MAX_TREND_POINTS + 20 }, (_, i) =>
      run('passed', { id: `run-${i}` }),
    )

    const points = trendPoints(newestFirst)

    expect(points).toHaveLength(MAX_TREND_POINTS)
    expect(points.at(-1)!.id).toBe('run-0')
    expect(points[0]!.id).toBe(`run-${MAX_TREND_POINTS - 1}`)
  })

  it('computes the rate from a run own totals', () => {
    const points = trendPoints([run('failed', { total: 20, passed: 15 })])
    expect(points[0]!.rate).toBe(75)
  })

  /**
   * A queued run has not failed; plotting it at zero puts a cliff in the chart
   * that disappears a few seconds later.
   */
  it('excludes runs still in flight rather than plotting them at zero', () => {
    const points = trendPoints([run('queued'), run('running'), run('passed')])

    expect(points).toHaveLength(1)
    expect(points[0]!.rate).toBe(100)
  })

  it('excludes runs that reported no totals, rather than dividing by zero', () => {
    const withNoTotal = { ...run('passed'), total: null, passed: null }
    const points = trendPoints([withNoTotal, run('passed')])

    expect(points).toHaveLength(1)
    expect(points.every((p) => Number.isFinite(p.rate))).toBe(true)
  })

  it('excludes a run reporting zero tests', () => {
    expect(trendPoints([run('passed', { total: 0, passed: 0 })])).toEqual([])
  })

  // Not only the colour: a failed run's bar is drawn at full opacity behind a
  // full-height wash, because green and red are the pair colour-vision
  // deficiency flattens.
  it('marks each point with whether that run passed, for how the bar is drawn', () => {
    const points = trendPoints([run('failed', { passed: 9 }), run('passed')])
    expect(points.map((p) => p.passed)).toEqual([true, false])
  })
})

describe('bars', () => {
  it('lays one bar per run, evenly spaced and inside the plot', () => {
    const boxes = bars(trendPoints([run('passed'), run('passed'), run('passed')]))

    expect(boxes).toHaveLength(3)
    // Evenly spaced: the gap between consecutive left edges is constant.
    const gaps = boxes.slice(1).map((b, i) => +(b.x - boxes[i]!.x).toFixed(6))
    expect(new Set(gaps).size).toBe(1)
    // Nothing is drawn outside the box — the failure the old stretched
    // viewBox papered over with `overflow: visible`.
    expect(boxes.every((b) => b.x >= 0 && b.x + b.width <= PLOT_WIDTH + 0.001)).toBe(true)
    expect(boxes.every((b) => b.y >= 0 && b.y + b.height <= PLOT_HEIGHT + 0.001)).toBe(true)
  })

  it('draws a single run without dividing by zero', () => {
    const boxes = bars(trendPoints([run('passed')]))

    expect(boxes).toHaveLength(1)
    expect(Number.isFinite(boxes[0]!.x)).toBe(true)
    expect(Number.isFinite(boxes[0]!.height)).toBe(true)
  })

  /**
   * SVG y grows downward and a bar hangs from its top edge, so a better run
   * must be both taller and higher. Getting this backwards flips the chart —
   * not visibly broken, just wrong.
   */
  it('makes a better run taller, and grows it upward from the floor', () => {
    const boxes = bars([
      point({ rate: 100, passed: true, id: 'best' }),
      point({ rate: 0, passed: false, id: 'worst' }),
    ])

    expect(boxes[0]!.height).toBeGreaterThan(boxes[1]!.height)
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y)
    // Every bar sits on the same floor.
    expect(boxes[0]!.y + boxes[0]!.height).toBeCloseTo(PLOT_HEIGHT, 5)
    expect(boxes[1]!.y + boxes[1]!.height).toBeCloseTo(PLOT_HEIGHT, 5)
  })

  it('handles an empty list', () => {
    expect(bars([])).toEqual([])
  })

  /**
   * The reason the axis is not fixed at 0–100: a healthy suite lives in the
   * top few percent, and on a full-scale axis every bar is the same height
   * with the differences between them invisible.
   */
  it('spreads a narrow band of high rates across the full height', () => {
    const boxes = bars([
      point({ rate: 100, passed: true, id: 'a' }),
      point({ rate: 97, passed: false, id: 'b' }),
    ])

    // On a fixed 0–100 axis these would differ by 3% of the height.
    expect(boxes[0]!.height - boxes[1]!.height).toBeGreaterThan(PLOT_HEIGHT * 0.2)
  })

  it('does not divide by zero when every run has the same rate', () => {
    const boxes = bars([
      point({ rate: 100, passed: true, id: 'a' }),
      point({ rate: 100, passed: true, id: 'b' }),
    ])

    expect(boxes.every((b) => Number.isFinite(b.height))).toBe(true)
  })

  /**
   * A run sitting exactly on the bottom of the drawn range maps to zero height
   * and vanishes — so the run that failed hardest, the one most worth seeing,
   * is the one that disappears.
   *
   * `domain` pads the range, so reaching the true floor takes a spread wide
   * enough that the padding is clamped away at both ends: 0 and 100 do it,
   * because neither can be padded past the limits of a percentage.
   */
  it('still draws a run sitting on the floor of the range', () => {
    const boxes = bars([
      point({ rate: 100, passed: true, id: 'top' }),
      point({ rate: 0, passed: false, id: 'floor' }),
    ])

    const { min } = domain([
      point({ rate: 100, passed: true, id: 'top' }),
      point({ rate: 0, passed: false, id: 'floor' }),
    ])
    // Confirms this test is exercising the floor rather than a padded value.
    expect(min).toBe(0)
    expect(boxes[1]!.height).toBeGreaterThan(0)
  })

  /**
   * Many runs must not thin the bars into invisible hairlines.
   *
   * Reachable in practice: a page holds up to 100 runs and the reader can load
   * more than one page, at which point the natural width drops below 2 units
   * and the chart becomes a grey smear. 150 is past where the floor engages —
   * a smaller count would pass whether or not the guard existed.
   */
  it('keeps a usable bar width when there are many runs', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      point({ rate: 90 + (i % 10), passed: true, id: `r${i}` }),
    )

    // Without the floor these would be ~1.6 units wide.
    expect(PLOT_WIDTH / many.length).toBeLessThan(3)

    const boxes = bars(many)
    expect(boxes).toHaveLength(150)
    expect(boxes.every((b) => b.width >= 3)).toBe(true)
  })
})

describe('domain', () => {
  it('never claims a rate above 100 or below 0', () => {
    const { min, max } = domain([
      point({ rate: 100, passed: true, id: 'a' }),
      point({ rate: 0, passed: false, id: 'b' }),
    ])

    expect(max).toBeLessThanOrEqual(100)
    expect(min).toBeGreaterThanOrEqual(0)
  })

  /**
   * Without a floor, three runs at 99, 100 and 99.5 would fill the panel and
   * read as violent swings — a half-point wobble drawn as a collapse.
   */
  it('keeps a minimum window, so a tiny wobble does not fill the chart', () => {
    const { min, max } = domain([
      point({ rate: 100, passed: true, id: 'a' }),
      point({ rate: 99.5, passed: true, id: 'b' }),
    ])

    expect(max - min).toBeGreaterThanOrEqual(10)
  })

  it('widens to fit a genuinely large spread', () => {
    const { min, max } = domain([
      point({ rate: 100, passed: true, id: 'a' }),
      point({ rate: 20, passed: false, id: 'b' }),
    ])

    expect(min).toBeLessThan(20)
    expect(max).toBe(100)
  })

  it('falls back to the full range for an empty list', () => {
    expect(domain([])).toEqual({ min: 0, max: 100 })
  })
})

describe('describe — what one bar says', () => {
  const point = {
    rate: 90,
    passed: false,
    id: '20260907-1200-items-abc123',
    suite: 'api' as const,
    service: 'items',
    startedBy: null,
    tags: 'smoke',
    ref: 'main',
    triggeredBy: 'qa',
    passedCount: 9,
    failed: 1,
    total: 10,
    startedAt: new Date().toISOString(),
  }

  it('names the run, not just its percentage', () => {
    const text = describeBar(point)
    // The whole reason this exists: a reader who spots the red bar should not
    // have to go hunting through the table to find out which run it was.
    expect(text).toContain('items')
    expect(text).toContain('@smoke')
    expect(text).toContain('main')
  })

  it('says who started it', () => {
    expect(describeBar(point)).toContain('by qa')
  })

  /*
   * The suite, because the table row shows a badge for it.
   *
   * This chart was written when there was one suite and kept saying so after
   * a second arrived: a red bar could belong to either, and the row it is
   * supposed to agree with had a badge the bar did not.
   *
   * Asserted on the label a reader sees rather than the stored value, because
   * `SUITE_LABELS[undefined]` is `undefined` and renders as the string
   * "undefined" in the tooltip — silently, since nothing about a hover layer
   * looks wrong when it goes wrong. Verified able to fail: dropping `suite`
   * from `describe` leaves this red and every other test here green.
   */
  it('names the suite, so a red bar is attributable to one', () => {
    expect(describeBar(point)).toContain('API')
    expect(describeBar({ ...point, suite: 'ui' as const })).toContain('UI')
    expect(describeBar(point)).not.toContain('undefined')
  })

  it('counts the failures rather than leaving the reader to subtract', () => {
    expect(describeBar(point)).toContain('9/10')
    expect(describeBar(point)).toContain('1 failed')
  })

  it('does not claim failures on a passing run', () => {
    const green = { ...point, passed: true, passedCount: 10, total: 10, failed: 0 }
    expect(describeBar(green)).toContain('10/10 passed')
    expect(describeBar(green)).not.toContain('failed')
  })

  /*
   * The count this once got wrong, and the reason the field exists.
   *
   * A failure count derived as `total - passed` counts every skipped test as a
   * failure. The table row does not — `resultShares` gives them a bucket of
   * their own — so one run rendered `1 failed` in the table and `3 failed` in
   * the tooltip of its own bar, which is exactly what the comment above
   * `describe` says can never happen.
   *
   * Verified able to fail: restoring `point.total - point.passedCount` in
   * `describe` leaves this red — `expected '… 3 failed …' to contain '1
   * failed'` — and every other test in this file green.
   */
  it('counts the failures the run reported, not the tests that did not pass', () => {
    // Ten tests: seven passed, one failed, two skipped.
    const skipped = { ...point, passed: false, passedCount: 7, failed: 1, total: 10 }

    expect(describeBar(skipped)).toContain('7/10 — 1 failed')
    expect(describeBar(skipped)).not.toContain('3 failed')
  })

  /*
   * The same invariant stated against the table itself rather than a number
   * typed twice: whatever the row calls a failure, the bar must call one too.
   *
   * `resultShares` is the arithmetic behind the row's bar, so a change to
   * either side that makes them disagree fails here. Verified able to fail:
   * with the derived count restored, this reads `expected 3 to be 1`.
   */
  it('agrees with the table row about how many tests failed', () => {
    const r = fixture({ status: 'failed', total: 10, passed: 7, failed: 1 })
    const share = resultShares(r)

    // The row's own bar: 70% green, 10% red, 20% neither.
    expect(share).toEqual({ passed: 70, failed: 10, other: 20 })

    const bar = describeBar(trendPoints([r])[0]!)
    const claimed = Number(/(\d+) failed/.exec(bar)![1])
    expect(claimed).toBe((share.failed / 100) * (r.total ?? 0))
  })

  /*
   * A run can end badly with nothing failing — a timeout, or a callback that
   * sent totals but no failure count. The row prints `7 / 10` and stops; so
   * does this. Verified able to fail: making the empty branch read
   * `${ratio} — ${point.failed} failed` leaves this red on `not.toContain`.
   */
  it('says nothing about failures when the run reported none', () => {
    const timedOut = { ...point, passed: false, passedCount: 7, failed: 0, total: 10 }

    expect(describeBar(timedOut)).toContain('7/10')
    expect(describeBar(timedOut)).not.toContain('failed')
  })
})
