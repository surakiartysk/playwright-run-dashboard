import { describe, expect, it } from 'vitest'
import { coverage, ringBackground, summarise } from '../src/components/RunStats'
import { COMPACT_BELOW, WIDE_FROM, WIDE_QUERY } from '../src/use-compact'
import { status as sc } from '../src/theme'
import type { Run, RunStatus } from '../src/api'
import { run as fixture } from './fixtures'

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

const run = (status: RunStatus, durationMs: number | null = 1000): Run =>
  fixture({ status, durationMs })

describe('summarise', () => {
  it('returns nulls rather than NaN for an empty list', () => {
    expect(summarise([])).toEqual({
      available: 0,
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

  /**
   * "Runs" is read as how many runs there are, and the list beneath already
   * says "Showing 25 of 140". Counting only the loaded page put a 25 above
   * that sentence.
   */
  describe('available', () => {
    it('is every run the caller may see, not the number loaded', () => {
      const summary = summarise([run('passed'), run('failed')], 140)
      expect(summary.available).toBe(140)
      expect(summary.total).toBe(2)
    })

    it('defaults to the loaded runs when nothing more is known', () => {
      expect(summarise([run('passed'), run('failed')]).available).toBe(2)
    })

    it('is never fewer than the runs on screen', () => {
      expect(summarise([run('passed'), run('failed'), run('passed')], 1).available).toBe(3)
    })
  })
})

describe('coverage', () => {
  /**
   * The figures are computed from the loaded runs, so after "Showing 25 of 140"
   * a "Failing 3" is a fact about 25. The footnote says so, and only then.
   */
  it('says how much the figures cover when more runs exist than are loaded', () => {
    expect(coverage({ available: 140, total: 25 })).toBe('Figures cover the newest 25 of 140 runs.')
  })

  it('says nothing when every run is loaded', () => {
    expect(coverage({ available: 25, total: 25 })).toBeNull()
  })

  it('works from what summarise reports', () => {
    expect(coverage(summarise([run('passed'), run('failed')], 40))).toContain('2 of 40')
    expect(coverage(summarise([run('passed'), run('failed')]))).toBeNull()
  })
})

describe('ringBackground', () => {
  it('fills the share that passed in green and the rest in red', () => {
    const bg = ringBackground(75)
    expect(bg).toContain(`${sc.pass} 0 75%`)
    expect(bg).toContain(`${sc.fail} 75% 100%`)
  })

  it('is all green at 100 and all red at 0', () => {
    expect(ringBackground(100)).toContain(`${sc.pass} 0 100%`)
    expect(ringBackground(0)).toContain(`${sc.pass} 0 0%`)
    expect(ringBackground(0)).toContain(`${sc.fail} 0% 100%`)
  })

  /** An empty track, not a ring at 0%: nothing finished is not "everything failed". */
  it('draws no red when nothing has finished', () => {
    expect(ringBackground(null)).not.toContain(sc.fail)
    expect(ringBackground(null)).not.toContain('conic-gradient')
  })

  it('clamps a figure outside 0-100 instead of drawing a broken ring', () => {
    expect(ringBackground(140)).toContain('100%')
    expect(ringBackground(140)).not.toContain('140')
    expect(ringBackground(-5)).not.toContain('-5')
  })
})

describe('the two-column layout', () => {
  /**
   * Both breakpoints are about the same list. The column appears only where the
   * list's 620px and the 320px beside it fit, and the list is already in its
   * two-line form below COMPACT_BELOW, so the two can never be in conflict.
   */
  it('puts the column only where the list and the column both fit', () => {
    expect(WIDE_FROM).toBeGreaterThanOrEqual(620 + 320)
    expect(WIDE_FROM).toBeGreaterThan(COMPACT_BELOW)
    expect(WIDE_QUERY).toBe(`(min-width: ${WIDE_FROM}px)`)
  })
})
