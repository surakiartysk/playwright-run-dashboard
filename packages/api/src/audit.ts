import type { D1Database } from '@cloudflare/workers-types'

/**
 * Activity: who did what in a sandbox, and when (decision 52).
 *
 * Written for the things a person would ask about afterwards — sign-ins, a
 * refused account, the admin key, members, keys, the gate, lockdown, deleted
 * runs. Never a key, a token or a request body: the detail is a short phrase
 * the handler writes, not something copied from the caller.
 *
 * A failed write does not fail the request it describes. The log is evidence,
 * not a gate, and an action that happened should not be reported as refused
 * because its record could not be kept.
 */

export const AUDIT_ACTIONS = [
  'sign-in',
  'sign-in-refused',
  'admin-unlocked',
  'admin-key-refused',
  'member-added',
  'member-removed',
  'member-role-changed',
  'key-issued',
  'key-revoked',
  'gate-changed',
  'lockdown-on',
  'lockdown-off',
  'run-deleted',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditRow {
  id: number
  sandbox_id: string
  at: string
  actor: string
  action: AuditAction
  detail: string | null
}

/** The newest this many are kept per sandbox when it is read; a day's sandbox holds few. */
export const AUDIT_PAGE = 100

export async function record(
  db: D1Database,
  sandboxId: string,
  actor: string,
  action: AuditAction,
  detail: string | null = null,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (sandbox_id, at, actor, action, detail) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(sandboxId, new Date().toISOString(), actor, action, detail)
      .run()
  } catch (error) {
    console.error('audit write failed', action, error)
  }
}

export async function readAudit(db: D1Database, sandboxId: string): Promise<AuditRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM audit_log WHERE sandbox_id = ?1 ORDER BY id DESC LIMIT ?2`)
    .bind(sandboxId, AUDIT_PAGE)
    .all<AuditRow>()
  return results
}
