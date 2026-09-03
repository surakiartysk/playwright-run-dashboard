import { describe, expect, it } from 'vitest'
import { trendPoints, plot, domain } from '../src/components/RunTrend'
import type { Run, RunStatus } from '../src/api'

/**
 * The two things a trend chart gets silently wrong.
 *
 * **Direction.** The API returns newest first and a chart reads left to right,
 * so the list has to be reversed. Get it backwards and the chart is not
 * broken — it is *inverted*, which reads as a suite recovering when it is
 * degrading. Nothing about the rendering would look wrong.
 *
 * **Division.** Spacing n points across a width divides by `n - 1`, which is
 * zero when a single run qualifies.
 */

const run = (
  status: RunStatus,
  { total = 10, passed = 10, id = Math.random().toString(36).slice(2, 8) } = {},
): Run => ({
  id,
  service: 'items',
  tags: 'smoke',
  workers: null,
  triggeredBy: 'demo',
  status,
  ref: 'main',
  total,
  passed,
  failed: total - passed,
  startedAt: '2026-01-01T12:00:00Z',
  finishedAt: null,
  durationMs: 1000,
  reportUrl: null,
  workflowUrl: null,
})

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

  it('marks each point with whether that run passed, for the dot colour', () => {
    const points = trendPoints([run('failed', { passed: 9 }), run('passed')])
    expect(points.map((p) => p.passed)).toEqual([true, false])
  })
})

describe('plot', () => {
  it('spreads points evenly across the full width', () => {
    const coords = plot(trendPoints([run('passed'), run('passed'), run('passed')]))
    expect(coords.map((p) => p.x)).toEqual([0, 50, 100])
  })

  /** `n - 1` is zero here; without a guard every coordinate is NaN. */
  it('centres a single point instead of dividing by zero', () => {
    const coords = plot(trendPoints([run('passed')]))

    expect(coords).toHaveLength(1)
    expect(coords[0]!.x).toBe(50)
    expect(Number.isNaN(coords[0]!.x)).toBe(false)
  })

  /**
   * SVG y grows downward, so the highest rate must sit nearest the top.
   * Getting this backwards flips the chart vertically — again, not visibly
   * broken, just wrong.
   */
  it('inverts y, so the best run is at the top and the worst at the bottom', () => {
    const coords = plot([
      { rate: 100, passed: true, id: 'best' },
      { rate: 0, passed: false, id: 'worst' },
    ])

    expect(coords[0]!.y).toBe(0)
    expect(coords[1]!.y).toBe(100)
  })

  it('handles an empty list', () => {
    expect(plot([])).toEqual([])
  })

  /**
   * The reason the axis is not fixed at 0–100: a healthy suite lives in the
   * top few percent, and on a full-scale axis every run lands on the top
   * border with the differences between them invisible.
   */
  it('spreads a narrow band of high rates across the full height', () => {
    const coords = plot([
      { rate: 100, passed: true, id: 'a' },
      { rate: 97, passed: false, id: 'b' },
    ])

    // On a fixed 0-100 axis these would be y=0 and y=3 — indistinguishable.
    expect(coords[0]!.y).toBeLessThan(coords[1]!.y)
    expect(coords[1]!.y - coords[0]!.y).toBeGreaterThan(20)
  })

  it('does not divide by zero when every run has the same rate', () => {
    const coords = plot([
      { rate: 100, passed: true, id: 'a' },
      { rate: 100, passed: true, id: 'b' },
    ])

    expect(coords.every((p) => Number.isFinite(p.y))).toBe(true)
  })
})

describe('domain', () => {
  it('never claims a rate above 100 or below 0', () => {
    const { min, max } = domain([
      { rate: 100, passed: true, id: 'a' },
      { rate: 0, passed: false, id: 'b' },
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
      { rate: 100, passed: true, id: 'a' },
      { rate: 99.5, passed: true, id: 'b' },
    ])

    expect(max - min).toBeGreaterThanOrEqual(10)
  })

  it('widens to fit a genuinely large spread', () => {
    const { min, max } = domain([
      { rate: 100, passed: true, id: 'a' },
      { rate: 20, passed: false, id: 'b' },
    ])

    expect(min).toBeLessThan(20)
    expect(max).toBe(100)
  })

  it('falls back to the full range for an empty list', () => {
    expect(domain([])).toEqual({ min: 0, max: 100 })
  })
})
