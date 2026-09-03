import type { Role } from './types'

/**
 * The run gate — whether developers may start runs right now.
 *
 * Distinct from the policy table on purpose. Policy answers *may this role
 * ever do this*, and changes when someone's job changes. The gate answers *is
 * now a good time*, and changes during a release. Merging them would mean
 * revoking a role to quiet a deploy window and remembering to grant it back.
 *
 * **It gates `dev` only.** QA and admin run during a freeze precisely because a
 * freeze is when release verification happens; a gate that stopped them would
 * be stopping the work it exists to protect.
 *
 * **It fails open.** A missing row, an unparseable timestamp, a mode nobody
 * recognises — all resolve to open. That is the opposite of how the
 * authorisation code in this repo behaves, and deliberately so: the gate is a
 * coordination tool, and bad data in a coordination tool should not become an
 * outage for everyone. Anything that must not be bypassed lives in `policy.ts`,
 * which fails closed.
 */

export type GateMode = 'open' | 'closed' | 'window'

export interface GateRow {
  mode: GateMode
  opens_at: string | null
  closes_at: string | null
  updated_at: string | null
  updated_by: string | null
}

export interface GateStatus {
  state: 'open' | 'closed'
  /** Why it is in that state — `default` means no usable configuration. */
  reason: 'manual' | 'window' | 'default'
  /** When it next opens, if that is known. */
  opensAt: string | null
  /** When it next closes, if that is known. */
  closesAt: string | null
}

const OPEN: GateStatus = { state: 'open', reason: 'default', opensAt: null, closesAt: null }

function parseWindow(row: GateRow): { opens: number; closes: number } | null {
  if (!row.opens_at || !row.closes_at) return null

  const opens = Date.parse(row.opens_at)
  const closes = Date.parse(row.closes_at)
  if (Number.isNaN(opens) || Number.isNaN(closes)) return null

  // A window that closes before it opens is never open, which would lock devs
  // out with no way to see why. Treat it as unconfigured.
  if (closes <= opens) return null

  return { opens, closes }
}

/**
 * Resolves the gate's state at a point in time.
 *
 * Pure — the row and the clock both arrive as arguments, so every branch is
 * reachable in a test without waiting for a Tuesday.
 */
export function resolveGate(row: GateRow | null, now: Date): GateStatus {
  if (!row) return OPEN

  if (row.mode === 'window') {
    const win = parseWindow(row)
    if (!win) return OPEN

    const t = now.getTime()

    if (t < win.opens) {
      return {
        state: 'closed',
        reason: 'window',
        opensAt: new Date(win.opens).toISOString(),
        closesAt: null,
      }
    }

    if (t < win.closes) {
      return {
        state: 'open',
        reason: 'window',
        opensAt: null,
        closesAt: new Date(win.closes).toISOString(),
      }
    }

    // Past the window. Stays closed until someone changes the mode — a window
    // that silently reopened would be a schedule, which is a different feature.
    return { state: 'closed', reason: 'window', opensAt: null, closesAt: null }
  }

  if (row.mode === 'open' || row.mode === 'closed') {
    return { state: row.mode, reason: 'manual', opensAt: null, closesAt: null }
  }

  // A mode the code does not recognise — fail open rather than block everyone.
  return OPEN
}

/** Whether the gate applies to this role at all. */
export const gateApplies = (role: Role): boolean => role === 'dev'

export async function loadGate(db: D1Database): Promise<GateRow | null> {
  return db.prepare('SELECT * FROM run_gate WHERE id = 1').first<GateRow>()
}
