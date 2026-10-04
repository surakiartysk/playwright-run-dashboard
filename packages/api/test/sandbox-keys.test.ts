import { createExecutionContext, env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { as, migrate, request } from './helpers'
import {
  DEMO_RUN_RETENTION_MS,
  SANDBOX_ACTIVE_MAX,
  SANDBOX_KEYS_PER_HOUR,
  SANDBOX_RUNS_PER_HOUR,
  SANDBOX_TTL_MS,
  issueSandboxKey,
  pruneSandbox,
  sandboxKeyIsSpent,
} from '../src/sandbox'
import { verifyKey, parseKey, type ApiKeyRow } from '../src/apiKeys'
import { hmacHex } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'
import worker from '../src/index'

beforeAll(migrate)

/**
 * A key a visitor mints for themselves — the demo role's own.
 *
 * What is held here is that it costs nothing: it can only simulate, it expires,
 * one key cannot use the whole shared allowance, and the dashboard will not mint
 * without limit. The limits are shared rather than per visitor for the reason
 * the public demo's are (decision 22): a demo session has no identity to count.
 */

const mint = async () => {
  const response = await as('demo', '/demo/keys', { method: 'POST' })
  return {
    response,
    body: (await response.json()) as {
      key: string
      expiresAt: string
      limits: { runsPerHour: number; maxWorkers: number; refs: string[]; simulated: boolean }
    },
  }
}

const withKey = (key: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
})

describe('POST /demo/keys', () => {
  beforeEach(async () => {
    // The caps are shared across the file's tests; each starts from none issued.
    await env.DB.prepare(`DELETE FROM api_keys WHERE sandbox = 1`).run()
  })

  it('gives a demo session a key, once, with what it may do', async () => {
    const { response, body } = await mint()
    expect(response.status).toBe(201)
    expect(body.key).toMatch(/^rdk_[0-9a-z]+_[0-9a-z]+$/)
    expect(body.limits).toEqual({
      runsPerHour: SANDBOX_RUNS_PER_HOUR,
      maxWorkers: 2,
      refs: ['main'],
      simulated: true,
    })
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(SANDBOX_TTL_MS - 60_000)
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(SANDBOX_TTL_MS)
  })

  it('stores a digest, never the key', async () => {
    const { body } = await mint()
    const secret = parseKey(body.key)!.secret
    const row = await env.DB.prepare(`SELECT * FROM api_keys WHERE id = ?1`)
      .bind(parseKey(body.key)!.id)
      .first<ApiKeyRow>()
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(row).toMatchObject({ role: 'demo', sandbox: 1, label: 'sandbox', max_workers: 2 })
    expect(row!.allowed_refs).toBe('main')
  })

  it.each(['dev', 'qa', 'admin'] as const)(
    'is not for %s, who have the admin panel',
    async (role) => {
      expect((await as(role, '/demo/keys', { method: 'POST' })).status).toBe(403)
    },
  )

  it('needs a session', async () => {
    expect((await request('/demo/keys', { method: 'POST' })).status).toBe(401)
  })

  /** A key cannot mint a key (decision 25), a sandbox key included. */
  it('is refused to a key', async () => {
    const { body } = await mint()
    const again = await request('/demo/keys', withKey(body.key, { method: 'POST' }))
    expect(again.status).toBe(403)
  })
})

describe('what a sandbox key can do', () => {
  it('starts a simulated run on main, as the demo role', async () => {
    const { body } = await mint()
    const response = await request(
      '/runs',
      withKey(body.key, {
        method: 'POST',
        body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main', workers: 2 }),
      }),
    )
    expect(response.status).toBe(201)
    expect(((await response.json()) as { simulated: boolean }).simulated).toBe(true)
  })

  it('marks the run as a key’s, so the page can say a script started it', async () => {
    const { body } = await mint()
    const started = await request(
      '/runs',
      withKey(body.key, {
        method: 'POST',
        body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main', workers: 2 }),
      }),
    )
    const { runId } = (await started.json()) as { runId: string }
    const fromPage = await as('demo', '/runs', {
      method: 'POST',
      body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main', workers: 1 }),
    })
    const { runId: pageRunId } = (await fromPage.json()) as { runId: string }

    const list = (await (await as('demo', '/runs?limit=50')).json()) as {
      runs: { id: string; viaKey: boolean; startedBy: string | null }[]
    }
    expect(list.runs.find((r) => r.id === runId)?.viaKey).toBe(true)
    expect(list.runs.find((r) => r.id === pageRunId)?.viaKey).toBe(false)

    const one = (await (await as('demo', `/runs/${runId}`)).json()) as { viaKey: boolean }
    expect(one.viaKey).toBe(true)
    // A flag only: nothing on the row names the key.
    expect(JSON.stringify(list)).not.toContain(parseKey(body.key)!.id)
  })

  it('is refused another branch, and more than two workers', async () => {
    const { body } = await mint()
    const post = (extra: object) =>
      request(
        '/runs',
        withKey(body.key, {
          method: 'POST',
          body: JSON.stringify({ service: 'items', tags: 'all', ...extra }),
        }),
      )
    expect((await post({ ref: 'develop' })).status).toBe(403)
    expect((await post({ workers: 3 })).status).toBe(403)
  })

  it('cannot reach the admin surfaces', async () => {
    const { body } = await mint()
    expect((await request('/keys', withKey(body.key))).status).toBe(403)
    expect((await request('/gate', withKey(body.key, { method: 'PUT', body: '{}' }))).status).toBe(
      403,
    )
  })

  it('is told what it may use by /runs/options, and that it is simulated', async () => {
    const { body } = await mint()
    const options = (await (await request('/runs/options', withKey(body.key))).json()) as {
      role: string
      simulated: boolean
      maxWorkers: number
      suites: { api: { refs: string[] } }
    }
    expect(options).toMatchObject({ role: 'demo', simulated: true, maxWorkers: 2 })
    expect(options.suites.api.refs).toEqual(['main'])
  })
})

describe('the limits', () => {
  it('lets one key start only so many runs in an hour', async () => {
    const { body } = await mint()
    const id = parseKey(body.key)!.id
    for (let i = 0; i < SANDBOX_RUNS_PER_HOUR; i++) {
      await env.DB.prepare(
        `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at, api_key_id)
         VALUES (?1, 'items', 'all', 'demo', 'passed', 'main', ?2, ?3)`,
      )
        .bind(`sandbox-${id}-${i}`, new Date().toISOString(), id)
        .run()
    }
    const response = await request(
      '/runs',
      withKey(body.key, {
        method: 'POST',
        body: JSON.stringify({ service: 'items', tags: 'all' }),
      }),
    )
    expect(response.status).toBe(429)
    expect(((await response.json()) as { error: string }).error).toContain('sandbox key')
  })

  it('counts an hour, not for ever', async () => {
    const id = 'spentkey'
    for (let i = 0; i < SANDBOX_RUNS_PER_HOUR; i++) {
      await env.DB.prepare(
        `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at, api_key_id)
         VALUES (?1, 'items', 'all', 'demo', 'passed', 'main', ?2, ?3)`,
      )
        .bind(`old-${id}-${i}`, new Date(Date.now() - 2 * 3600_000).toISOString(), id)
        .run()
    }
    expect(await sandboxKeyIsSpent(env.DB, id)).toBe(false)
  })

  it('is per key: one spent key does not stop another', async () => {
    expect(await sandboxKeyIsSpent(env.DB, 'someone-else')).toBe(false)
  })

  it('stops minting once an hour’s worth have been issued, and says when to come back', async () => {
    await env.DB.prepare(`DELETE FROM api_keys WHERE sandbox = 1`).run()
    for (let i = 0; i < SANDBOX_KEYS_PER_HOUR; i++) {
      expect((await issueSandboxKey(env)).ok).toBe(true)
    }
    const over = await issueSandboxKey(env)
    expect(over).toMatchObject({ ok: false })
    expect((over as { error: string }).error).toContain('within the hour')
    expect((await as('demo', '/demo/keys', { method: 'POST' })).status).toBe(429)
  })

  it('stops minting at the live cap, and not before', async () => {
    await env.DB.prepare(`DELETE FROM api_keys WHERE sandbox = 1`).run()
    const old = new Date(Date.now() - 3 * 3600_000).toISOString()
    const future = new Date(Date.now() + 3600_000).toISOString()
    const insert = env.DB.prepare(
      `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, expires_at, sandbox)
       VALUES (?1, 'x', 'sandbox', 'demo', 'demo-session', ?2, ?3, 1)`,
    )
    await env.DB.batch(
      Array.from({ length: SANDBOX_ACTIVE_MAX - 1 }, (_, i) =>
        insert.bind(`live${i}`, old, future),
      ),
    )
    expect((await issueSandboxKey(env)).ok).toBe(true)
    const over = await issueSandboxKey(env)
    expect(over).toMatchObject({ ok: false })
    expect((over as { error: string }).error).toContain('live')
  })

  it('does not count a revoked key against the cap', async () => {
    await env.DB.prepare(`DELETE FROM api_keys WHERE sandbox = 1`).run()
    const old = new Date(Date.now() - 3 * 3600_000).toISOString()
    const future = new Date(Date.now() + 3600_000).toISOString()
    const insert = env.DB.prepare(
      `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, expires_at, revoked_at, sandbox)
       VALUES (?1, 'x', 'sandbox', 'demo', 'demo-session', ?2, ?3, ?2, 1)`,
    )
    await env.DB.batch(
      Array.from({ length: SANDBOX_ACTIVE_MAX }, (_, i) => insert.bind(`revoked${i}`, old, future)),
    )
    expect((await issueSandboxKey(env)).ok).toBe(true)
  })

  /** The hourly allowance is for keys visitors minted, not for the ones an admin issued. */
  it('does not count an admin’s keys against the hourly allowance', async () => {
    await env.DB.prepare(`DELETE FROM api_keys WHERE sandbox = 1`).run()
    const recent = new Date().toISOString()
    const insert = env.DB.prepare(
      `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, sandbox)
       VALUES (?1, 'x', 'pipeline', 'qa', 'admin', ?2, 0)`,
    )
    await env.DB.batch(
      Array.from({ length: SANDBOX_KEYS_PER_HOUR + 5 }, (_, i) =>
        insert.bind(`adminkey${i}`, recent),
      ),
    )
    expect((await issueSandboxKey(env)).ok).toBe(true)
  })

  it('does not count an expired key against the cap', async () => {
    await env.DB.prepare(`DELETE FROM api_keys WHERE sandbox = 1`).run()
    const old = new Date(Date.now() - 3 * 3600_000).toISOString()
    const past = new Date(Date.now() - 1000).toISOString()
    const insert = env.DB.prepare(
      `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, expires_at, sandbox)
       VALUES (?1, 'x', 'sandbox', 'demo', 'demo-session', ?2, ?3, 1)`,
    )
    await env.DB.batch(
      Array.from({ length: SANDBOX_ACTIVE_MAX }, (_, i) => insert.bind(`dead${i}`, old, past)),
    )
    expect((await issueSandboxKey(env)).ok).toBe(true)
  })
})

describe('expiry', () => {
  const stored = async (over: Partial<ApiKeyRow>): Promise<ApiKeyRow> => ({
    id: 'k',
    hash: await hmacHex(DEV_TOKEN_SECRET, 'secretpart'),
    label: 'sandbox',
    role: 'demo',
    allowed_refs: null,
    max_workers: null,
    created_by: 'demo-session',
    created_at: '2026-01-01T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    sandbox: 1,
    ...over,
  })
  const now = Date.parse('2026-10-04T12:00:00Z')

  it('refuses a key at the instant it expires, and accepts one a moment before', async () => {
    const at = await stored({ expires_at: '2026-10-04T12:00:00.000Z' })
    const before = await stored({ expires_at: '2026-10-04T12:00:00.001Z' })
    expect(await verifyKey(DEV_TOKEN_SECRET, at, 'secretpart', now)).toBe(false)
    expect(await verifyKey(DEV_TOKEN_SECRET, before, 'secretpart', now)).toBe(true)
  })

  it('never expires a key that carries no expiry', async () => {
    expect(await verifyKey(DEV_TOKEN_SECRET, await stored({}), 'secretpart', now)).toBe(true)
  })

  it('still refuses a wrong secret, and a revoked key, before a live one', async () => {
    expect(await verifyKey(DEV_TOKEN_SECRET, await stored({}), 'wrong', now)).toBe(false)
    expect(
      await verifyKey(
        DEV_TOKEN_SECRET,
        await stored({ revoked_at: '2026-10-01T00:00:00Z' }),
        'secretpart',
        now,
      ),
    ).toBe(false)
  })

  it('is enforced on a real request, not only in the function', async () => {
    const { body } = await mint()
    const id = parseKey(body.key)!.id
    await env.DB.prepare(`UPDATE api_keys SET expires_at = ?2 WHERE id = ?1`)
      .bind(id, new Date(Date.now() - 1000).toISOString())
      .run()
    expect((await request('/runs/options', withKey(body.key))).status).toBe(401)
  })
})

describe('where sandbox keys show', () => {
  it('not in the admin’s list of credentials', async () => {
    const { body } = await mint()
    const id = parseKey(body.key)!.id
    const list = (await (await as('admin', '/keys')).json()) as { keys: { id: string }[] }
    expect(list.keys.map((k) => k.id)).not.toContain(id)
  })

  it('but an admin’s own key still is', async () => {
    const made = (await (
      await as('admin', '/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'visible pipeline', role: 'qa' }),
      })
    ).json()) as { key: { id: string } }
    const list = (await (await as('admin', '/keys')).json()) as { keys: { id: string }[] }
    expect(list.keys.map((k) => k.id)).toContain(made.key.id)
  })
})

describe('pruneSandbox', () => {
  const now = Date.now()

  it('removes a sandbox key a day past expiry, and keeps a younger one', async () => {
    const insert = (id: string, expires: number, sandbox: 0 | 1) =>
      env.DB.prepare(
        `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, expires_at, sandbox)
         VALUES (?1, 'x', 'k', 'demo', 'c', ?2, ?3, ?4)`,
      )
        .bind(
          id,
          new Date(now - 3 * 86400_000).toISOString(),
          new Date(expires).toISOString(),
          sandbox,
        )
        .run()
    await insert('prune-old', now - 2 * 86400_000, 1)
    await insert('prune-recent', now - 3600_000, 1)
    await insert('prune-real', now - 2 * 86400_000, 0)

    await pruneSandbox(env.DB, now)
    const left = await env.DB.prepare(`SELECT id FROM api_keys WHERE id LIKE 'prune-%'`).all<{
      id: string
    }>()
    expect(left.results.map((r) => r.id).sort()).toEqual(['prune-real', 'prune-recent'])
  })

  it('removes demo runs past a week, and nobody else’s', async () => {
    const insert = (id: string, role: string, ageMs: number) =>
      env.DB.prepare(
        `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at)
         VALUES (?1, 'items', 'all', ?2, 'passed', 'main', ?3)`,
      )
        .bind(id, role, new Date(now - ageMs).toISOString())
        .run()
    await insert('prune-demo-old', 'demo', DEMO_RUN_RETENTION_MS + 1000)
    await insert('prune-demo-new', 'demo', DEMO_RUN_RETENTION_MS - 60_000)
    await insert('prune-qa-old', 'qa', DEMO_RUN_RETENTION_MS * 4)

    const removed = await pruneSandbox(env.DB, now)
    expect(removed.runs).toBeGreaterThanOrEqual(1)
    const left = await env.DB.prepare(`SELECT id FROM runs WHERE id LIKE 'prune-%'`).all<{
      id: string
    }>()
    expect(left.results.map((r) => r.id).sort()).toEqual(['prune-demo-new', 'prune-qa-old'])
  })

  /** Said in days, not through the constant, so the number itself is pinned. */
  it('keeps a demo run for a week: six days old stays, eight days old goes', async () => {
    const insert = (id: string, days: number) =>
      env.DB.prepare(
        `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at)
         VALUES (?1, 'items', 'all', 'demo', 'passed', 'main', ?2)`,
      )
        .bind(id, new Date(now - days * 86400_000).toISOString())
        .run()
    await insert('week-six', 6)
    await insert('week-eight', 8)
    await pruneSandbox(env.DB, now)
    const left = await env.DB.prepare(`SELECT id FROM runs WHERE id LIKE 'week-%'`).all<{
      id: string
    }>()
    expect(left.results.map((r) => r.id)).toEqual(['week-six'])
  })

  it('says how many it removed', async () => {
    const r = await pruneSandbox(env.DB, now)
    expect(r).toEqual({ keys: expect.any(Number), runs: expect.any(Number) })
  })
})

/**
 * The property the whole feature rests on: a key anyone can mint can never reach
 * GitHub. A real deployment, a real token, `SIMULATE_DISPATCH` off — and a
 * sandbox key's run still does not call out, because the key is the demo role's
 * and `simulates()` puts that role first (decision 12). Held by a stub on
 * `fetch`, which a dispatch would have to call.
 */
describe('a sandbox key on a real deployment', () => {
  afterEach(() => vi.unstubAllGlobals())

  const SECRET = 'test-only-secret-for-a-real-looking-deployment'
  const real = {
    ...env,
    SIMULATE_DISPATCH: 'false',
    WEBHOOK_SECRET: SECRET,
    TOKEN_SECRET: SECRET,
    ADMIN_PASSWORD: 'a',
    QA_PASSWORD: 'q',
    DEV_PASSWORD: 'd',
    GITHUB_TOKEN: 'ghp_real_looking',
    GITHUB_REPO: 'o/api',
    GITHUB_WORKFLOW: 'on-demand.yml',
    GITHUB_UI_REPO: 'o/ui',
    GITHUB_UI_WORKFLOW: 'on-demand.yml',
  }

  it('never reaches GitHub, for either suite, however it asks', async () => {
    const stub = vi.fn(async () => new Response('should not be called', { status: 500 }))
    vi.stubGlobal('fetch', stub)

    const issued = await issueSandboxKey(real)
    if (!issued.ok) throw new Error(issued.error)

    for (const suite of ['api', 'ui']) {
      const response = await worker.fetch(
        new Request('http://api.test/runs', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${issued.plaintext}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ suite, service: 'all', tags: 'all', ref: 'main' }),
        }),
        real,
        createExecutionContext(),
      )
      expect(response.status, suite).toBe(201)
      expect(((await response.json()) as { simulated: boolean }).simulated, suite).toBe(true)
    }
    expect(stub).not.toHaveBeenCalled()
  })
})
