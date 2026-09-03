import { describe, expect, it } from 'vitest'
import { modeFromStatus, toLocalInput } from '../src/gate-form'

/**
 * The gate form's two silent failure modes.
 *
 * Neither shows up as a broken screen: a window saved an hour off still looks
 * like a working schedule, and a mode seeded from the wrong field still looks
 * like a working form — right up until the next Apply discards a schedule
 * nobody asked to remove.
 */

describe('seeding the form from the gate', () => {
  /**
   * The case that motivates reading `reason` rather than `state`.
   *
   * A scheduled window outside its hours reports `state: 'closed'` while its
   * configuration is still `window`. Seeding from `state` shows "Paused", and
   * the admin's next Apply sends `mode: 'closed'` — silently converting a
   * schedule into a manual pause and dropping the timestamps.
   */
  it('keeps a lapsed window as a window, not a manual pause', () => {
    expect(modeFromStatus({ state: 'closed', reason: 'window' })).toBe('window')
  })

  it('keeps an active window as a window', () => {
    expect(modeFromStatus({ state: 'open', reason: 'window' })).toBe('window')
  })

  it('reads a manual pause as paused', () => {
    expect(modeFromStatus({ state: 'closed', reason: 'manual' })).toBe('closed')
  })

  it('reads an unconfigured gate as open', () => {
    expect(modeFromStatus({ state: 'open', reason: 'default' })).toBe('open')
  })
})

describe('showing an instant in a datetime-local input', () => {
  /**
   * `datetime-local` has no timezone. Handing it an ISO string with a `Z`
   * leaves the field blank in every browser, and handing it one without the
   * offset applied shows a time that is wrong by the local offset — which the
   * admin then saves, scheduling the freeze for the wrong hour.
   */
  it('produces the shape the input accepts, with no zone', () => {
    expect(toLocalInput('2026-03-01T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('round-trips back to the same instant', () => {
    const iso = '2026-03-01T12:00:00.000Z'
    // What the browser does with the field's value on submit.
    expect(new Date(toLocalInput(iso)).toISOString()).toBe(iso)
  })

  it('shows the local clock face, not UTC', () => {
    const iso = '2026-03-01T12:00:00.000Z'
    const at = new Date(iso)
    const expectedHour = String(at.getHours()).padStart(2, '0')

    expect(toLocalInput(iso).slice(11, 13)).toBe(expectedHour)
  })

  it('falls back to now when nothing is configured', () => {
    expect(toLocalInput(null)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})
