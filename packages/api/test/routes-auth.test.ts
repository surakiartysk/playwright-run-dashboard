import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { as, emailFor, makeTestSandbox, migrate, request, seedRun, sessionFor } from './helpers'
import { OUTSIDER_EMAIL, SEED_MEMBERS, VISITOR_EMAIL, adminKeyFor } from '../src/sandboxes'

beforeAll(migrate)

const post = (path: string, body: unknown, cookie?: string) =>
  request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })

/** The `session=…` pair a response set, ready to send back. */
const sessionFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith('session='))!
    .split(';')[0]!

const sandboxCount = async () =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM sandboxes`).first<{ n: number }>())!.n

const me = async (cookie: string) =>
  (await (await request('/auth/me', { headers: { Cookie: cookie } })).json()) as {
    email: string
    role: string
    listedRole: string
    adminUntil: number | null
  }

describe('POST /auth/demo', () => {
  it('makes a sandbox and signs in as its visitor account', async () => {
    const before = await sandboxCount()
    const response = await post('/auth/demo', {})

    expect(response.status).toBe(200)
    expect(await sandboxCount()).toBe(before + 1)
    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain('session=')
    // The session must not be readable by page scripts.
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(await me(sessionFrom(response))).toMatchObject({ email: VISITOR_EMAIL })
  })

  /*
   * The visitor is listed as admin, and listed is half of it: without the key
   * they work as dev. A demo that opened as admin would show the key as a
   * formality rather than the check it is.
   */
  it('signs in as dev until the admin key is given', async () => {
    const cookie = sessionFrom(await post('/auth/demo', {}))
    expect(await me(cookie)).toMatchObject({ role: 'dev', listedRole: 'admin', adminUntil: null })
  })

  it('gives each sign-in a sandbox of its own', async () => {
    const one = sessionFrom(await post('/auth/demo', {}))
    const two = sessionFrom(await post('/auth/demo', {}))
    expect(one).not.toBe(two)
    expect(one.split('.')[1]).not.toBe(two.split('.')[1])
  })
})

describe('the concept Google sign-in', () => {
  it('offers the accounts a new sandbox starts with, and one that is on no list', async () => {
    const { accounts } = (await (await request('/auth/accounts')).json()) as {
      accounts: { email: string; role: string | null }[]
    }
    expect(accounts.map((a) => a.email)).toEqual([
      ...SEED_MEMBERS.map((m) => m.email),
      OUTSIDER_EMAIL,
    ])
    expect(accounts.at(-1)?.role).toBeNull()
  })

  it('offers the sandbox’s own members once there is one', async () => {
    const sandbox = await makeTestSandbox()
    const cookie = await sessionFor('qa', sandbox)
    const { accounts } = (await (
      await request('/auth/accounts', { headers: { Cookie: cookie } })
    ).json()) as { accounts: { email: string }[] }
    expect(accounts.map((a) => a.email)).toContain(emailFor('qa'))
    expect(accounts.map((a) => a.email)).not.toContain(VISITOR_EMAIL)
  })

  it('signs a listed account in to a new sandbox', async () => {
    const response = await post('/auth/account', { email: SEED_MEMBERS[1].email })
    expect(response.status).toBe(200)
    expect(await me(sessionFrom(response))).toMatchObject({ role: 'qa' })
  })

  /*
   * The point of the whitelist, shown rather than described. And before any
   * sandbox is made: a refusal must not spend one nobody can sign in to.
   */
  it('refuses an account on no list, without making a sandbox', async () => {
    const before = await sandboxCount()
    const response = await post('/auth/account', { email: OUTSIDER_EMAIL })
    expect(response.status).toBe(403)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(await sandboxCount()).toBe(before)
  })

  it('switches account within the same sandbox, keeping what was made there', async () => {
    const sandbox = await makeTestSandbox()
    const run = await seedRun({ sandboxId: sandbox.id })
    const switched = await post(
      '/auth/account',
      { email: emailFor('qa') },
      await sessionFor('dev', sandbox),
    )

    expect(switched.status).toBe(200)
    const cookie = sessionFrom(switched)
    expect(cookie.split('.')[1]).toBe(sandbox.id)
    expect((await request(`/runs/${run}`, { headers: { Cookie: cookie } })).status).toBe(200)
  })

  it('refuses switching to an account the sandbox does not list, and records it', async () => {
    const sandbox = await makeTestSandbox()
    const response = await post(
      '/auth/account',
      { email: OUTSIDER_EMAIL },
      await sessionFor('dev', sandbox),
    )
    expect(response.status).toBe(403)
    const logged = await env.DB.prepare(
      `SELECT action, actor FROM audit_log WHERE sandbox_id = ?1 AND action = 'sign-in-refused'`,
    )
      .bind(sandbox.id)
      .first<{ actor: string }>()
    expect(logged?.actor).toBe(OUTSIDER_EMAIL)
  })

  it('refuses something that is not an email', async () => {
    expect((await post('/auth/account', { email: 'not an email' })).status).toBe(422)
  })
})

describe('the session gate', () => {
  it('refuses an unauthenticated request for runs', async () => {
    expect((await request('/runs')).status).toBe(401)
  })

  it('accepts the token as a bearer header as well as a cookie', async () => {
    const token = (await sessionFor('qa')).replace('session=', '')
    const response = await request('/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
  })

  it('refuses a session whose sandbox has expired, and says to sign in again', async () => {
    const sandbox = await makeTestSandbox()
    const cookie = await sessionFor('qa', sandbox)
    await env.DB.prepare(`UPDATE sandboxes SET expires_at = ?2 WHERE id = ?1`)
      .bind(sandbox.id, new Date(Date.now() - 1000).toISOString())
      .run()
    const response = await request('/runs', { headers: { Cookie: cookie } })
    expect(response.status).toBe(401)
    expect(((await response.json()) as { error: string }).error).toMatch(/sign in again/i)
  })

  /*
   * The role is read from the list on every request, not carried in the
   * session. An admin removing someone must not have to wait a day for their
   * session to run out.
   */
  it('refuses an account removed from the list on its next request', async () => {
    const sandbox = await makeTestSandbox()
    const cookie = await sessionFor('qa', sandbox)
    expect((await request('/runs', { headers: { Cookie: cookie } })).status).toBe(200)
    await env.DB.prepare(`DELETE FROM members WHERE sandbox_id = ?1 AND email = ?2`)
      .bind(sandbox.id, emailFor('qa'))
      .run()
    expect((await request('/runs', { headers: { Cookie: cookie } })).status).toBe(403)
  })

  it('takes a change of role on the next request', async () => {
    const sandbox = await makeTestSandbox()
    const cookie = await sessionFor('dev', sandbox)
    await env.DB.prepare(`UPDATE members SET role = 'qa' WHERE sandbox_id = ?1 AND email = ?2`)
      .bind(sandbox.id, emailFor('dev'))
      .run()
    expect(await me(cookie)).toMatchObject({ role: 'qa' })
  })
})

describe('the admin key', () => {
  const listedOnly = async (sandbox: { id: string; expires_at: string }) =>
    (await sessionFor('admin', sandbox)).split(';')[0]!

  it('is shown to the account listed as admin', async () => {
    const sandbox = await makeTestSandbox()
    const response = await request('/auth/admin-key', {
      headers: { Cookie: await listedOnly(sandbox) },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ key: await adminKeyFor(env, sandbox.id), demo: true })
  })

  it.each(['qa', 'dev'] as const)('is not shown to %s', async (role) => {
    const response = await request('/auth/admin-key', {
      headers: { Cookie: await sessionFor(role) },
    })
    expect(response.status).toBe(403)
  })

  it('differs between sandboxes', async () => {
    const one = await makeTestSandbox()
    const two = await makeTestSandbox()
    expect(await adminKeyFor(env, one.id)).not.toBe(await adminKeyFor(env, two.id))
  })

  it('unlocks admin for the listed account, for an hour', async () => {
    const sandbox = await makeTestSandbox()
    const cookie = await listedOnly(sandbox)
    const response = await post('/auth/admin', { key: await adminKeyFor(env, sandbox.id) }, cookie)

    expect(response.status).toBe(200)
    const admin = response.headers.getSetCookie().find((c) => c.startsWith('admin='))!
    expect(admin).toContain('Max-Age=3600')
    const both = `${cookie}; ${admin.split(';')[0]}`
    expect(await me(both)).toMatchObject({ role: 'admin' })
  })

  it('refuses a wrong key', async () => {
    const sandbox = await makeTestSandbox()
    const response = await post('/auth/admin', { key: 'adm_wrong' }, await listedOnly(sandbox))
    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  /*
   * The other half: the key alone is not enough. An account the list does not
   * name as admin is refused even holding the right key.
   */
  it('refuses the right key from an account not listed as admin', async () => {
    const sandbox = await makeTestSandbox()
    const response = await post(
      '/auth/admin',
      { key: await adminKeyFor(env, sandbox.id) },
      await sessionFor('qa', sandbox),
    )
    expect(response.status).toBe(403)
  })

  it('refuses another sandbox’s key', async () => {
    const sandbox = await makeTestSandbox()
    const other = await makeTestSandbox()
    const response = await post(
      '/auth/admin',
      { key: await adminKeyFor(env, other.id) },
      await listedOnly(sandbox),
    )
    expect(response.status).toBe(401)
  })

  it('stops counting once the account is no longer listed as admin', async () => {
    const sandbox = await makeTestSandbox()
    const cookie = await sessionFor('admin', sandbox)
    expect(await me(cookie)).toMatchObject({ role: 'admin' })
    await env.DB.prepare(`UPDATE members SET role = 'qa' WHERE sandbox_id = ?1 AND email = ?2`)
      .bind(sandbox.id, emailFor('admin'))
      .run()
    expect(await me(cookie)).toMatchObject({ role: 'qa' })
  })

  it('can be given up early', async () => {
    const response = await request('/auth/admin', { method: 'DELETE' })
    const cleared = response.headers.getSetCookie().find((c) => c.startsWith('admin='))
    expect(cleared).toMatch(/^admin=;/)
    expect(cleared).toContain('Max-Age=0')
  })
})

describe('DELETE /runs/:id — the role gate', () => {
  it.each(['dev', 'qa'] as const)('refuses %s with 403', async (role) => {
    const sandbox = await makeTestSandbox()
    const id = await seedRun({ sandboxId: sandbox.id })
    const response = await request(`/runs/${id}`, {
      method: 'DELETE',
      headers: { Cookie: await sessionFor(role, sandbox) },
    })
    expect(response.status).toBe(403)
  })

  it('allows admin, in its own sandbox', async () => {
    const sandbox = await makeTestSandbox()
    const id = await seedRun({ sandboxId: sandbox.id })
    const response = await request(`/runs/${id}`, {
      method: 'DELETE',
      headers: { Cookie: await sessionFor('admin', sandbox) },
    })
    expect(response.status).toBe(200)
  })

  it('does not leak whether a run exists to a role that may not delete', async () => {
    // The role gate runs first, so a dev gets 403 either way and cannot probe
    // for run ids by watching for 404.
    expect((await as('dev', '/runs/no-such-run', { method: 'DELETE' })).status).toBe(403)
  })
})

describe('POST /auth/logout', () => {
  it('clears the session and the admin cookie', async () => {
    const response = await request('/auth/logout', { method: 'POST' })
    expect(response.status).toBe(200)
    const set = response.headers.getSetCookie()
    for (const name of ['session', 'admin']) {
      const cleared = set.find((c) => c.startsWith(`${name}=`))
      expect(cleared).toMatch(new RegExp(`^${name}=;`))
      // Max-Age=0 is what removes it; HttpOnly must survive the clear.
      expect(cleared).toContain('Max-Age=0')
      expect(cleared).toContain('HttpOnly')
    }
  })
})

describe('GET /auth/me', () => {
  it.each(['dev', 'qa', 'admin'] as const)('reports the role and account for %s', async (role) => {
    expect(await me(await sessionFor(role))).toMatchObject({ role, email: emailFor(role) })
  })

  /**
   * The gate, not the answer. The UI asks this endpoint whether to render the
   * dashboard at all, so an unauthenticated 200 would let anyone past the
   * sign-in screen.
   */
  it('refuses an unauthenticated caller', async () => {
    expect((await request('/auth/me')).status).toBe(401)
  })
})
