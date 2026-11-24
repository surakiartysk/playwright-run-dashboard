import type { D1Database } from '@cloudflare/workers-types'

/**
 * Who may sign in to a sandbox, and as what (decision 52).
 *
 * Members only: an email that is not on the list is refused at sign-in and on
 * every request after it, because the role is read from here each time rather
 * than carried in the session. Removing someone takes effect on their next
 * click, not when their session runs out.
 *
 * `admin` is the whitelist half of being admin. Listed as admin, a person works
 * as `dev` until they also give the sandbox's admin key — so neither the list
 * nor the key is enough alone.
 */

export const MEMBER_ROLES = ['admin', 'qa', 'dev'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]
export const isMemberRole = (value: unknown): value is MemberRole =>
  typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value)

export interface MemberRow {
  sandbox_id: string
  email: string
  role: MemberRole
  added_at: string
  added_by: string
}

/** No real address is longer (RFC 5321). */
export const MAX_EMAIL_LENGTH = 254

/** The email as stored, or null when it is not one plain address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length > MAX_EMAIL_LENGTH) return null
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email) ? email : null
}

/** The role this email is listed with in this sandbox, or null when it is not listed. */
export async function listedRole(
  db: D1Database,
  sandboxId: string,
  email: string,
): Promise<MemberRole | null> {
  const row = await db
    .prepare(`SELECT role FROM members WHERE sandbox_id = ?1 AND email = ?2`)
    .bind(sandboxId, email)
    .first<{ role: string }>()
  return isMemberRole(row?.role) ? row.role : null
}

export async function listMembers(db: D1Database, sandboxId: string): Promise<MemberRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM members WHERE sandbox_id = ?1 ORDER BY role, email`)
    .bind(sandboxId)
    .all<MemberRow>()
  return results
}

/** How many admins the sandbox lists — the last one may not be removed or demoted. */
export async function adminCount(db: D1Database, sandboxId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM members WHERE sandbox_id = ?1 AND role = 'admin'`)
    .bind(sandboxId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** A sandbox's list may not grow without bound; it is a demo, not a directory. */
export const MEMBERS_MAX = 25
