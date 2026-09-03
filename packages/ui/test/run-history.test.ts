import { describe, expect, it, vi, afterEach } from 'vitest'
import { relative, duration, resultShares } from '../src/components/RunHistory'
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
