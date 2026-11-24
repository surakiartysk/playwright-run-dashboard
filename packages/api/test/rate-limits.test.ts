import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { as, makeTestSandbox, migrate, request, seedRun, settle, sharedSandbox } from './helpers'
import {
  VISITOR_KEYS_PER_HOUR,
  VISITOR_KEYS_PER_SANDBOX,
  VISITOR_KEY_RUNS_PER_HOUR,
  issueVisitorKey,
} from '../src/visitorKeys'
import { SANDBOX_RUNS_PER_HOUR } from '../src/routes/runs'
import { SANDBOXES_ALIVE_MAX, SANDBOXES_PER_HOUR, makeSandbox } from '../src/sandboxes'
import { LAST_USED_GRANULARITY_MS, lastUsedIsStale } from '../src/auth'
import { parseKey } from '../src/apiKeys'
import { secondsUntilRoom } from '../src/retry'

beforeAll(migrate)

/**
 * What a limited caller is told about when to come back, and what a key's use
 * costs the database.
 *
 * "Within the hour" is not an answer a script can act on: a limit that counts a
 * sliding hour opens when the oldest counted row ages out, which may be a minute
 * away. The wait is computed from the rows themselves, so it is exact — these
 * tests build the rows to a known age and check the number.
 */

const MIN = 60_000
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString()
const ahead = (minutes: number) => new Date(Date.now() + minutes * MIN).toISOString()

/** A few seconds' slack: the clock moves between building the rows and asking. */
const near = (actual: number, expected: number) => {
  expect(actual).toBeGreaterThanOrEqual(expected - 5)
  expect(actual).toBeLessThanOrEqual(expected)
}

const retryAfter = (response: Response) => Number(response.headers.get('Retry-After'))

const mintKey = async () => {
  const response = await as('dev', '/demo/keys', { method: 'POST' })
  return ((await response.json()) as { key: string }).key
}

const postRun = (key: string) =>
  request('/runs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main', workers: 1 }),
  })

const insertKeyRun = (id: string, keyId: string, startedAt: string) =>
  env.DB.prepare(
    `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at, api_key_id)
     VALUES (?1, 'items', 'all', 'dev', 'passed', 'main', ?2, ?3)`,
  )
    .bind(id, startedAt, keyId)
    .run()

describe('Retry-After on a spent key', () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM runs`).run()
    await env.DB.prepare(`DELETE FROM api_keys`).run()
  })

  it('is the time until the oldest counted run is an hour old', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    // Ten runs, the oldest fifty minutes ago: ten more minutes to wait.
    for (let i = 0; i < VISITOR_KEY_RUNS_PER_HOUR; i++) {
      await insertKeyRun(`r-${i}`, id, ago(50 - i))
    }
    const response = await postRun(key)
    expect(response.status).toBe(429)
    near(retryAfter(response), 10 * 60)
  })

  /** Over the limit by two: the third-oldest has to age out before there is room. */
  it('waits for as many to age out as it takes to get under, not just the oldest', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    // 12 runs at 55, 53, 51, ... minutes ago. Two too many, so the third-oldest
    // (51 minutes) is the one that opens room: nine minutes.
    for (let i = 0; i < 12; i++) await insertKeyRun(`o-${i}`, id, ago(55 - 2 * i))
    const response = await postRun(key)
    expect(response.status).toBe(429)
    near(retryAfter(response), 9 * 60)
  })

  it('counts only this key’s runs', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    for (let i = 0; i < VISITOR_KEY_RUNS_PER_HOUR; i++) await insertKeyRun(`mine-${i}`, id, ago(30))
    for (let i = 0; i < 3; i++) await insertKeyRun(`theirs-${i}`, 'another', ago(59))
    near(retryAfter(await postRun(key)), 30 * 60)
  })
})

describe('Retry-After on a sandbox’s run limit', () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM runs`).run()
  })

  const start = () =>
    as('dev', '/runs', {
      method: 'POST',
      body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main' }),
    })

  it('is the time until the oldest of the sandbox’s runs this hour is an hour old', async () => {
    const { id } = await sharedSandbox()
    for (let i = 0; i < SANDBOX_RUNS_PER_HOUR; i++) {
      await seedRun({ sandboxId: id, startedAt: ago(45 - i / 2) })
    }
    const response = await start()
    expect(response.status).toBe(429)
    near(retryAfter(response), 15 * 60)
  })

  it('works the wait out from this sandbox’s runs alone, not a real run older still', async () => {
    const { id } = await sharedSandbox()
    await seedRun({ startedAt: ago(59) })
    for (let i = 0; i < SANDBOX_RUNS_PER_HOUR; i++) {
      await seedRun({ sandboxId: id, startedAt: ago(45 - i / 2) })
    }
    near(retryAfter(await start()), 15 * 60)
  })

  /** One visitor's runs do not use up another's. */
  it('does not count another sandbox’s runs', async () => {
    const other = await makeTestSandbox()
    for (let i = 0; i < SANDBOX_RUNS_PER_HOUR; i++) {
      await seedRun({ sandboxId: other.id, startedAt: ago(10) })
    }
    const response = await start()
    expect(response.status).toBe(201)
    expect(response.headers.get('Retry-After')).toBeNull()
  })
})

describe('Retry-After on minting', () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM api_keys`).run()
  })

  const insertKey = (id: string, createdAt: string, sandboxId = 'elsewhere') =>
    env.DB.prepare(
      `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, expires_at, sandbox, sandbox_id)
       VALUES (?1, 'x', 'terminal', 'dev', 'self-serve', ?2, ?3, 1, ?4)`,
    )
      .bind(id, createdAt, ahead(600), sandboxId)
      .run()

  it('is the time until the oldest key of this hour is an hour old', async () => {
    for (let i = 0; i < VISITOR_KEYS_PER_HOUR; i++) await insertKey(`k${i}`, ago(40 - i / 4))
    const refused = await issueVisitorKey(env, await sharedSandbox(), 'dev')
    expect(refused.ok).toBe(false)
    near((refused as { retryAfter: number }).retryAfter, 20 * 60)

    const response = await as('dev', '/demo/keys', { method: 'POST' })
    expect(response.status).toBe(429)
    near(retryAfter(response), 20 * 60)
  })

  it('works the wait out from visitors’ keys alone, not an admin’s older one', async () => {
    await env.DB.prepare(
      `INSERT INTO api_keys (id, hash, label, role, created_by, created_at, sandbox)
       VALUES ('admins', 'x', 'ci', 'qa', 'admin', ?1, 0)`,
    )
      .bind(ago(59))
      .run()
    for (let i = 0; i < VISITOR_KEYS_PER_HOUR; i++) await insertKey(`k${i}`, ago(40 - i / 4))
    const refused = await issueVisitorKey(env, await sharedSandbox(), 'dev')
    near((refused as { retryAfter: number }).retryAfter, 20 * 60)
  })

  it('refuses a sandbox that holds its share of keys, until one is revoked', async () => {
    const sandbox = await makeTestSandbox()
    for (let i = 0; i < VISITOR_KEYS_PER_SANDBOX; i++)
      await insertKey(`mine${i}`, ago(300), sandbox.id)
    const refused = await issueVisitorKey(env, sandbox, 'dev')
    expect(refused).toMatchObject({ ok: false })
    expect((refused as { error: string }).error).toMatch(/Revoke one/)

    await env.DB.prepare(`UPDATE api_keys SET revoked_at = ?1 WHERE id = 'mine0'`)
      .bind(ago(0))
      .run()
    expect((await issueVisitorKey(env, sandbox, 'dev')).ok).toBe(true)
  })
})

describe('Retry-After on making a sandbox', () => {
  beforeEach(async () => {
    const { id } = await sharedSandbox()
    await env.DB.prepare(`DELETE FROM sandboxes WHERE id != ?1`).bind(id).run()
  })

  const insertSandbox = (id: string, createdAt: string, expiresAt: string) =>
    env.DB.prepare(`INSERT INTO sandboxes (id, created_at, expires_at) VALUES (?1, ?2, ?3)`)
      .bind(id, createdAt, expiresAt)
      .run()

  it('is the time until the oldest sandbox of this hour is an hour old', async () => {
    // One fewer: the file's own sandbox was made this hour and is alive.
    for (let i = 0; i < SANDBOXES_PER_HOUR - 1; i++)
      await insertSandbox(`s${i}`, ago(40 - i / 10), ahead(600))
    const refused = await makeSandbox(env)
    expect(refused.ok).toBe(false)
    near((refused as { retryAfter: number }).retryAfter, 20 * 60)

    const response = await request('/auth/demo', { method: 'POST' })
    expect(response.status).toBe(429)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  /** Room at the alive cap opens when a sandbox expires, not when an hour passes. */
  it('is the time until the soonest sandbox expires, at the alive cap', async () => {
    for (let i = 0; i < SANDBOXES_ALIVE_MAX - 1; i++)
      await insertSandbox(`a${i}`, ago(300), ahead(120 + i))
    const refused = await makeSandbox(env)
    expect(refused.ok).toBe(false)
    const seconds = (refused as { retryAfter: number }).retryAfter
    expect(seconds).toBeGreaterThan(100 * 60)
    near(seconds, 120 * 60)
  })
})

describe('secondsUntilRoom', () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM runs`).run()
  })

  const ask = (over: Partial<Parameters<typeof secondsUntilRoom>[1]> = {}, now?: number) =>
    secondsUntilRoom(
      env.DB,
      {
        from: 'runs',
        where: `triggered_by = 'ci'`,
        column: 'started_at',
        params: [],
        count: 1,
        limit: 1,
        holdMs: 60 * MIN,
        atMostMs: 60 * MIN,
        ...over,
      },
      now,
    )

  it('is at least a second, never an invitation to retry at once', async () => {
    await seedRun({ startedAt: ago(61) })
    expect(await ask()).toBe(1)
  })

  it('is never more than the window', async () => {
    await seedRun({ startedAt: ahead(30) })
    expect(await ask()).toBe(3600)
  })

  it('answers with the longest it can be when it finds nothing to go on', async () => {
    expect(await ask()).toBe(3600)
    expect(await ask({ atMostMs: 5 * MIN })).toBe(300)
  })

  it('is capped by what the caller says is the longest, not by an hour', async () => {
    await seedRun({ startedAt: ahead(600) })
    expect(await ask({ holdMs: 0, atMostMs: 24 * 60 * MIN })).toBeGreaterThan(3600)
    expect(await ask({ holdMs: 0, atMostMs: 24 * 60 * MIN })).toBeLessThanOrEqual(600 * 60)
  })
})

describe('what using a key writes', () => {
  const lastUsed = async (id: string) =>
    (
      await env.DB.prepare(`SELECT last_used_at FROM api_keys WHERE id = ?1`)
        .bind(id)
        .first<{ last_used_at: string | null }>()
    )?.last_used_at

  const use = (key: string) =>
    settle('/runs/options', { headers: { Authorization: `Bearer ${key}` } })

  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM api_keys`).run()
  })

  it('records the first use', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    expect(await lastUsed(id)).toBeNull()
    await use(key)
    expect(await lastUsed(id)).not.toBeNull()
  })

  /** The reason for the throttle: a key hammered in a loop must not write on every request. */
  it('does not write again for a key used a moment ago', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    const recent = ago(5)
    await env.DB.prepare(`UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1`)
      .bind(id, recent)
      .run()
    for (let i = 0; i < 5; i++) await use(key)
    expect(await lastUsed(id)).toBe(recent)
  })

  it('does not write for a request that is refused', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    const recent = ago(5)
    await env.DB.prepare(`UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1`)
      .bind(id, recent)
      .run()
    for (let i = 0; i < VISITOR_KEY_RUNS_PER_HOUR; i++) await insertKeyRun(`s-${i}`, id, ago(20))
    expect((await postRun(key)).status).toBe(429)
    expect(await lastUsed(id)).toBe(recent)
  })

  it('writes again once the last record is an hour old', async () => {
    const key = await mintKey()
    const id = parseKey(key)!.id
    const stale = ago(61)
    await env.DB.prepare(`UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1`)
      .bind(id, stale)
      .run()
    await use(key)
    const after = await lastUsed(id)
    expect(after).not.toBe(stale)
    expect(Date.parse(after!)).toBeGreaterThan(Date.now() - 60_000)
  })
})

describe('lastUsedIsStale', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')

  it('is stale for a key never used', () => {
    expect(lastUsedIsStale(null, now)).toBe(true)
  })

  it('is stale at exactly the granularity, and fresh a moment before', () => {
    expect(lastUsedIsStale(new Date(now - LAST_USED_GRANULARITY_MS).toISOString(), now)).toBe(true)
    expect(lastUsedIsStale(new Date(now - LAST_USED_GRANULARITY_MS + 1).toISOString(), now)).toBe(
      false,
    )
  })

  it('treats a value that is not a time as none', () => {
    expect(lastUsedIsStale('garbage', now)).toBe(true)
  })

  it('leaves a time in the future alone', () => {
    expect(lastUsedIsStale(new Date(now + MIN).toISOString(), now)).toBe(false)
  })
})
