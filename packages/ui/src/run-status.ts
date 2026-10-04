import type { Run, RunStatus } from './api'
import { status as sc } from './theme'

/**
 * How each status looks, in one table.
 *
 * Colour alone is not the signal. Red and green are the pair colour-vision
 * deficiency flattens, and three of the six statuses are red, so every status
 * also has its own icon and its own word. The edge down the side of a row and
 * the icon are two views of the same entry, which is why they live together:
 * a status added to `RunStatus` without a line here is a type error, not a row
 * that renders with no edge.
 */

export type StatusIconName = 'pass' | 'fail' | 'alert' | 'timer' | 'clock' | 'running'

export interface StatusLook {
  label: string
  icon: StatusIconName
  /** The edge and the icon. A literal, like every status colour: see theme.ts. */
  color: string
  /** The tinted fill behind a status badge. */
  tint: string
}

export const STATUS_LOOK: Record<RunStatus, StatusLook> = {
  passed: { label: 'passed', icon: 'pass', color: sc.pass, tint: sc.passBg },
  failed: { label: 'failed', icon: 'fail', color: sc.fail, tint: sc.failBg },
  error: { label: 'error', icon: 'alert', color: sc.fail, tint: sc.failBg },
  timeout: { label: 'timeout', icon: 'timer', color: sc.fail, tint: sc.failBg },
  queued: { label: 'queued', icon: 'clock', color: sc.pending, tint: sc.pendingBg },
  running: { label: 'running', icon: 'running', color: sc.pending, tint: sc.pendingBg },
}

/**
 * How long a run has been going, for the row that has no result to show yet.
 *
 * The API reports no progress while a run is in flight — `total`, `passed` and
 * `failed` stay null until the callback arrives — so the only honest thing a
 * running row can show is time. A percentage here would be invented.
 *
 * Measured from `startedAt`, which is the Worker's clock, against the
 * browser's: the same skew `relative` clamps, for the same reason.
 */
export function elapsed(startedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * What the result cell of a run in flight says.
 *
 * A queued run is waiting for a runner and a running one has been going for
 * some time; neither has a count, so neither gets a bar that pretends to.
 */
export function pendingNote(run: Pick<Run, 'status' | 'startedAt'>, now = Date.now()): string {
  return run.status === 'queued'
    ? 'waiting for a runner'
    : `running for ${elapsed(run.startedAt, now)}`
}
