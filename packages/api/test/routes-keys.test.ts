import { describe, expect, it, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, request, settle } from './helpers'
import { createToken } from '../src/auth'
import { DEV_TOKEN_SECRET } from '../src/config'
import type { Role } from '../src/types'

beforeEach(migrate)

/** A signed-in caller of the given role. */
async function auth(role: Role): Promise<Record<string, string>> {
  const { token } = await createToken(DEV_TOKEN_SECRET, role)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/** Mints a key through the API, the way an admin would, and returns its plaintext. */
async function issue(body: Record<string, unknown>): Promise<{ plaintext: string; id: string }> {
  const response = await request('/keys', {
    method: 'POST',
    headers: await auth('admin'),
    body: JSON.stringify({ label: 'test pipeline', role: 'qa', ...body }),
  })

  const json = (await response.json()) as { plaintext: string; key: { id: string } }
  return { plaintext: json.plaintext, id: json.key.id }
}

const withKey = (plaintext: string) => ({
  Authorization: `Bearer ${plaintext}`,
  'Content-Type': 'application/json',
})

describe('who may issue a key', () => {
  it.each(['dev', 'qa', 'demo'] as const)('refuses %s', async (role) => {
    const response = await request('/keys', {
      method: 'POST',
      headers: await auth(role),
      body: JSON.stringify({ label: 'x', role: 'qa' }),
    })

    expect(response.status).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await request('/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'x', role: 'qa' }),
    })

    expect(response.status).toBe(401)
  })

  it('allows an admin, and returns the plaintext once', async () => {
    const response = await request('/keys', {
      method: 'POST',
      headers: await auth('admin'),
      body: JSON.stringify({ label: 'deploy pipeline', role: 'qa' }),
    })

    expect(response.status).toBe(201)

    const body = (await response.json()) as { plaintext: string; key: Record<string, unknown> }
    expect(body.plaintext).toMatch(/^rdk_/)
    // Nothing in the persisted view could reconstruct the key.
    expect(JSON.stringify(body.key)).not.toContain(body.plaintext.split('_')[2])
  })

  it('refuses a key with no label — one nobody could identify to revoke', async () => {
    const response = await request('/keys', {
      method: 'POST',
      headers: await auth('admin'),
      body: JSON.stringify({ role: 'qa' }),
    })

    expect(response.status).toBe(422)
  })

  it('refuses a demo key, which could never dispatch anything', async () => {
    const response = await request('/keys', {
      method: 'POST',
      headers: await auth('admin'),
      body: JSON.stringify({ label: 'x', role: 'demo' }),
    })

    expect(response.status).toBe(422)
  })
})

describe('authenticating with a key', () => {
  it('starts a run, recorded against the key rather than only its role', async () => {
    const { plaintext, id } = await issue({ role: 'qa' })

    const response = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke' }),
    })

    expect(response.status).toBe(201)

    const { runId } = (await response.json()) as { runId: string }
    const row = await env.DB.prepare('SELECT triggered_by, api_key_id FROM runs WHERE id = ?1')
      .bind(runId)
      .first<{ triggered_by: string; api_key_id: string }>()

    expect(row).toMatchObject({ triggered_by: 'qa', api_key_id: id })
  })

  it('records when a key was last used, so an unused one is visible', async () => {
    const { plaintext, id } = await issue({})

    await settle('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke' }),
    })

    const row = await env.DB.prepare('SELECT last_used_at FROM api_keys WHERE id = ?1')
      .bind(id)
      .first<{ last_used_at: string | null }>()

    expect(row?.last_used_at).not.toBeNull()
    // `settle` waits on waitUntil, and the simulator deliberately sleeps up to
    // six seconds so a person watching sees the transition — past the default
    // five-second timeout.
  }, 15_000)

  it('refuses a key whose secret is wrong', async () => {
    const { plaintext } = await issue({})
    const tampered = `${plaintext.slice(0, -1)}${plaintext.endsWith('a') ? 'b' : 'a'}`

    const response = await request('/runs', { headers: withKey(tampered) })

    expect(response.status).toBe(401)
  })

  it('refuses a key that names an id nobody issued', async () => {
    const response = await request('/runs', { headers: withKey('rdk_nosuchkey_secret') })

    expect(response.status).toBe(401)
  })

  /**
   * The failure this feature would be judged on. A revoked credential that
   * still works is worse than never having had revocation at all, because
   * whoever revoked it believes the problem is handled.
   */
  it('refuses a revoked key', async () => {
    const { plaintext, id } = await issue({})

    const revoked = await request(`/keys/${id}`, {
      method: 'DELETE',
      headers: await auth('admin'),
    })
    expect(revoked.status).toBe(200)

    const response = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke' }),
    })

    expect(response.status).toBe(401)
  })

  /**
   * A failed key must not fall through to session verification — that would
   * report "Sign in first" and send whoever is debugging a pipeline looking
   * for a login problem that does not exist.
   */
  it('says the key is the problem, not the session', async () => {
    const response = await request('/runs', { headers: withKey('rdk_nope_nope') })

    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('API key'),
    })
  })
})

describe('what a key may do', () => {
  it('cannot reach a ref its role may not use', async () => {
    // dev is pinned to main; the key asks for develop too.
    const { plaintext } = await issue({ role: 'dev', allowedRefs: ['main', 'develop'] })

    const response = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke', ref: 'develop' }),
    })

    expect(response.status).toBe(403)
  })

  it('is held to its own narrower ref list', async () => {
    // qa may use main, develop and release; this key may only use develop.
    const { plaintext } = await issue({ role: 'qa', allowedRefs: ['develop'] })

    const refused = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke', ref: 'main' }),
    })
    expect(refused.status).toBe(403)

    const allowed = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke', ref: 'develop' }),
    })
    expect(allowed.status).toBe(201)
  })

  it('cannot raise the worker ceiling above its role', async () => {
    const { plaintext } = await issue({ role: 'dev', maxWorkers: 64 })

    const response = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke', workers: 64 }),
    })

    expect(response.status).toBe(403)
  })

  it('never deletes a run, even carrying an admin role', async () => {
    const { plaintext } = await issue({ role: 'admin' })

    const created = await request('/runs', {
      method: 'POST',
      headers: await auth('admin'),
      body: JSON.stringify({ service: 'items', tags: 'smoke' }),
    })
    const { runId } = (await created.json()) as { runId: string }

    const response = await request(`/runs/${runId}`, {
      method: 'DELETE',
      headers: withKey(plaintext),
    })

    expect(response.status).toBe(403)
  })

  /**
   * The gate is a coordination tool, and an automated caller retrying every
   * thirty seconds is more of the problem it exists to solve, not an exception
   * to it. A pipeline that must run during a freeze asks for a qa-level key.
   */
  it('is gated exactly as a developer is', async () => {
    await env.DB.prepare(`UPDATE run_gate SET mode = 'closed' WHERE id = 1`).run()

    const { plaintext } = await issue({ role: 'dev' })

    const response = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke' }),
    })

    expect(response.status).toBe(503)
  })

  it('is not gated when it carries qa, as a person would not be', async () => {
    await env.DB.prepare(`UPDATE run_gate SET mode = 'closed' WHERE id = 1`).run()

    const { plaintext } = await issue({ role: 'qa' })

    const response = await request('/runs', {
      method: 'POST',
      headers: withKey(plaintext),
      body: JSON.stringify({ service: 'items', tags: 'smoke' }),
    })

    expect(response.status).toBe(201)
  })
})

describe('listing and revoking', () => {
  it('lists revoked keys too, so "revoked or never existed?" has an answer', async () => {
    const { id } = await issue({ label: 'gone' })
    await request(`/keys/${id}`, { method: 'DELETE', headers: await auth('admin') })

    const response = await request('/keys', { headers: await auth('admin') })
    const { keys } = (await response.json()) as { keys: { id: string; revokedAt: string | null }[] }

    expect(keys.find((k) => k.id === id)?.revokedAt).not.toBeNull()
  })

  it('never returns anything that could reconstruct a key', async () => {
    const { plaintext } = await issue({})
    const secretPart = plaintext.split('_')[2] as string

    const response = await request('/keys', { headers: await auth('admin') })

    expect(await response.text()).not.toContain(secretPart)
  })

  it('treats revoking twice as done rather than an error', async () => {
    const { id } = await issue({})
    const headers = await auth('admin')

    expect((await request(`/keys/${id}`, { method: 'DELETE', headers })).status).toBe(200)

    const second = await request(`/keys/${id}`, { method: 'DELETE', headers })
    expect(second.status).toBe(200)
    expect((await second.json()) as { alreadyRevoked: boolean }).toMatchObject({
      alreadyRevoked: true,
    })
  })

  it('404s a key that never existed', async () => {
    const response = await request('/keys/nosuchkey', {
      method: 'DELETE',
      headers: await auth('admin'),
    })

    expect(response.status).toBe(404)
  })
})
