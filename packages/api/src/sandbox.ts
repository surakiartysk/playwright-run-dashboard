import type { Bindings } from './types'
import { mintKey } from './apiKeys'
import { DEV_TOKEN_SECRET } from './config'

/**
 * Keys a visitor mints for themselves, and how they are kept from costing
 * anything.
 *
 * A sandbox key is the demo role's, so it can only ever simulate: the guard
 * that stops a demo session dispatching for real is in `simulates()`, ahead of
 * every deployment flag, and a key reaches `POST /runs` as the role it carries.
 * What is left to bound is volume. A stranger holding a key can start simulated
 * runs in a loop, and the only casualty is rows in D1 — the same housekeeping
 * problem as the public demo password (decision 22), bounded the same way:
 * shared limits, not per-visitor ones, because a demo session carries no
 * identity to key a bucket on and an address is spoofable and shared by every
 * NAT.
 */

/** How long a key lives. Long enough to try the thing; short enough not to be kept. */
export const SANDBOX_TTL_MS = 24 * 60 * 60 * 1000
/** Runs one key may start in an hour. */
export const SANDBOX_RUNS_PER_HOUR = 10
/** Keys the dashboard will mint in an hour, across every visitor. */
export const SANDBOX_KEYS_PER_HOUR = 20
/** Keys that may be live at once, across every visitor. */
export const SANDBOX_ACTIVE_MAX = 200
export const SANDBOX_MAX_WORKERS = 2
export const SANDBOX_REFS = ['main'] as const
/** Demo runs older than this are removed, so the table does not only grow. */
export const DEMO_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type Issued =
  | {
      ok: true
      plaintext: string
      expiresAt: string
      limits: { runsPerHour: number; maxWorkers: number; refs: string[]; simulated: true }
    }
  | { ok: false; error: string }

/**
 * Mint a sandbox key, unless the dashboard has issued enough.
 *
 * Refused with a message that says which limit and when it lifts, rather than
 * a bare 429: the visitor has done nothing wrong and the way forward is to wait
 * or to run the project locally.
 */
export async function issueSandboxKey(env: Bindings, now: number = Date.now()): Promise<Issued> {
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const nowIso = new Date(now).toISOString()

  const [recent, active] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM api_keys WHERE sandbox = 1 AND created_at > ?1`)
      .bind(hourAgo)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM api_keys
        WHERE sandbox = 1 AND revoked_at IS NULL AND expires_at > ?1`,
    )
      .bind(nowIso)
      .first<{ n: number }>(),
  ])

  if ((recent?.n ?? 0) >= SANDBOX_KEYS_PER_HOUR) {
    return {
      ok: false,
      error:
        'Sandbox keys have been issued as fast as they are allowed this hour. Try again within the hour — ' +
        'or clone the repo and run it locally with no limit.',
    }
  }
  if ((active?.n ?? 0) >= SANDBOX_ACTIVE_MAX) {
    return {
      ok: false,
      error: 'There are as many sandbox keys live as the dashboard allows. Some expire every day.',
    }
  }

  const { row, plaintext } = await mintKey(env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, {
    label: 'sandbox',
    role: 'demo',
    allowedRefs: [...SANDBOX_REFS],
    maxWorkers: SANDBOX_MAX_WORKERS,
    createdBy: 'demo-session',
  })
  const expiresAt = new Date(now + SANDBOX_TTL_MS).toISOString()

  await env.DB.prepare(
    `INSERT INTO api_keys
       (id, hash, label, role, allowed_refs, max_workers, created_by, created_at, expires_at, sandbox)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)`,
  )
    .bind(
      row.id,
      row.hash,
      row.label,
      row.role,
      row.allowed_refs,
      row.max_workers,
      row.created_by,
      row.created_at,
      expiresAt,
    )
    .run()

  return {
    ok: true,
    plaintext,
    expiresAt,
    limits: {
      runsPerHour: SANDBOX_RUNS_PER_HOUR,
      maxWorkers: SANDBOX_MAX_WORKERS,
      refs: [...SANDBOX_REFS],
      simulated: true,
    },
  }
}

/**
 * Whether a sandbox key has used its runs for the hour.
 *
 * Counted from the runs table by the key's id, which `POST /runs` already
 * writes for every run a key starts; no counter to keep in step.
 */
export async function sandboxKeyIsSpent(
  db: D1Database,
  keyId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM runs WHERE api_key_id = ?1 AND started_at > ?2`)
    .bind(keyId, new Date(now - 60 * 60 * 1000).toISOString())
    .first<{ n: number }>()
  return (row?.n ?? 0) >= SANDBOX_RUNS_PER_HOUR
}

/**
 * Remove what has outlived its use: sandbox keys a day past expiry, and demo
 * runs older than a week.
 *
 * A key is already refused the moment it expires, so deleting it changes
 * nothing a caller can see; a day's grace keeps a "my key stopped working" a
 * thing that can be looked up. Demo runs point at one shared report and own no
 * stored object, so removing their rows leaves nothing behind.
 */
export async function pruneSandbox(
  db: D1Database,
  now: number = Date.now(),
): Promise<{ keys: number; runs: number }> {
  const [keys, runs] = await Promise.all([
    db
      .prepare(`DELETE FROM api_keys WHERE sandbox = 1 AND expires_at < ?1`)
      .bind(new Date(now - 24 * 60 * 60 * 1000).toISOString())
      .run(),
    db
      .prepare(`DELETE FROM runs WHERE triggered_by = 'demo' AND started_at < ?1`)
      .bind(new Date(now - DEMO_RUN_RETENTION_MS).toISOString())
      .run(),
  ])
  return { keys: keys.meta.changes, runs: runs.meta.changes }
}
