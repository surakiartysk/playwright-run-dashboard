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

/**
 * `created_by` has the same problem `updated_by` had on the gate.
 *
 * 0005 calls the column "the admin who issued it", and it was bound to the
 * role — so every key claimed to be issued by 'admin'. With one shared admin
 * password that identifies nobody, which is the whole reason a key carries a
 * label: someone eventually has to decide whether revoking it is safe, and
 * "who issued this?" is half of that decision.
 */
describe('a key records who issued it', () => {
  it('records the name the admin signed in with', async () => {
    const { token } = await createToken(DEV_TOKEN_SECRET, 'admin', 'Nok')

    const response = await request('/keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'deploy pipeline', role: 'qa' }),
    })

    expect(response.status).toBe(201)
    const { key } = (await response.json()) as { key: { createdBy: string } }
    expect(key.createdBy).toContain('Nok')
  })

  it('falls back to the role when the admin gave no name', async () => {
    const response = await request('/keys', {
      method: 'POST',
      headers: await auth('admin'),
      body: JSON.stringify({ label: 'deploy pipeline', role: 'qa' }),
    })

    const { key } = (await response.json()) as { key: { createdBy: string } }
    expect(key.createdBy).toBe('admin')
  })
})

/**
 * A key may not touch the key surface at all.
 *
 * This is non-negotiable 5 — "a key is not a person" — in the place it bites
 * hardest. `requireRole('admin')` checks a role, an admin key carries that
 * role, so the entire /keys router was reachable with one: an admin key could
 * mint a fresh admin key, which is the failure that outlives revocation.
 * Revoke the leaked key and whoever took it still holds the one it issued.
 *
 * DELETE /runs/:id is the worked example the repo already had. It refused keys
 * because deletion is destructive and has no automated use case. Issuing a
 * credential is the same argument one step further: keys.ts says handing one
 * out is "the decision this whole feature exists to keep deliberate", and a
 * pipeline that mints its own credentials has taken that decision away from
 * the person who was supposed to make it.
 *
 * Listing and revoking go with it rather than being argued case by case. A
 * pipeline reading the key inventory is reconnaissance with no use case, and
 * a key revoking other keys is a denial-of-service with no use case — and a
 * surface where two of three verbs are refused invites someone to assume the
 * third is fine.
 */
describe('an API key may not reach the key surface', () => {
  const adminKey = async () => {
    const { plaintext } = await issue({ label: 'admin pipeline', role: 'admin' })
    return withKey(plaintext)
  }

  it('refuses to mint a key when the caller is a key', async () => {
    const headers = await adminKey()

    const response = await request('/keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'spawned', role: 'admin' }),
    })

    expect(response.status).toBe(403)

    // And nothing was created — a refusal that still wrote the row would be
    // worse than no refusal, because it would look safe.
    const { results } = await env.DB.prepare(
      `SELECT id FROM api_keys WHERE label = 'spawned'`,
    ).all()
    expect(results).toHaveLength(0)
  })

  it('refuses to list keys to a key', async () => {
    expect((await request('/keys', { headers: await adminKey() })).status).toBe(403)
  })

  it('refuses to revoke a key on a key’s say-so', async () => {
    const headers = await adminKey()
    const { id } = await issue({ label: 'victim', role: 'qa' })

    const response = await request(`/keys/${id}`, { method: 'DELETE', headers })

    expect(response.status).toBe(403)

    const row = await env.DB.prepare(`SELECT revoked_at FROM api_keys WHERE id = ?1`)
      .bind(id)
      .first<{ revoked_at: string | null }>()
    expect(row?.revoked_at).toBeNull()
  })

  it('still lets a signed-in admin do all three', async () => {
    const headers = await auth('admin')
    const { id } = await issue({ label: 'still works', role: 'qa' })

    expect((await request('/keys', { headers })).status).toBe(200)
    expect((await request(`/keys/${id}`, { method: 'DELETE', headers })).status).toBe(200)
  })
})

/**
 * The gate is the deliberate exception, and it is worth stating as a test
 * rather than leaving as an absence.
 *
 * Closing the gate during a deploy is exactly what a release pipeline is for,
 * and gate.ts is explicit that the gate is a coordination tool which fails
 * open — not a security boundary. Refusing keys here would remove a real
 * automated use case to guard something that was never guarding anything.
 * `actorFor` records the key's label, so the audit trail names the pipeline.
 */
describe('an API key may still work the run gate', () => {
  it('lets an admin key close and reopen it, recorded under the key’s label', async () => {
    const { plaintext } = await issue({ label: 'release pipeline', role: 'admin' })

    const response = await request('/gate', {
      method: 'PUT',
      headers: withKey(plaintext),
      body: JSON.stringify({ mode: 'closed' }),
    })

    expect(response.status).toBe(200)

    const row = await env.DB.prepare('SELECT updated_by FROM run_gate WHERE id = 1').first<{
      updated_by: string
    }>()
    expect(row?.updated_by).toBe('key:release pipeline')
  })
})
