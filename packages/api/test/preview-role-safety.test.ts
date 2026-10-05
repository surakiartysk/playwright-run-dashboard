import { describe, expect, it, beforeAll } from 'vitest'
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { as, migrate, request, sessionFor, seedRun } from './helpers'
import { DEV_TOKEN_SECRET } from '../src/config'
import worker from '../src/index'

beforeAll(migrate)

/**
 * The property this file guarantees: a `demo` session previewing another
 * role's read view (`POST /demo/preview-role`) never gains that role's write
 * or dispatch capability. Only `GET /runs` and `GET /runs/:id` consult the
 * preview cookie (see `resolveViewRole` in routes/runs.ts) — `POST /runs`,
 * `DELETE /runs/:id`, and `dispatchWorkflow` all read `c.get('role')`
 * directly and are untouched by this feature.
 *
 * Without this file, a mutation that made those write paths consult the
 * preview cookie too would pass every other test — `demo-role-safety.test.ts`
 * only ever posts as plain `demo`, with no preview cookie attached, so it
 * cannot see this class of regression.
 */

const DEPLOYED_SECRETS = {
  WEBHOOK_SECRET: 'w',
  // Kept equal to what sessionFor() signs with, so a session minted before
  // the env is patched still verifies after.
  TOKEN_SECRET: DEV_TOKEN_SECRET,
  ADMIN_PASSWORD: 'a',
  QA_PASSWORD: 'q',
  DEV_PASSWORD: 'd',
  DEMO_PASSWORD: 'demo',
  GITHUB_TOKEN: 'a-real-looking-token',
}

/** A demo session that has successfully previewed the given role. */
async function demoPreviewing(role: string): Promise<string> {
  const session = await sessionFor('demo')
  const ctx = createExecutionContext()
  const response = await worker.fetch(
    new Request('http://api.test/demo/preview-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session },
      body: JSON.stringify({ role }),
    }),
    env,
    ctx,
  )
  await waitOnExecutionContext(ctx)

  const previewCookie = (response.headers.get('Set-Cookie') ?? '').split(';')[0]
  return `${session}; ${previewCookie}`
}

/**
 * Deliberately does not wait for `waitUntil`. `simulated: true` comes back in
 * the response body before the background job — the simulator sleeps for
 * several seconds — has even started, so waiting for it here would only be
 * waiting for `setTimeout`. Same pattern as demo-role-safety.test.ts.
 */
async function callAsDemoPreviewingAdmin(
  method: string,
  path: string,
  body: unknown,
  deployed: boolean,
) {
  const cookie = await demoPreviewing('admin')
  const patched = {
    ...env,
    ...(deployed ? { SIMULATE_DISPATCH: 'false', ...DEPLOYED_SECRETS } : {}),
  }
  const ctx = createExecutionContext()
  return worker.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    patched,
    ctx,
  )
}

describe('a demo session previewing admin still cannot write as admin', () => {
  it('POST /runs against a ref only admin may use still 403s, same as plain demo', async () => {
    const response = await callAsDemoPreviewingAdmin(
      'POST',
      '/runs',
      { service: 'items', tags: 'all', ref: 'develop' },
      false,
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain("Role 'demo'")
  })

  it('DELETE /runs/:id still 403s, same as plain demo', async () => {
    const id = await seedRun()
    const response = await callAsDemoPreviewingAdmin('DELETE', `/runs/${id}`, undefined, false)

    expect(response.status).toBe(403)
  })

  it('POST /runs never reaches a real dispatch, even on a fully real deployment', async () => {
    const response = await callAsDemoPreviewingAdmin(
      'POST',
      '/runs',
      { service: 'items', tags: 'all' },
      true,
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ simulated: true })
  })
})

describe('a demo session previewing admin can see what admin would see', () => {
  it('GET /runs returns rows a plain demo session would not see', async () => {
    const otherRolesRun = await seedRun({ triggeredBy: 'qa', ref: 'release' })

    const previewingAdmin = await demoPreviewing('admin')
    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request('http://api.test/runs?limit=100', { headers: { Cookie: previewingAdmin } }),
      env,
      ctx,
    )
    await waitOnExecutionContext(ctx)

    const body = (await response.json()) as { runs: { id: string }[]; role: string; viewAs: string }
    expect(body.role).toBe('demo')
    expect(body.viewAs).toBe('admin')
    expect(body.runs.some((r) => r.id === otherRolesRun)).toBe(true)
  })

  it('plain demo (no preview cookie) does not see that same run', async () => {
    const otherRolesRun = await seedRun({ triggeredBy: 'qa', ref: 'release' })

    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request('http://api.test/runs?limit=100', {
        headers: { Cookie: await sessionFor('demo') },
      }),
      env,
      ctx,
    )
    await waitOnExecutionContext(ctx)

    const body = (await response.json()) as { runs: { id: string }[] }
    expect(body.runs.some((r) => r.id === otherRolesRun)).toBe(false)
  })
})

/**
 * Previewing shows another role's runs, and a run carries one thing a person
 * typed: the name they gave at sign-in. That must not reach a visitor who only
 * pressed the demo button.
 */
describe('what a previewing demo session is not shown', () => {
  const nameRun = async (triggeredBy: 'demo' | 'qa', startedBy: string) => {
    const id = await seedRun({ triggeredBy })
    await env.DB.prepare(`UPDATE runs SET started_by = ?2 WHERE id = ?1`).bind(id, startedBy).run()
    return id
  }

  const previewing = async (as: 'admin' | 'qa') => {
    const demo = await sessionFor('demo')
    const preview = await request('/demo/preview-role', {
      method: 'POST',
      headers: { Cookie: demo, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: as }),
    })
    return `${demo}; ${preview.headers.get('Set-Cookie')!.split(';')[0]!}`
  }

  const startedByIn = async (cookie: string, id: string) => {
    const list = (await (
      await request('/runs?limit=100', { headers: { Cookie: cookie } })
    ).json()) as {
      runs: { id: string; startedBy: string | null }[]
    }
    return list.runs.find((r) => r.id === id)
  }

  it('withholds the name on another role’s run, in the list and on its own page', async () => {
    const id = await nameRun('qa', 'Somchai')
    const cookie = await previewing('admin')

    expect((await startedByIn(cookie, id))?.startedBy).toBeNull()

    const one = (await (await request(`/runs/${id}`, { headers: { Cookie: cookie } })).json()) as {
      startedBy: string | null
      triggeredBy: string
    }
    expect(one.startedBy).toBeNull()
    // The role is the point of the preview and stays.
    expect(one.triggeredBy).toBe('qa')
  })

  it('leaves the name on the demo’s own runs', async () => {
    const id = await nameRun('demo', 'a visitor')
    const cookie = await previewing('admin')
    expect((await startedByIn(cookie, id))?.startedBy).toBe('a visitor')
  })

  it('does not hide the name from the role that really holds it', async () => {
    const id = await nameRun('qa', 'Somchai')
    const list = (await (await as('admin', '/runs?limit=100')).json()) as {
      runs: { id: string; startedBy: string | null }[]
    }
    expect(list.runs.find((r) => r.id === id)?.startedBy).toBe('Somchai')
  })
})
