import {
  env,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import worker from '../src/index'
import { hmacHex } from '../src/crypto'
import { createAdminToken, createToken } from '../src/auth'
import { DEMO_DOMAIN, newSandboxId, SANDBOX_LIFETIME_MS } from '../src/sandboxes'
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
  return worker.fetch(new Request(url(path), init), env, ctx)
}

/**
 * A path on the test host over plain HTTP, as every test has always sent — or,
 * given a whole URL, that URL. The scheme is the one thing a test may need to
 * choose: cookies are `Secure` only when the request came over HTTPS.
 */
const url = (path: string) => (/^https?:\/\//.test(path) ? path : `http://api.test${path}`)

/**
 * Calls the Worker and waits for its background work to finish.
 *
 * Only for tests that assert on what `waitUntil` produced. Slow by nature —
 * the simulator sleeps on purpose so a person watching sees the transition.
 */
export async function settle(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext()
  const response = await worker.fetch(new Request(url(path), init), env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

/**
 * A sandbox made directly, with one account per role, for tests that are not
 * about signing in.
 *
 * Inserted rather than made through `POST /auth/demo`: that path is shared and
 * rate limited, and a test about runs should not fail because another file
 * made its hourly share of sandboxes.
 */
export async function makeTestSandbox(
  options: { lockdown?: boolean; expiresAt?: string } = {},
): Promise<{ id: string; expires_at: string }> {
  const id = newSandboxId()
  const now = new Date().toISOString()
  const expires_at = options.expiresAt ?? new Date(Date.now() + SANDBOX_LIFETIME_MS).toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sandboxes (id, created_at, expires_at, lockdown) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(id, now, expires_at, options.lockdown ? 1 : 0),
    env.DB.prepare(`INSERT INTO sandbox_gate (sandbox_id, mode) VALUES (?1, 'open')`).bind(id),
    ...(['admin', 'qa', 'dev'] as const).map((role) =>
      env.DB.prepare(
        `INSERT INTO members (sandbox_id, email, role, added_at, added_by) VALUES (?1, ?2, ?3, ?4, 'test')`,
      ).bind(id, emailFor(role), role, now),
    ),
  ])
  return { id, expires_at }
}

/** The account each role signs in as in a test sandbox. */
export const emailFor = (role: Role) => `${role}@${DEMO_DOMAIN}`

let shared: Promise<{ id: string; expires_at: string }> | null = null
/** One sandbox per test file, so sessions of different roles see the same runs. */
export const sharedSandbox = () => (shared ??= makeTestSandbox())

/**
 * A valid session cookie for a role, without going through sign-in.
 *
 * In the file's shared sandbox unless one is given. Admin is the account listed
 * as admin plus a valid admin cookie, exactly what unlocking with the key gives.
 */
export async function sessionFor(
  role: Role,
  sandbox?: { id: string; expires_at: string },
): Promise<string> {
  const box = sandbox ?? (await sharedSandbox())
  const { token } = await createToken(DEV_TOKEN_SECRET, box, emailFor(role))
  if (role !== 'admin') return `session=${token}`
  const admin = await createAdminToken(DEV_TOKEN_SECRET, box.id, emailFor(role))
  return `session=${token}; admin=${admin.token}`
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
    suite: 'api' | 'ui'
    triggeredBy: Role | 'ci'
    reportPath: string | null
    startedAt: string
    /** Null (the default) is a real run from a suite's CI, seen by every sandbox. */
    sandboxId: string | null
    simulated: boolean
  }> = {},
): Promise<string> {
  const row = {
    id: `20260101-0000-${Math.random().toString(36).slice(2, 10)}`,
    service: 'items',
    tags: 'smoke',
    ref: 'main',
    status: 'queued' as RunStatus,
    suite: 'api' as 'api' | 'ui',
    triggeredBy: 'ci' as Role | 'ci',
    reportPath: null,
    startedAt: new Date().toISOString(),
    sandboxId: null as string | null,
    simulated: false,
    ...overrides,
  }

  await env.DB.prepare(
    `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at, report_path, suite,
                       sandbox_id, simulated)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
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
      row.suite,
      row.sandboxId,
      row.sandboxId === null ? (row.simulated ? 1 : 0) : 1,
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

/** The row `POST /runs` answered with, by the id it returned. */
export async function createdRun(response: Response) {
  const { runId } = (await response.json()) as { runId: string }
  return env.DB.prepare(`SELECT id, ref, tags, status, triggered_by FROM runs WHERE id = ?1`)
    .bind(runId)
    .first<{ id: string; ref: string; tags: string; status: string; triggered_by: string }>()
}

/**
 * How many runs exist. For "nothing was written": `POST /runs` takes only the
 * services a suite offers, so a refused request cannot be told apart by a
 * service of its own — tests within a file run one at a time, so the count
 * before and after is the check.
 */
export const runCount = async () =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs`).first<{ n: number }>())!.n

/** Every run recorded for one service, newest first. */
export const runsForService = async (service: string) =>
  (
    await env.DB.prepare(
      `SELECT id, ref, tags, status, triggered_by FROM runs WHERE service = ?1 ORDER BY started_at DESC`,
    )
      .bind(service)
      .all<{ id: string; ref: string; tags: string; status: string; triggered_by: string }>()
  ).results
