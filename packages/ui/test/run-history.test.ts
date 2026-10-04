import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  relative,
  duration,
  resultShares,
  refLabel,
  rowMeta,
  startedLabel,
  startedTitle,
  suiteCommitUrl,
} from '../src/components/RunHistory'
import { COMPACT_BELOW, COMPACT_QUERY } from '../src/use-compact'
import type { Run } from '../src/api'

/**
 * The pure logic behind the run list.
 *
 * Still no component tests — what the card does is arrange styled divs. But
 * three functions inside it compute something that can be wrong: a relative
 * time that crosses unit boundaries, a duration that formats a null, and the
 * proportions of a bar that divides by a total which can legitimately be zero.
 */

afterEach(() => vi.useRealTimers())

const at = (iso: string) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe('relative', () => {
  it.each([
    ['seconds', '2026-01-01T12:00:00Z', '2026-01-01T12:00:30Z', '30s ago'],
    ['the minute boundary', '2026-01-01T12:00:00Z', '2026-01-01T12:01:00Z', '1m ago'],
    ['minutes', '2026-01-01T12:00:00Z', '2026-01-01T12:45:00Z', '45m ago'],
    ['the hour boundary', '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z', '1h ago'],
    ['hours', '2026-01-01T12:00:00Z', '2026-01-01T20:00:00Z', '8h ago'],
    ['the day boundary', '2026-01-01T12:00:00Z', '2026-01-02T12:00:00Z', '1d ago'],
    ['days', '2026-01-01T12:00:00Z', '2026-01-04T12:00:00Z', '3d ago'],
  ])('formats %s', (_label, started, now, expected) => {
    at(now)
    expect(relative(started)).toBe(expected)
  })

  /**
   * 59 seconds must not round up into "1m ago" while still in the seconds
   * branch — the boundary is where an off-by-one lives.
   */
  it('stays in seconds at 59', () => {
    at('2026-01-01T12:00:59Z')
    expect(relative('2026-01-01T12:00:00Z')).toBe('59s ago')
  })

  it('does not go negative for a clock slightly ahead', () => {
    at('2026-01-01T12:00:00Z')
    // A run started a moment "in the future" by clock skew reads as 0s, not -1s.
    expect(relative('2026-01-01T12:00:00.400Z')).toBe('0s ago')
  })

  /**
   * The case above passed by rounding, not by design: 0.4s rounds to zero.
   * Two seconds of skew rendered "-2s ago", and five minutes "-300s ago",
   * because a negative number is always under sixty.
   */
  it.each([
    ['two seconds', '2026-01-01T12:00:02Z'],
    ['five minutes', '2026-01-01T12:05:00Z'],
  ])('reads a start %s in the browser’s future as 0s ago', (_label, started) => {
    at('2026-01-01T12:00:00Z')
    expect(relative(started)).toBe('0s ago')
  })
})

describe('duration', () => {
  it('returns null for a run that has not finished', () => {
    expect(duration(null)).toBeNull()
  })

  it.each([
    [0, '0.0s'],
    [500, '0.5s'],
    [1000, '1.0s'],
    [5678, '5.7s'],
    [125_400, '125.4s'],
  ])('formats %sms as %s', (ms, expected) => {
    expect(duration(ms)).toBe(expected)
  })
})

describe('rowMeta beyond a day', () => {
  /** The phone's one-line form must say the date too, not "27d ago". */
  it('gives the date for an old run, as the column does', () => {
    at('2026-10-04T12:00:00Z')
    const text = rowMeta({ startedAt: '2026-09-01T12:00:00Z', durationMs: 5700 })
    expect(text).toMatch(/^1 Sep · 5\.7s$/)
    expect(text).not.toContain('ago')
  })
})

describe('resultShares', () => {
  const run = (overrides: Partial<Run>): Run =>
    ({ total: 100, passed: 100, failed: 0, status: 'passed', ...overrides }) as Run

  it('gives a clean pass the whole bar', () => {
    expect(resultShares(run({}))).toMatchObject({ passed: 100, failed: 0, other: 0 })
  })

  it('splits pass and fail proportionally', () => {
    expect(resultShares(run({ total: 100, passed: 90, failed: 10 }))).toMatchObject({
      passed: 90,
      failed: 10,
      other: 0,
    })
  })

  /**
   * Skipped tests are neither passed nor failed, and the remainder has to go
   * somewhere or the bar renders short and looks like data was lost.
   */
  it('gives the remainder to the neutral segment', () => {
    expect(resultShares(run({ total: 100, passed: 80, failed: 5 }))).toMatchObject({
      passed: 80,
      failed: 5,
      other: 15,
    })
  })

  /**
   * The guard that matters. A run reporting zero tests — an empty tag filter
   * matches nothing — would divide by zero and give every segment a NaN width.
   */
  it('does not divide by zero when a run reports no tests', () => {
    const shares = resultShares(run({ total: 0, passed: 0, failed: 0 }))

    for (const value of Object.values(shares)) {
      expect(Number.isNaN(value)).toBe(false)
    }
    expect(shares).toMatchObject({ passed: 0, failed: 0, other: 0 })
  })

  it('never produces a negative segment when the numbers do not add up', () => {
    // Defensive: a callback reporting more passes than the total is nonsense,
    // but a negative width would break the layout rather than just look wrong.
    const shares = resultShares(run({ total: 10, passed: 12, failed: 0 }))

    expect(shares.other).toBe(0)
  })
})

describe('suiteCommitUrl', () => {
  /**
   * Each suite's sha is a commit in that suite's own repository. Every sha
   * used to be linked into the API suite's repository, so a UI run's link
   * rendered normally and went to a 404.
   */
  it.each([
    ['api', 'https://github.com/surakiartysk/playwright-api-automation-patterns/commit/abc1234'],
    ['ui', 'https://github.com/surakiartysk/playwright-ui-automation-patterns/commit/abc1234'],
  ] as const)('links a %s run to its own repository', (suite, expected) => {
    expect(suiteCommitUrl(suite, 'abc1234')).toBe(expected)
  })
})

describe('rowMeta', () => {
  it('joins when it started and how long it took', () => {
    at('2026-01-01T12:00:30Z')
    expect(rowMeta({ startedAt: '2026-01-01T12:00:00Z', durationMs: 5700 })).toBe('30s ago · 5.7s')
  })

  /** A run in flight has no duration, and must not end on a dangling separator. */
  it('gives only the start for a run that has not finished', () => {
    at('2026-01-01T12:00:30Z')
    expect(rowMeta({ startedAt: '2026-01-01T12:00:00Z', durationMs: null })).toBe('30s ago')
  })

  it('keeps a zero-length run: 0.0s is a duration, not a missing one', () => {
    at('2026-01-01T12:00:30Z')
    expect(rowMeta({ startedAt: '2026-01-01T12:00:00Z', durationMs: 0 })).toBe('30s ago · 0.0s')
  })
})

describe('the narrow layout', () => {
  /**
   * The table needs 620px (`minWidth` in the styles) and the list switches to
   * rows below 640, so the two cannot leave a band of widths that is neither.
   */
  it('starts just under the width the table needs', () => {
    expect(COMPACT_BELOW).toBeGreaterThanOrEqual(620)
    expect(COMPACT_QUERY).toBe(`(max-width: ${COMPACT_BELOW - 1}px)`)
  })
})

describe('startedLabel', () => {
  const NOW = Date.parse('2026-10-04T12:00:00Z')

  it('stays relative within a day, which is what someone watching the list wants', () => {
    at('2026-10-04T12:00:00Z')
    expect(startedLabel('2026-10-04T09:00:00Z', NOW, 'UTC')).toBe('3h ago')
    expect(startedLabel('2026-10-03T12:00:01Z', NOW, 'UTC')).toBe('24h ago')
  })

  /** Past a day nobody can place a run by counting days back. */
  it('is the date once a day has passed', () => {
    expect(startedLabel('2026-10-03T12:00:00Z', NOW, 'UTC')).toBe('3 Oct')
    expect(startedLabel('2026-09-04T14:03:00Z', NOW, 'UTC')).toBe('4 Sep')
  })

  it('adds the year only when it is not this one', () => {
    expect(startedLabel('2025-12-31T10:00:00Z', NOW, 'UTC')).toBe('31 Dec 2025')
    expect(startedLabel('2026-01-02T10:00:00Z', NOW, 'UTC')).toBe('2 Jan')
  })

  it('reads the day in the reader’s zone, not UTC’s', () => {
    // 20:00 UTC on the 3rd is already the 4th in Bangkok.
    expect(startedLabel('2026-09-03T20:00:00Z', NOW, 'Asia/Bangkok')).toBe('4 Sep')
    expect(startedLabel('2026-09-03T20:00:00Z', NOW, 'UTC')).toBe('3 Sep')
  })

  it('does not call a run from a clock slightly ahead a date', () => {
    at('2026-10-04T12:00:00Z')
    expect(startedLabel('2026-10-04T12:00:02Z', NOW, 'UTC')).toBe('0s ago')
  })
})

describe('startedTitle', () => {
  it('gives the exact time, to the second, in the zone asked for', () => {
    expect(startedTitle('2026-09-04T14:03:09Z', 'UTC')).toBe('4 Sep 2026, 14:03:09')
    expect(startedTitle('2026-09-04T14:03:09Z', 'Asia/Bangkok')).toBe('4 Sep 2026, 21:03:09')
  })
})

describe('refLabel', () => {
  const run = (over: Partial<Pick<Run, 'suiteVersion' | 'suiteSha'>> = {}) => ({
    ref: 'main',
    suiteVersion: null,
    suiteSha: null,
    ...over,
  })

  it('is the branch alone for a run that has neither a version nor a commit', () => {
    expect(refLabel(run())).toBe('main')
  })

  it('adds the commit, short, as soon as the run has one', () => {
    expect(refLabel(run({ suiteSha: 'a1b2c3d4e5f6071829' }))).toBe('main · a1b2c3d')
  })

  it('prefers the version once the result has brought it', () => {
    expect(refLabel(run({ suiteVersion: '0.4.1', suiteSha: 'a1b2c3d4e5f6' }))).toBe('main · v0.4.1')
  })

  it('shows a version the suite reported without a commit (an older workflow)', () => {
    expect(refLabel(run({ suiteVersion: '0.4.1' }))).toBe('main · v0.4.1')
  })

  it('keeps the branch it ran on', () => {
    expect(refLabel({ ...run({ suiteSha: 'abcdef1234' }), ref: 'release' })).toBe(
      'release · abcdef1',
    )
  })
})
