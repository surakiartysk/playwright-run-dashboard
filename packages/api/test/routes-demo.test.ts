import { describe, expect, it, beforeEach } from 'vitest'
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { migrate, request, as, sessionFor } from './helpers'
import { DEV_PASSWORDS, DEV_TOKEN_SECRET } from '../src/config'
import worker from '../src/index'

beforeEach(migrate)

/**
 * `/demo/preview-role` lets a genuinely authenticated `demo` session look at
 * what another role's read views show — without ever minting a session token
 * for that role. See `preview-role-safety.test.ts` for the property that
 * actually matters (a demo session previewing 'admin' still cannot write or
 * dispatch as admin); this file covers the endpoint's ordinary shape.
 */

/**
 * Secrets are supplied alongside `SIMULATE_DISPATCH: 'false'` because a
 * deployment without them refuses every request with a 503 before any handler
 * runs — see misconfigured.test.ts. Omitting them here would test the config
 * guard rather than the behaviour these tests are about.
 */
const DEPLOYED_SECRETS = {
  WEBHOOK_SECRET: 'w',
  // Kept equal to what sessionFor() signs with, so a session minted before
  // the env is patched still verifies after — these tests are about the
  // preview-role behaviour, not about re-testing token verification.
  TOKEN_SECRET: DEV_TOKEN_SECRET,
  ADMIN_PASSWORD: 'a',
  QA_PASSWORD: 'q',
  DEV_PASSWORD: 'd',
}

/** Calls the Worker with `SIMULATE_DISPATCH` overridden for this request. */
async function withDispatch(value: string | undefined, path: string, init: RequestInit = {}) {
  const patched = {
    ...env,
    SIMULATE_DISPATCH: value,
    ...(value === 'false' ? DEPLOYED_SECRETS : {}),
  }
  const ctx = createExecutionContext()
  const response = await worker.fetch(new Request(`http://api.test${path}`, init), patched, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

const previewAs = (role: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role }),
})

describe('POST /demo/preview-role — unauthenticated', () => {
  it('is refused with no session at all', async () => {
    const response = await request('/demo/preview-role', previewAs('admin'))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})

describe('POST /demo/preview-role — authenticated as demo', () => {
  it('sets a preview-role cookie for the requested role', async () => {
    const response = await as('demo', '/demo/preview-role', previewAs('admin'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ previewing: 'admin' })

    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain('preview-role=')
    expect(cookie).toContain('HttpOnly')
  })

  it('never sets a new session cookie — only the preview cookie', async () => {
    const response = await as('demo', '/demo/preview-role', previewAs('admin'))
    const cookie = response.headers.get('Set-Cookie') ?? ''

    // A real session cookie would start with `session=`; the preview cookie
    // must not be confusable with it.
    expect(cookie.startsWith('session=')).toBe(false)
  })

  it('refuses a role that does not exist', async () => {
    const response = await as('demo', '/demo/preview-role', previewAs('superuser'))

    expect(response.status).toBe(422)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('refuses a request with no role', async () => {
    const response = await as('demo', '/demo/preview-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(422)
  })

  it('works on a real, non-simulated deployment too', async () => {
    // Safety here comes from the preview cookie never reaching a write or
    // dispatch path (see preview-role-safety.test.ts), not from a deployment
    // flag — so unlike the old switch-role endpoint, this one is not gated on
    // SIMULATE_DISPATCH at all.
    const response = await withDispatch('false', '/demo/preview-role', {
      ...previewAs('admin'),
      headers: { ...previewAs('admin').headers, Cookie: await sessionFor('demo') },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ previewing: 'admin' })
  })
})

describe('POST /demo/preview-role — authenticated as a real, non-demo role', () => {
  it('refuses dev, qa, and admin — only demo may preview', async () => {
    for (const role of ['dev', 'qa', 'admin'] as const) {
      const response = await as(role, '/demo/preview-role', previewAs('admin'))
      expect(response.status).toBe(403)
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }
  })
})

describe('POST /demo/stop-preview', () => {
  it('clears the preview-role cookie', async () => {
    const response = await as('demo', '/demo/stop-preview', { method: 'POST' })

    expect(response.status).toBe(200)
    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain('preview-role=;')
  })
})

describe('GET /demo/roles', () => {
  it('describes every role from the same table the API enforces', async () => {
    const response = await as('demo', '/demo/roles')
    const body = (await response.json()) as {
      canPreview: boolean
      roles: { role: string; maxWorkers: number; canDelete: boolean }[]
    }

    expect(body.canPreview).toBe(true)
    expect(body.roles.map((r) => r.role)).toEqual(['demo', 'dev', 'qa', 'admin'])
    expect(body.roles.find((r) => r.role === 'dev')).toMatchObject({
      maxWorkers: 4,
      canDelete: false,
    })
  })

  it('describes demo as scoped to its own runs, not to a branch', async () => {
    const response = await as('demo', '/demo/roles')
    const body = (await response.json()) as {
      roles: { role: string; maxWorkers: number; canDelete: boolean; sees: string }[]
    }

    expect(body.roles.find((r) => r.role === 'demo')).toMatchObject({
      maxWorkers: 2,
      canDelete: false,
      sees: 'only the runs it started itself',
    })
  })

  it('reports canPreview false for a real, non-demo session', async () => {
    const response = await as('dev', '/demo/roles')
    expect(await response.json()).toMatchObject({ canPreview: false })
  })

  it('requires a session at all', async () => {
    const response = await request('/demo/roles')
    expect(response.status).toBe(401)
  })
})

/**
 * `GET /auth/dev-credentials` prints the development passwords on the login
 * screen so a reader can get in without going to the source.
 *
 * That is right for a simulation and wrong for dev/qa/admin on a deployment,
 * and the guard saying so had no test at all — deleting it left all 200
 * green, meaning a real deployment could have served every role's password
 * to anyone who asked. Same class as the old role-switch escalation, which
 * was tested from the start; this one was not.
 *
 * `demo` is the deliberate exception — see decision 12. It is printed either
 * way, because hiding it protects nothing: dispatchWorkflow refuses that role
 * a real run regardless of what this endpoint says.
 */
describe('GET /auth/dev-credentials', () => {
  it('serves every password while simulating, so the demo is usable', async () => {
    const response = await request('/auth/dev-credentials')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      mode: 'full',
      passwords: {
        demo: expect.any(String),
        dev: expect.any(String),
        qa: expect.any(String),
        admin: expect.any(String),
      },
    })
  })

  it('serves only the demo password outside simulation', async () => {
    const response = await withDispatch('false', '/auth/dev-credentials')
    const body = (await response.json()) as { mode: string; passwords: Record<string, string> }

    expect(body.mode).toBe('demo-only')
    expect(body.passwords).toEqual({ demo: expect.any(String) })
  })

  /**
   * The body is checked for the values themselves, not just for the mode: a
   * handler that reported `mode: 'demo-only'` while still attaching the other
   * passwords would satisfy a mode-only assertion and leak anyway.
   */
  it('does not leak a dev, qa, or admin password outside simulation', async () => {
    const raw = await (await withDispatch('false', '/auth/dev-credentials')).text()

    for (const [role, password] of Object.entries(DEV_PASSWORDS)) {
      if (role === 'demo') continue
      expect(raw).not.toContain(password)
    }
  })
})
