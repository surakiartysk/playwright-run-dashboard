import type { D1Database } from '@cloudflare/workers-types'
import type { Bindings, Role } from './types'
import { mintKey } from './apiKeys'
import { DEV_TOKEN_SECRET } from './config'
import { secondsUntilRoom } from './retry'

/**
 * Keys a visitor mints for themselves, to try the API from a terminal.
 *
 * Every run is simulated now, so a key cannot reach anything real whatever its
 * role; what is left to bound is volume. A stranger holding a key can start
 * runs in a loop, and the only casualty is rows in D1 — bounded by a shared
 * hourly count of keys, a count of live keys per sandbox, and runs per key per
 * hour. A key belongs to its sandbox and dies with it.
 *
 * Admin may not mint one here. An admin-level key is issued from the admin
 * page, where its label and limits are chosen on purpose (decision 25).
 */

const HOUR_MS = 60 * 60 * 1000

/** Runs one visitor key may start in an hour. */
export const VISITOR_KEY_RUNS_PER_HOUR = 10
/** Keys the dashboard will mint in an hour, across every visitor. */
export const VISITOR_KEYS_PER_HOUR = 40
/** Live keys one sandbox may hold that its visitor minted. */
export const VISITOR_KEYS_PER_SANDBOX = 5
export const VISITOR_KEY_MAX_WORKERS = 2
export const VISITOR_KEY_REFS = ['main'] as const

export type Issued =
  | {
      ok: true
      plaintext: string
      expiresAt: string
      limits: { runsPerHour: number; maxWorkers: number; refs: string[]; simulated: true }
    }
  | {
      ok: false
      error: string
      /** Seconds until the limit that refused this has room, for `Retry-After`. */
      retryAfter: number
    }

/**
 * Mint a key for this sandbox, unless enough have been issued.
 *
 * Refused with a message that says which limit and when it lifts, rather than
 * a bare 429: the visitor has done nothing wrong.
 */
export async function issueVisitorKey(
  env: Bindings,
  sandbox: { id: string; expires_at: string },
  role: Exclude<Role, 'admin'>,
  now: number = Date.now(),
): Promise<Issued> {
  const hourAgo = new Date(now - HOUR_MS).toISOString()

  const [recent, live] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM api_keys WHERE sandbox = 1 AND created_at > ?1`)
      .bind(hourAgo)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM api_keys
        WHERE sandbox = 1 AND sandbox_id = ?1 AND revoked_at IS NULL`,
    )
      .bind(sandbox.id)
      .first<{ n: number }>(),
  ])

  if ((recent?.n ?? 0) >= VISITOR_KEYS_PER_HOUR) {
    return {
      ok: false,
      retryAfter: await secondsUntilRoom(
        env.DB,
        {
          from: 'api_keys',
          where: 'sandbox = 1 AND created_at > ?1',
          column: 'created_at',
          params: [hourAgo],
          count: recent?.n ?? 0,
          limit: VISITOR_KEYS_PER_HOUR,
          holdMs: HOUR_MS,
          atMostMs: HOUR_MS,
        },
        now,
      ),
      error:
        'Keys have been issued as fast as they are allowed this hour. Try again within the hour — ' +
        'or clone the repo and run it locally with no limit.',
    }
  }
  if ((live?.n ?? 0) >= VISITOR_KEYS_PER_SANDBOX) {
    return {
      ok: false,
      retryAfter: Math.ceil((Date.parse(sandbox.expires_at) - now) / 1000),
      error: `This sandbox already holds ${VISITOR_KEYS_PER_SANDBOX} keys. Revoke one to make another.`,
    }
  }

  const { row, plaintext } = await mintKey(env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, {
    label: 'terminal',
    role,
    allowedRefs: [...VISITOR_KEY_REFS],
    maxWorkers: VISITOR_KEY_MAX_WORKERS,
    createdBy: 'self-serve',
  })

  await env.DB.prepare(
    `INSERT INTO api_keys
       (id, hash, label, role, allowed_refs, max_workers, created_by, created_at, expires_at,
        sandbox, sandbox_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)`,
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
      sandbox.expires_at,
      sandbox.id,
    )
    .run()

  return {
    ok: true,
    plaintext,
    expiresAt: sandbox.expires_at,
    limits: {
      runsPerHour: VISITOR_KEY_RUNS_PER_HOUR,
      maxWorkers: VISITOR_KEY_MAX_WORKERS,
      refs: [...VISITOR_KEY_REFS],
      simulated: true,
    },
  }
}

/**
 * Whether a key has used its runs for the hour, and if so, how long until it
 * has room. Counted from the runs table by the key's id, which `POST /runs`
 * already writes for every run a key starts; no counter to keep in step.
 */
export async function visitorKeyWait(
  db: D1Database,
  keyId: string,
  now: number = Date.now(),
): Promise<number | null> {
  const since = new Date(now - HOUR_MS).toISOString()
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM runs WHERE api_key_id = ?1 AND started_at > ?2`)
    .bind(keyId, since)
    .first<{ n: number }>()
  const count = row?.n ?? 0
  if (count < VISITOR_KEY_RUNS_PER_HOUR) return null
  return secondsUntilRoom(
    db,
    {
      from: 'runs',
      where: 'api_key_id = ?1 AND started_at > ?2',
      column: 'started_at',
      params: [keyId, since],
      count,
      limit: VISITOR_KEY_RUNS_PER_HOUR,
      holdMs: HOUR_MS,
      atMostMs: HOUR_MS,
    },
    now,
  )
}

/** Simulated runs from before sandboxes, which no visitor can see, kept a week. */
export const OLD_DEMO_RUN_RETENTION_MS = 7 * 24 * HOUR_MS

/**
 * Remove the simulated runs left from before sandboxes existed. They have no
 * sandbox, so no visitor sees them, and nothing points at them; they are kept
 * only until the week the old retention promised has passed.
 */
export async function pruneOldDemoRuns(db: D1Database, now: number = Date.now()): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM runs WHERE sandbox_id IS NULL AND simulated = 1 AND started_at < ?1`)
    .bind(new Date(now - OLD_DEMO_RUN_RETENTION_MS).toISOString())
    .run()
  return result.meta.changes
}
