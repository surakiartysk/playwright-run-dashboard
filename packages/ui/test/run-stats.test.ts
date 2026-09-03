import { describe, expect, it } from 'vitest'
import { summarise } from '../src/components/RunStats'
import type { Run, RunStatus } from '../src/api'

/**
 * The arithmetic behind the summary bar.
 *
 * Still no component test — the bar arranges styled divs. What can be *wrong*
 * is the maths: a rate that divides by runs still in flight, a median that
 * picks the wrong element on an even-length list, and every one of those
 * dividing by a total that is legitimately zero on a fresh dashboard.
 *
 * A summary that disagrees with the list beneath it is worse than no summary,
 * so these assert the exact numbers rather than that something was returned.
 */

const run = (status: RunStatus, durationMs: number | null = 1000): Run => ({
  id: `run-${Math.random().toString(36).slice(2, 8)}`,
  service: 'items',
  tags: 'smoke',
  workers: null,
  triggeredBy: 'demo',
  status,
  ref: 'main',
  total: 10,
  passed: status === 'passed' ? 10 : 9,
  failed: status === 'passed' ? 0 : 1,
  startedAt: '2026-01-01T12:00:00Z',
  finishedAt: null,
  durationMs,
  reportUrl: null,
  workflowUrl: null,
})

describe('summarise', () => {
  it('returns nulls rather than NaN for an empty list', () => {
    expect(summarise([])).toEqual({
      total: 0,
      finished: 0,
      inFlight: 0,
      failing: 0,
      rate: null,
      median: null,
    })
  })

  /**
   * The division that matters: a run still queued has not passed *or* failed,
   * so counting it in the denominator would report 50% for one green run and
   * one that has not started — a number that drops as work begins.
   */
  it('excludes in-flight runs from the pass rate', () => {
    const summary = summarise([run('passed'), run('queued'), run('running')])

    expect(summary.rate).toBe(100)
    expect(summary.finished).toBe(1)
    expect(summary.inFlight).toBe(2)
  })

  it('counts runs, not tests, so a big run cannot bury a small red one', () => {
    // Both runs report ten tests each; one failed. Counted by tests that is
    // 19/20 = 95%, and by runs it is one in two.
    const summary = summarise([run('passed'), run('failed')])

    expect(summary.rate).toBe(50)
    expect(summary.failing).toBe(1)
  })

  it('treats error and timeout as failing, not as pending', () => {
    const summary = summarise([run('passed'), run('error'), run('timeout')])

    expect(summary.finished).toBe(3)
    expect(summary.inFlight).toBe(0)
    expect(summary.failing).toBe(2)
    expect(summary.rate).toBe(33)
  })

  it('reports no rate while everything is still running', () => {
    const summary = summarise([run('queued'), run('running')])

    expect(summary.rate).toBeNull()
    expect(summary.median).toBeNull()
  })

  describe('median', () => {
    it('picks the middle of an odd-length list', () => {
      const summary = summarise([run('passed', 1000), run('passed', 5000), run('passed', 3000)])
      expect(summary.median).toBe(3000)
    })

    /**
     * The off-by-one lives here: an even-length list has no middle element,
     * and taking `sorted[middle]` alone silently biases every even list high.
     */
    it('averages the two middle values of an even-length list', () => {
      const summary = summarise([run('passed', 1000), run('passed', 2000)])
      expect(summary.median).toBe(1500)
    })

    /**
     * The reason for a median at all: one run that hung must not move the
     * number a reader uses to answer "how long will mine take".
     */
    it('is not dragged by a single outlier the way a mean would be', () => {
      const summary = summarise([
        run('passed', 1000),
        run('passed', 1000),
        run('passed', 1000),
        run('timeout', 600_000),
      ])

      // The mean here is over 150s; the median stays where the runs actually are.
      expect(summary.median).toBe(1000)
    })

    it('ignores runs that recorded no duration', () => {
      const summary = summarise([run('passed', null), run('passed', 4000)])
      expect(summary.median).toBe(4000)
    })
  })
})
