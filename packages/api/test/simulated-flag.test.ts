import { describe, expect, it, beforeAll } from 'vitest'
import { env, createExecutionContext } from 'cloudflare:test'
import { migrate, sessionFor } from './helpers'
import { DEV_TOKEN_SECRET } from '../src/config'
import worker from '../src/index'
import type { Role, RunView } from '../src/types'

beforeAll(migrate)

/**
 * A simulated run says so, wherever it is shown.
 *
 * The list showed a simulated run exactly like a real one — "13 / 13", a
 * report link, a duration — and `demo`, which every visitor uses, only ever
 * simulates. The POST response carried `simulated: true`; nothing kept it.
 *
 * Every case runs both ways round, because a flag that is always true or
 * always false passes half of them: a demo run on a deployment that is
 * otherwise real, a real dispatch beside it, and a deployment that simulates
 * everyone.
 */

const REAL_DEPLOYMENT = {
  SIMULATE_DISPATCH: 'false',
  WEBHOOK_SECRET: 'w',
  // Equal to what sessionFor() signs with, so the session still verifies.
  TOKEN_SECRET: DEV_TOKEN_SECRET,
  ADMIN_PASSWORD: 'a',
  QA_PASSWORD: 'q',
  DEV_PASSWORD: 'd',
  GITHUB_TOKEN: 'a-real-looking-token',
}

async function call(role: Role, path: string, real: boolean, init: RequestInit = {}) {
  return worker.fetch(
    new Request(`http://api.test${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: await sessionFor(role) },
    }),
    real ? { ...env, ...REAL_DEPLOYMENT } : env,
    createExecutionContext(),
  )
}

/** Starts a run, with GitHub answering a real dispatch the way it does. */
async function startRun(role: Role, real: boolean): Promise<RunView> {
  const previous = globalThis.fetch
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch
  try {
    const created = await call(role, '/runs', real, {
      method: 'POST',
      body: JSON.stringify({ service: 'items', tags: 'all' }),
    })
    expect(created.status).toBe(201)
    const { runId } = (await created.json()) as { runId: string }

    // Read back as admin, who may see every run, from the stored row.
    const read = await call('admin', `/runs/${runId}`, real)
    expect(read.status).toBe(200)
    return (await read.json()) as RunView
  } finally {
    globalThis.fetch = previous
  }
}

describe('a run records whether it was simulated', () => {
  it('marks a demo run simulated on a deployment that is otherwise real', async () => {
    expect((await startRun('demo', true)).simulated).toBe(true)
  })

  it('marks a real dispatch as not simulated', async () => {
    expect((await startRun('qa', true)).simulated).toBe(false)
  })

  it('marks every run simulated on a deployment that simulates', async () => {
    expect((await startRun('qa', false)).simulated).toBe(true)
  })
})

describe('the run form is told before Run is pressed', () => {
  const simulates = async (role: Role, real: boolean) => {
    const response = await call(role, '/demo/roles', real)
    expect(response.status).toBe(200)
    return ((await response.json()) as { simulates: boolean }).simulates
  }

  it('says a real role dispatches for real only where the deployment does', async () => {
    expect(await simulates('dev', true)).toBe(false)
    expect(await simulates('dev', false)).toBe(true)
  })

  it('says demo simulates even where everyone else dispatches for real', async () => {
    expect(await simulates('demo', true)).toBe(true)
  })
})
