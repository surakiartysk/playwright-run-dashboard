import { describe, expect, it } from 'vitest'
import { modeFromStatus, pausedReason, toLocalInput } from '../src/gate-form'

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

/**
 * What a blocked developer is told.
 *
 * Migration 0003 gives `updated_by` one job — "so 'why can't I run anything?'
 * has an answer" — and until now the answer stopped at the database: the
 * column recorded a role, and no endpoint read it back. Now that it carries a
 * person and GET /gate returns it, this is the sentence that has to spend it.
 */
describe('pausedReason', () => {
  it('names who paused it when the gate says', () => {
    expect(pausedReason({ opensAt: null, updatedBy: 'Nok (admin)' })).toBe(
      'Runs are paused for your role, by Nok (admin). QA and admin are unaffected.',
    )
  })

  it('says when it lifts, alongside who paused it', () => {
    const message = pausedReason({ opensAt: '2026-01-01T14:00:00Z', updatedBy: 'Nok (admin)' })

    expect(message).toContain('Nok (admin)')
    expect(message).toContain(new Date('2026-01-01T14:00:00Z').toLocaleString())
  })

  /*
   * A gate nobody has touched since the migration seeded it has no name to
   * give. The sentence has to stay a sentence rather than trailing "by null".
   */
  it('leaves the attribution out entirely when there is none', () => {
    expect(pausedReason({ opensAt: null, updatedBy: null })).toBe(
      'Runs are paused for your role. QA and admin are unaffected.',
    )
  })
})
