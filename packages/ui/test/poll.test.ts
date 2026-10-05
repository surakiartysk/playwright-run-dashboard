import { describe, expect, it } from 'vitest'
import {
  IDLE_MS,
  IN_FLIGHT_MS,
  MAX_BACKOFF_MS,
  REFRESH_DEBOUNCE_MS,
  pollDelay,
  refreshOnReturn,
} from '../src/poll'

/**
 * When the run list asks for itself again.
 *
 * The case behind it: a run started from a terminal never appeared, because the
 * list only asked while a run it already knew about was in flight.
 */

describe('pollDelay', () => {
  it('asks quickly while a run is in flight', () => {
    expect(pollDelay({ pending: true, loadedMore: false })).toBe(IN_FLIGHT_MS)
  })

  it('asks slowly when nothing is, so a run that began elsewhere is noticed', () => {
    expect(pollDelay({ pending: false, loadedMore: false })).toBe(IDLE_MS)
  })

  it('is slower idle than in flight, and still a real interval', () => {
    expect(IDLE_MS).toBeGreaterThan(IN_FLIGHT_MS)
    expect(IDLE_MS).toBeGreaterThanOrEqual(10_000)
  })

  /** Reloading swaps the rows for page one, under the eyes of someone who scrolled. */
  it('leaves an idle list alone once more than the first page is on screen', () => {
    expect(pollDelay({ pending: false, loadedMore: true })).toBeNull()
  })

  it('still follows a run in flight, because its row is what is being watched', () => {
    expect(pollDelay({ pending: true, loadedMore: true })).toBe(IN_FLIGHT_MS)
  })
})

describe('refreshOnReturn', () => {
  it('reloads when the page has not asked for a while', () => {
    expect(refreshOnReturn(60_000, 0)).toBe(true)
  })

  it('does not ask twice for the one tab switch (focus and visibility both fire)', () => {
    expect(refreshOnReturn(1_000_100, 1_000_000)).toBe(false)
  })

  it('asks again at exactly the debounce, and not a moment before', () => {
    expect(refreshOnReturn(5_000 + REFRESH_DEBOUNCE_MS, 5_000)).toBe(true)
    expect(refreshOnReturn(5_000 + REFRESH_DEBOUNCE_MS - 1, 5_000)).toBe(false)
  })
})

/**
 * Through an outage the list kept asking every two seconds, from every open
 * tab, at a service that was not answering. Found by the state review.
 */
describe('pollDelay while asks are failing', () => {
  it('doubles the wait with each failure in a row', () => {
    expect(pollDelay({ pending: true, loadedMore: false, failures: 1 })).toBe(IN_FLIGHT_MS * 2)
    expect(pollDelay({ pending: true, loadedMore: false, failures: 3 })).toBe(IN_FLIGHT_MS * 8)
  })

  it('never waits more than a minute', () => {
    expect(pollDelay({ pending: false, loadedMore: false, failures: 10 })).toBe(MAX_BACKOFF_MS)
    expect(MAX_BACKOFF_MS).toBe(60000)
  })

  it('asks at the normal pace once an ask succeeds', () => {
    expect(pollDelay({ pending: true, loadedMore: false, failures: 0 })).toBe(IN_FLIGHT_MS)
  })
})
