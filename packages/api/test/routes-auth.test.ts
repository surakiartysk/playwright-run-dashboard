import { describe, expect, it, beforeEach } from 'vitest'
import { migrate, request, as, seedRun } from './helpers'
import type { RunView } from '../src/types'
import { DEV_PASSWORDS } from '../src/config'

beforeEach(migrate)

const login = (password: string) =>
  request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })

describe('POST /auth/login', () => {
  it.each(Object.entries(DEV_PASSWORDS))(
    'signs %s in and sets a cookie',
    async (role, password) => {
      const response = await login(password)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ role })

      const cookie = response.headers.get('Set-Cookie') ?? ''
      expect(cookie).toContain('session=')
      // The session must not be readable by page scripts.
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
    },
  )

  it('refuses a wrong password without saying which role was attempted', async () => {
    const response = await login('wrong')

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).not.toMatch(/dev|qa|admin/i)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})

describe('the session gate', () => {
  it('refuses an unauthenticated request for runs', async () => {
    const response = await request('/runs')
    expect(response.status).toBe(401)
  })

  it('refuses a session cookie whose role was edited', async () => {
    await seedRun({ ref: 'develop' })

    const signedIn = await login(DEV_PASSWORDS.dev)
    const token = (signedIn.headers.get('Set-Cookie') ?? '').split(';')[0]!.replace('session=', '')
    const [exp, , signature] = token.split('.')

    const response = await request('/runs', {
      headers: { Cookie: `session=${exp}.admin.${signature}` },
    })

    expect(response.status).toBe(401)
  })

  it('accepts the token as a bearer header as well as a cookie', async () => {
    const signedIn = await login(DEV_PASSWORDS.qa)
    const token = (signedIn.headers.get('Set-Cookie') ?? '').split(';')[0]!.replace('session=', '')

    const response = await request('/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
  })
})

describe('DELETE /runs/:id — the role gate', () => {
  it.each(['dev', 'qa'] as const)('refuses %s with 403', async (role) => {
    const id = await seedRun()
    const response = await as(role, `/runs/${id}`, { method: 'DELETE' })

    expect(response.status).toBe(403)
  })

  it('allows admin', async () => {
    const id = await seedRun()
    const response = await as('admin', `/runs/${id}`, { method: 'DELETE' })

    expect(response.status).toBe(200)
  })

  it('does not leak whether a run exists to a role that may not delete', async () => {
    const response = await as('dev', '/runs/no-such-run', { method: 'DELETE' })
    // The role gate runs first, so a dev gets 403 either way and cannot probe
    // for run ids by watching for 404.
    expect(response.status).toBe(403)
  })
})

/**
 * The two endpoints that had no tests at all.
 *
 * Found by mutation: logout could stop clearing the cookie and `/me` could
 * drop its session gate, both with all 203 tests still green. `/me` is the
 * worse of the two — without the gate it answers an unauthenticated caller,
 * and the UI trusts its answer to decide whether to show the dashboard.
 */
describe('POST /auth/logout', () => {
  it('clears the session cookie', async () => {
    const signedIn = await login(DEV_PASSWORDS.qa)
    const token = (signedIn.headers.get('Set-Cookie') ?? '').split(';')[0]!.replace('session=', '')

    const response = await request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `session=${token}` },
    })

    expect(response.status).toBe(200)

    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain('session=;')
    // Max-Age=0 is what actually removes it; HttpOnly must survive the clear,
    // or the expiring cookie is briefly readable by page scripts.
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
  })

  /*
   * The preview cookie is signed over the session's expiry, in whole seconds.
   * Left behind by a sign-out, it applied again to a demo sign-in landing in
   * the same second, and the new session opened previewing admin — found by
   * the state review, by curl.
   */
  it('clears the preview cookie too, so it cannot outlive the session it rode on', async () => {
    const response = await request('/auth/logout', { method: 'POST' })
    const cleared = response.headers.getSetCookie().find((c) => c.startsWith('preview-role='))

    expect(cleared).toBeDefined()
    expect(cleared).toMatch(/^preview-role=;/)
    expect(cleared).toContain('Max-Age=0')
  })

  it('succeeds when nobody was signed in', async () => {
    // Signing out twice, or from a stale tab, is ordinary. It must not error.
    expect((await request('/auth/logout', { method: 'POST' })).status).toBe(200)
  })
})

describe('GET /auth/me', () => {
  it.each(['dev', 'qa', 'admin'] as const)('reports the signed-in role for %s', async (role) => {
    const response = await as(role, '/auth/me')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ role })
  })

  /**
   * The gate, not the answer. The UI asks this endpoint whether to render the
   * dashboard at all, so an unauthenticated 200 would let anyone past the
   * login screen — the API would still refuse every action behind it, but the
   * first thing a reader sees would be wrong.
   */
  it('refuses an unauthenticated caller', async () => {
    expect((await request('/auth/me')).status).toBe(401)
  })

  it('refuses a session cookie whose role was edited', async () => {
    const signedIn = await login(DEV_PASSWORDS.dev)
    const token = (signedIn.headers.get('Set-Cookie') ?? '').split(';')[0]!.replace('session=', '')
    const [exp, , signature] = token.split('.')

    const response = await request('/auth/me', {
      headers: { Cookie: `session=${exp}.admin.${signature}` },
    })

    expect(response.status).toBe(401)
  })
})

/**
 * A name typed at sign-in, and where it ends up.
 *
 * `demo`'s password is published, and every demo visitor shares one run
 * history (decision 12). A name accepted at a demo sign-in would therefore be
 * a stranger's free text shown to every later stranger, on each run they
 * started. The route drops it; these pin that it stays dropped all the way to
 * the run, beside the role that keeps it.
 */
describe('a name given at sign-in', () => {
  const signInAndStart = async (password: string, name: string) => {
    const signedIn = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, name }),
    })
    const cookie = (signedIn.headers.get('Set-Cookie') ?? '').split(';')[0]!
    const started = await request('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main' }),
    })
    expect(started.status).toBe(201)
    const { runId } = (await started.json()) as { runId: string }

    const listed = await request('/runs?limit=100', { headers: { Cookie: cookie } })
    const { runs } = (await listed.json()) as { runs: RunView[] }
    return {
      signedIn: (await signedIn.json()) as { name?: string },
      run: runs.find((run) => run.id === runId),
    }
  }

  // The pair: without it, a route that dropped every name would pass below.
  it('is carried onto the runs a dev starts', async () => {
    const { signedIn, run } = await signInAndStart(DEV_PASSWORDS.dev, 'Ada')
    expect(signedIn.name).toBe('Ada')
    expect(run?.startedBy).toBe('Ada')
  })

  it("is dropped for demo, so no visitor's text reaches another", async () => {
    const { signedIn, run } = await signInAndStart(DEV_PASSWORDS.demo, 'Mallory')
    expect(signedIn.name).toBeUndefined()
    expect(run).toBeDefined()
    expect(run?.startedBy).toBeNull()
  })
})
