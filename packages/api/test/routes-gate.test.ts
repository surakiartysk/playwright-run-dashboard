import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  migrate,
  as,
  emailFor,
  makeTestSandbox,
  request,
  runCount,
  sessionFor,
  sharedSandbox,
} from './helpers'

beforeAll(migrate)

// The gate is the file's sandbox's one row, so each test sets the state it needs.
const setGate = async (
  mode: string,
  opensAt: string | null = null,
  closesAt: string | null = null,
) =>
  env.DB.prepare(
    'UPDATE sandbox_gate SET mode = ?1, opens_at = ?2, closes_at = ?3 WHERE sandbox_id = ?4',
  )
    .bind(mode, opensAt, closesAt, (await sharedSandbox()).id)
    .run()

const updatedBy = async () =>
  (
    await env.DB.prepare('SELECT updated_by FROM sandbox_gate WHERE sandbox_id = ?1')
      .bind((await sharedSandbox()).id)
      .first<{ updated_by: string }>()
  )?.updated_by

beforeEach(() => setGate('open'))

const createRun = (role: 'dev' | 'qa' | 'admin', service: string) =>
  as(role, '/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, tags: 'all' }),
  })

describe('POST /runs — the gate', () => {
  it('lets dev run while the gate is open', async () => {
    expect((await createRun('dev', 'items')).status).toBe(201)
  })

  it('refuses dev with 503 while the gate is closed', async () => {
    await setGate('closed')
    const before = await runCount()

    const response = await createRun('dev', 'items')

    // 503, not 403: the request is allowed and worth retrying later.
    expect(response.status).toBe(503)
    expect(await runCount()).toBe(before)
  })

  /**
   * A freeze is when release verification happens. A gate that stopped QA
   * would be stopping the work it exists to protect.
   */
  it.each(['qa', 'admin'] as const)('still lets %s run while closed', async (role) => {
    await setGate('closed')

    expect((await createRun(role, 'items')).status).toBe(201)
  })

  it('tells dev when the gate reopens, if that is known', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await setGate('window', future, new Date(Date.now() + 7_200_000).toISOString())

    const response = await createRun('dev', 'items')
    const body = (await response.json()) as { error: string; gate: { opensAt: string } }

    expect(response.status).toBe(503)
    expect(body.gate.opensAt).toBe(future)
    expect(body.error).toContain(future)
  })

  it('lets dev run inside an open window', async () => {
    await setGate(
      'window',
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
    )

    expect((await createRun('dev', 'items')).status).toBe(201)
  })

  /**
   * The gate is checked after the policy. A dev asking for a branch they may
   * never use should be told that, not told to come back later.
   */
  it('reports a forbidden ref rather than the closed gate', async () => {
    await setGate('closed')

    const response = await as('dev', '/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'items', tags: 'all', ref: 'develop' }),
    })

    expect(response.status).toBe(403)
  })
})

describe('GET /gate', () => {
  it('is readable by the role it restricts', async () => {
    await setGate('closed')

    const response = await as('dev', '/gate')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: 'closed', appliesToYou: true })
  })

  it('tells qa the gate does not apply to them', async () => {
    await setGate('closed')

    expect(await (await as('qa', '/gate')).json()).toMatchObject({
      state: 'closed',
      appliesToYou: false,
    })
  })
})

describe('PUT /gate', () => {
  it('lets an admin close it', async () => {
    const response = await as('admin', '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: 'closed' })
  })

  it.each(['dev', 'qa'] as const)('refuses %s with 403', async (role) => {
    const response = await as(role, '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' }),
    })

    expect(response.status).toBe(403)
  })

  it('records who changed it', async () => {
    await as('admin', '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' }),
    })

    expect(await updatedBy()).toBe(emailFor('admin'))
  })

  /**
   * Rejected at write time rather than left to fail open at read time: an
   * admin who sets a window the gate silently ignores walks away believing
   * they closed it.
   */
  it.each([
    ['an unknown mode', { mode: 'paused' }],
    ['a window with no times', { mode: 'window' }],
    ['a window with unparseable times', { mode: 'window', opensAt: 'x', closesAt: 'y' }],
    [
      'a window that closes before it opens',
      { mode: 'window', opensAt: '2026-01-01T17:00:00Z', closesAt: '2026-01-01T09:00:00Z' },
    ],
  ])('rejects %s with 422', async (_label, body) => {
    const response = await as('admin', '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(422)
  })
})

/**
 * Who closed the gate, and whether anyone can find out.
 *
 * Migration 0003 gives `updated_by` its reason in one line: "Who last changed
 * it, so 'why can't I run anything?' has an answer." It records the account,
 * and GET /gate hands it to the developer it blocks.
 */
describe('PUT /gate — who changed it', () => {
  const putGate = (mode = 'closed') =>
    as('admin', '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })

  it('shows a blocked dev who closed the gate and when', async () => {
    await putGate()
    const body = (await (await as('dev', '/gate')).json()) as {
      updatedBy: string | null
      updatedAt: string | null
    }
    // The developer who cannot run is precisely who this column was for.
    expect(body.updatedBy).toBe(emailFor('admin'))
    expect(body.updatedAt).toBeTruthy()
  })
})

/** Each sandbox has its own gate: closing one stops nobody else. */
describe('the gate belongs to its sandbox', () => {
  it('does not close another sandbox’s gate', async () => {
    await setGate('closed')
    const other = await makeTestSandbox()
    const response = await request('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('dev', other) },
      body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main' }),
    })
    expect(response.status).toBe(201)
  })

  it('records a change in the sandbox’s activity', async () => {
    await as('admin', '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' }),
    })
    const row = await env.DB.prepare(
      `SELECT detail FROM audit_log WHERE sandbox_id = ?1 AND action = 'gate-changed' ORDER BY id DESC`,
    )
      .bind((await sharedSandbox()).id)
      .first<{ detail: string }>()
    expect(row?.detail).toBe('closed')
  })
})
