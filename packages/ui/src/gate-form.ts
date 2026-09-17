import type { GateMode, GateStatus } from './api'

/**
 * The two pieces of the gate form that can be silently wrong.
 *
 * Separated from `GateControl.tsx` so they can be tested without rendering.
 * Both failures are invisible: a window saved an hour off looks like a working
 * schedule, and a mode seeded from the wrong field looks like a working form
 * until the next Apply quietly changes what was configured.
 */

/**
 * An ISO instant as the local-time string `datetime-local` expects.
 *
 * The input has no timezone, so an ISO string with a `Z` is rejected outright
 * and one without is read as local. `getTimezoneOffset` is subtracted so the
 * clock face shown matches the admin's own clock.
 *
 * @param iso - The instant to show, or null for now
 */
export function toLocalInput(iso: string | null): string {
  const at = iso ? new Date(iso) : new Date()
  const offset = at.getTimezoneOffset() * 60_000
  return new Date(at.getTime() - offset).toISOString().slice(0, 16)
}

/**
 * The mode to seed the form with, given what the API reports.
 *
 * `state` is what the gate resolves to *now*; `reason` is what was configured.
 * They disagree whenever a scheduled window is outside its hours — the state
 * reads `closed` while the configuration is still `window`.
 *
 * Seeding from `state` would therefore turn a lapsed schedule into a manual
 * pause the next time Apply was pressed, discarding the window without anyone
 * asking for that. This reads the configuration instead.
 *
 * @param gate - The gate as reported by `GET /gate`
 */
export function modeFromStatus(gate: Pick<GateStatus, 'state' | 'reason'>): GateMode {
  return gate.reason === 'window' ? 'window' : gate.state
}

/**
 * The sentence shown to a role the gate has stopped.
 *
 * Pure, and here rather than inside `RunTrigger.tsx`, for the reason at the
 * top of this file: what it says can be silently wrong while the component
 * still renders. The attribution is the part worth pinning — migration 0003
 * created `updated_by` so that "why can't I run anything?" has an answer, and
 * the answer only becomes one at the point it is read out to the person who
 * is blocked.
 *
 * Both fields are optional in practice: a gate nobody has touched since the
 * migration seeded it carries no name, and a manual close carries no opening
 * time. Neither may turn the sentence into one with a hole in it.
 *
 * @param gate - `opensAt` and `updatedBy` as `GET /gate` reports them
 */
export function pausedReason(gate: { opensAt: string | null; updatedBy: string | null }): string {
  const when = gate.opensAt ? ` until ${new Date(gate.opensAt).toLocaleString()}` : ''
  const who = gate.updatedBy ? `, by ${gate.updatedBy}` : ''

  return `Runs are paused for your role${when}${who}. QA and admin are unaffected.`
}
