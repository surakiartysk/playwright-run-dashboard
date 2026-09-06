import { describe, expect, it } from 'vitest'
import { trendPoints, bars, domain, PLOT_WIDTH, PLOT_HEIGHT } from '../src/components/RunTrend'
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

  // Not only the colour: a failed point is drawn larger and ringed, because
  // green and red are the pair colour-vision deficiency flattens.
  it('marks each point with whether that run passed, for how the dot is drawn', () => {
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
      { rate: 100, passed: true, id: 'best' },
      { rate: 0, passed: false, id: 'worst' },
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
      { rate: 100, passed: true, id: 'a' },
      { rate: 97, passed: false, id: 'b' },
    ])

    // On a fixed 0–100 axis these would differ by 3% of the height.
    expect(boxes[0]!.height - boxes[1]!.height).toBeGreaterThan(PLOT_HEIGHT * 0.2)
  })

  it('does not divide by zero when every run has the same rate', () => {
    const boxes = bars([
      { rate: 100, passed: true, id: 'a' },
      { rate: 100, passed: true, id: 'b' },
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
      { rate: 100, passed: true, id: 'top' },
      { rate: 0, passed: false, id: 'floor' },
    ])

    const { min } = domain([
      { rate: 100, passed: true, id: 'top' },
      { rate: 0, passed: false, id: 'floor' },
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
    const many = Array.from({ length: 150 }, (_, i) => ({
      rate: 90 + (i % 10),
      passed: true,
      id: `r${i}`,
    }))

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
