import type { D1Database } from '@cloudflare/workers-types'
import type { Bindings } from './types'
import { hmacHex } from './crypto'
import { DEV_TOKEN_SECRET } from './config'
import { secondsUntilRoom } from './retry'

/**
 * A sandbox: one visitor's copy of the dashboard (decision 52).
 *
 * Every visitor who signs in gets one. Their runs, gate, keys, members and
 * activity carry its id, every query over them is scoped to it, and it is
 * removed a day after it was made. So the controls can all work — a visitor can
 * delete a run, lock the sandbox down, revoke a key — and the only person who
 * sees the result is the one who did it.
 *
 * What it does not isolate is volume. Sandboxes are made from a public button,
 * so the limits below are shared across every visitor, for the reason decision
 * 22 gives: a visitor carries no identity to count against, and an address is
 * spoofable and shared by every NAT.
 */

const HOUR_MS = 60 * 60 * 1000

/** How long a sandbox lives. */
export const SANDBOX_LIFETIME_MS = 24 * HOUR_MS
/** Sandboxes the dashboard will make in an hour, across every visitor. */
export const SANDBOXES_PER_HOUR = 60
/** Sandboxes that may be alive at once, across every visitor. */
export const SANDBOXES_ALIVE_MAX = 500

/** The made-up domain every sandbox's accounts live on. Nothing is sent to it. */
export const DEMO_DOMAIN = 'demo.testbydesign.dev'

/**
 * The accounts a new sandbox starts with, and the one that is on no list.
 *
 * `you` is the visitor: listed as admin, so the admin page is theirs to unlock.
 * The outsider exists to be refused, which is the point of a whitelist.
 */
export const SEED_MEMBERS = [
  { email: `you@${DEMO_DOMAIN}`, role: 'admin' },
  { email: `qa.lead@${DEMO_DOMAIN}`, role: 'qa' },
  { email: `dev.one@${DEMO_DOMAIN}`, role: 'dev' },
] as const
export const VISITOR_EMAIL = SEED_MEMBERS[0].email
export const OUTSIDER_EMAIL = 'someone@gmail.com'

export interface SandboxRow {
  id: string
  created_at: string
  expires_at: string
  lockdown: number
}

export type Made =
  { ok: true; sandbox: SandboxRow } | { ok: false; error: string; retryAfter: number }

/** 128 random bits, hex. Unguessable, so a sandbox's id is not a way into it. */
export function newSandboxId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Make a sandbox and give it its starting state, unless enough have been made.
 *
 * The seed is one batch, so a sandbox never exists without its members: a
 * sign-in that found it half-made would be refused as "not a member".
 */
export async function makeSandbox(env: Bindings, now: number = Date.now()): Promise<Made> {
  const hourAgo = new Date(now - HOUR_MS).toISOString()
  const nowIso = new Date(now).toISOString()

  const [recent, alive] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM sandboxes WHERE created_at > ?1`)
      .bind(hourAgo)
      .first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM sandboxes WHERE expires_at > ?1`)
      .bind(nowIso)
      .first<{ n: number }>(),
  ])

  if ((recent?.n ?? 0) >= SANDBOXES_PER_HOUR) {
    return {
      ok: false,
      error: 'The demo has made its hourly share of sandboxes. Try again within the hour.',
      retryAfter: await secondsUntilRoom(
        env.DB,
        {
          from: 'sandboxes',
          where: 'created_at > ?1',
          column: 'created_at',
          params: [hourAgo],
          count: recent?.n ?? 0,
          limit: SANDBOXES_PER_HOUR,
          holdMs: HOUR_MS,
          atMostMs: HOUR_MS,
        },
        now,
      ),
    }
  }
  if ((alive?.n ?? 0) >= SANDBOXES_ALIVE_MAX) {
    return {
      ok: false,
      error: 'The demo is full. A sandbox frees up when one expires; try again later.',
      retryAfter: await secondsUntilRoom(
        env.DB,
        {
          from: 'sandboxes',
          where: 'expires_at > ?1',
          column: 'expires_at',
          params: [nowIso],
          count: alive?.n ?? 0,
          limit: SANDBOXES_ALIVE_MAX,
          holdMs: 0,
          atMostMs: SANDBOX_LIFETIME_MS,
        },
        now,
      ),
    }
  }

  const sandbox: SandboxRow = {
    id: newSandboxId(),
    created_at: nowIso,
    expires_at: new Date(now + SANDBOX_LIFETIME_MS).toISOString(),
    lockdown: 0,
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sandboxes (id, created_at, expires_at, lockdown) VALUES (?1, ?2, ?3, 0)`,
    ).bind(sandbox.id, sandbox.created_at, sandbox.expires_at),
    env.DB.prepare(`INSERT INTO sandbox_gate (sandbox_id, mode) VALUES (?1, 'open')`).bind(
      sandbox.id,
    ),
    ...SEED_MEMBERS.map((member) =>
      env.DB.prepare(
        `INSERT INTO members (sandbox_id, email, role, added_at, added_by)
         VALUES (?1, ?2, ?3, ?4, 'seed')`,
      ).bind(sandbox.id, member.email, member.role, nowIso),
    ),
  ])
  return { ok: true, sandbox }
}

/** The sandbox, or null when there is none by that id or it has expired. */
export async function liveSandbox(
  db: D1Database,
  id: string,
  now: number = Date.now(),
): Promise<SandboxRow | null> {
  return db
    .prepare(`SELECT * FROM sandboxes WHERE id = ?1 AND expires_at > ?2`)
    .bind(id, new Date(now).toISOString())
    .first<SandboxRow>()
}

/**
 * The sandbox's admin key: the second half of becoming admin, after the
 * whitelist.
 *
 * Derived rather than stored, so there is nothing in D1 to read it from. In a
 * real deployment this would be a secret one person holds; here the admin page
 * shows it, because a demo whose admin cannot be reached shows nothing. The
 * check it is used in is the real one — only the value is handed out.
 */
export async function adminKeyFor(env: Bindings, sandboxId: string): Promise<string> {
  const digest = await hmacHex(env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, `admin-key:${sandboxId}`)
  return `adm_${digest.slice(0, 24)}`
}

/**
 * Remove sandboxes that have expired, with everything they held.
 *
 * Sandbox runs point at the one shared demo report and own no stored object,
 * so deleting their rows leaves nothing behind in R2.
 */
export async function pruneSandboxes(
  db: D1Database,
  now: number = Date.now(),
): Promise<{ sandboxes: number }> {
  const nowIso = new Date(now).toISOString()
  const expired = `SELECT id FROM sandboxes WHERE expires_at <= ?1`
  const results = await db.batch([
    db.prepare(`DELETE FROM runs WHERE sandbox_id IN (${expired})`).bind(nowIso),
    db.prepare(`DELETE FROM api_keys WHERE sandbox_id IN (${expired})`).bind(nowIso),
    db.prepare(`DELETE FROM members WHERE sandbox_id IN (${expired})`).bind(nowIso),
    db.prepare(`DELETE FROM audit_log WHERE sandbox_id IN (${expired})`).bind(nowIso),
    db.prepare(`DELETE FROM sandbox_gate WHERE sandbox_id IN (${expired})`).bind(nowIso),
    db.prepare(`DELETE FROM sandboxes WHERE expires_at <= ?1`).bind(nowIso),
  ])
  return { sandboxes: results[results.length - 1]!.meta.changes }
}
