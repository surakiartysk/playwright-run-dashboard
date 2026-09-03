import {
  env,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import worker from '../src/index'
import { hmacHex } from '../src/crypto'
import { createToken } from '../src/auth'
import { DEV_TOKEN_SECRET, DEV_WEBHOOK_SECRET } from '../src/config'
import type { Bindings, Role, RunStatus } from '../src/types'

/**
 * Shared setup for the Worker tests.
 *
 * Every test drives the exported `fetch` handler rather than importing a route
 * function directly. Calling the handler is what a caller does, and it is the
 * only way the middleware chain — session lookup, then the role gate — is
 * exercised at all. Importing the handler from underneath its middleware would
 * skip precisely the part most worth testing.
 */

declare global {
  // `env` in tests is typed as `Cloudflare.Env`. Declaring the Worker's own
  // bindings here is what makes `env.DB` and `env.REPORTS` real to the type
  // checker rather than something each test has to cast.
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

/**
 * Applies the schema, once per file.
 *
 * The migrations are guarded by their own bookkeeping table, so calling this
 * repeatedly is a no-op rather than an error. It does *not* clear data: tests
 * share the database within a file and isolate themselves by seeding unique
 * rows — see the note in vitest.config.ts.
 */
export const migrate = () => applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

/**
 * Calls the Worker the way the network would.
 *
 * The response is returned as soon as the handler produces it, without waiting
 * on `waitUntil`. `POST /runs` schedules the simulator there, and the simulator
 * deliberately sleeps for several seconds walking a run through its states — a
 * test that waited for it would be testing `setTimeout`. Tests that care about
 * what the simulator eventually writes use `settle` instead.
 */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext()
  return worker.fetch(new Request(`http://api.test${path}`, init), env, ctx)
}

/**
 * Calls the Worker and waits for its background work to finish.
 *
 * Only for tests that assert on what `waitUntil` produced. Slow by nature —
 * the simulator sleeps on purpose so a person watching sees the transition.
 */
export async function settle(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext()
  const response = await worker.fetch(new Request(`http://api.test${path}`, init), env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

/** A valid session cookie for a role, without going through the login form. */
export async function sessionFor(role: Role): Promise<string> {
  const { token } = await createToken(DEV_TOKEN_SECRET, role)
  return `session=${token}`
}

/** `request`, with a signed-in role attached. */
export const as = async (role: Role, path: string, init: RequestInit = {}) =>
  request(path, {
    ...init,
    headers: { Cookie: await sessionFor(role), ...(init.headers ?? {}) },
  })

/**
 * Posts a webhook the way the workflow does.
 *
 * Signing lives here rather than in each test so a test cannot accidentally
 * assert against a signature scheme it invented — the helper signs
 * `timestamp.body` exactly as the route verifies it.
 */
export async function postWebhook(
  body: unknown,
  options: { timestamp?: number; secret?: string; signature?: string } = {},
): Promise<Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const signature =
    options.signature ??
    (await hmacHex(options.secret ?? DEV_WEBHOOK_SECRET, `${timestamp}.${raw}`))

  return request('/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Timestamp': String(timestamp),
      'X-Webhook-Signature': signature,
    },
    body: raw,
  })
}

/**
 * A service name unique to one test.
 *
 * Runs seeded under it cannot be confused with any other test's, which is what
 * makes a shared database safe to assert against — the alternative, asserting
 * on totals, passes or fails depending on what else ran.
 */
export const uniqueService = () => `svc-${Math.random().toString(36).slice(2, 10)}`

/**
 * Inserts a run directly.
 *
 * Tests that are about reading do not go through `POST /runs` to get their
 * fixtures: that would couple every read test to the create path's validation
 * and to the simulator firing in the background.
 */
export async function seedRun(
  overrides: Partial<{
    id: string
    service: string
    tags: string
    ref: string
    status: RunStatus
    triggeredBy: Role
    reportPath: string | null
    startedAt: string
  }> = {},
): Promise<string> {
  const row = {
    id: `20260101-0000-${Math.random().toString(36).slice(2, 10)}`,
    service: 'items',
    tags: 'smoke',
    ref: 'main',
    status: 'queued' as RunStatus,
    triggeredBy: 'qa' as Role,
    reportPath: null,
    startedAt: new Date().toISOString(),
    ...overrides,
  }

  await env.DB.prepare(
    `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at, report_path)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      row.id,
      row.service,
      row.tags,
      row.triggeredBy,
      row.status,
      row.ref,
      row.startedAt,
      row.reportPath,
    )
    .run()

  return row.id
}

export const statusOf = async (id: string): Promise<string | undefined> =>
  (
    await env.DB.prepare(`SELECT status FROM runs WHERE id = ?1`)
      .bind(id)
      .first<{ status: string }>()
  )?.status

/** Every run recorded for one service, newest first. */
export const runsForService = async (service: string) =>
  (
    await env.DB.prepare(
      `SELECT id, ref, status, triggered_by FROM runs WHERE service = ?1 ORDER BY started_at DESC`,
    )
      .bind(service)
      .all<{ id: string; ref: string; status: string; triggered_by: string }>()
  ).results
