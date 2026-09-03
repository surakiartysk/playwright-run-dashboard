import { describe, expect, it, beforeAll } from 'vitest'
import { env, createExecutionContext } from 'cloudflare:test'
import { migrate, sessionFor, uniqueService } from './helpers'
import { dispatchWorkflow } from '../src/github'
import { DEV_TOKEN_SECRET } from '../src/config'
import worker from '../src/index'
import type { Bindings, Role } from '../src/types'

beforeAll(migrate)

/**
 * The property decision 12 exists to guarantee: `demo` cannot reach a real
 * GitHub Actions run, no matter how the rest of the deployment is configured.
 *
 * Every other role's real-vs-simulated behaviour is one flag,
 * `SIMULATE_DISPATCH`, checked once. `demo` overrides that flag rather than
 * obeying it — which means the ordinary "flip SIMULATE_DISPATCH and see what
 * happens" tests elsewhere in this suite would never catch a regression here.
 * A mutation that made `demo` obey the flag like everyone else would still
 * pass every other test file green.
 */

const DEPLOYED_SECRETS = {
  WEBHOOK_SECRET: 'w',
  // Kept equal to what sessionFor() signs with, so a session minted before
  // the env is patched still verifies after — this file is about the
  // dispatch decision, not about re-testing token verification.
  TOKEN_SECRET: DEV_TOKEN_SECRET,
  ADMIN_PASSWORD: 'a',
  QA_PASSWORD: 'q',
  DEV_PASSWORD: 'd',
  DEMO_PASSWORD: 'demo',
  GITHUB_TOKEN: 'a-real-looking-token',
}

describe('dispatchWorkflow — demo always simulates', () => {
  /** True only if the mock GitHub endpoint was actually reached. */
  async function realDispatchWasAttempted(role: Role): Promise<boolean> {
    let reached = false
    const fetchMock = async () => {
      reached = true
      return new Response(null, { status: 204 })
    }

    const previous = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    try {
      await dispatchWorkflow(
        {
          SIMULATE_DISPATCH: 'false',
          GITHUB_TOKEN: 'a-real-looking-token',
          GITHUB_REPO: 'owner/repo',
          GITHUB_WORKFLOW: 'on-demand.yml',
        } as Bindings,
        'run-1',
        role,
        { service: 'items', tags: 'smoke' },
      )
    } finally {
      globalThis.fetch = previous
    }
    return reached
  }

  it('never reaches the GitHub API for demo, even with SIMULATE_DISPATCH false and a real token', async () => {
    expect(await realDispatchWasAttempted('demo')).toBe(false)
  })

  /**
   * The contrast that makes the test above meaningful: the same deployment,
   * same flag, same token — a different role does reach it. If `demo` and
   * `dev` produced the same answer here, decision 12 would not be a decision.
   */
  it('does reach the GitHub API for dev under the same conditions', async () => {
    expect(await realDispatchWasAttempted('dev')).toBe(true)
  })

  it("reports simulated: true for demo, so the caller isn't misled", async () => {
    const result = await dispatchWorkflow(
      {
        SIMULATE_DISPATCH: 'false',
        GITHUB_TOKEN: 'a-real-looking-token',
        GITHUB_REPO: 'owner/repo',
        GITHUB_WORKFLOW: 'on-demand.yml',
      } as Bindings,
      'run-1',
      'demo',
      { service: 'items', tags: 'smoke' },
    )

    expect(result).toEqual({ ok: true, simulated: true })
  })
})

/**
 * The same guarantee, exercised through the real HTTP surface rather than by
 * calling `dispatchWorkflow` directly — a unit test proves the function is
 * correct, not that the route actually calls it with the role it claims to.
 */
describe('POST /runs — demo cannot escape simulation through the endpoint', () => {
  /**
   * Deliberately does not wait for `waitUntil`. `simulated: true` comes back
   * in the response body before the background job — the simulator this
   * repo's other tests know sleeps for several seconds — has even started, so
   * waiting for it here would only be waiting for `setTimeout`.
   */
  async function postAsDemo(deployed: boolean) {
    const patched = {
      ...env,
      ...(deployed ? { SIMULATE_DISPATCH: 'false', ...DEPLOYED_SECRETS } : {}),
    }
    const ctx = createExecutionContext()
    return worker.fetch(
      new Request('http://api.test/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('demo') },
        body: JSON.stringify({ service: uniqueService(), tags: 'smoke' }),
      }),
      patched,
      ctx,
    )
  }

  it('creates a run for demo on a fully real deployment, and it is simulated', async () => {
    const response = await postAsDemo(true)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ simulated: true })
  })

  it('is unaffected by GITHUB_TOKEN being present and looking real', async () => {
    // DEPLOYED_SECRETS above already includes one; this test exists so that
    // fact is asserted rather than incidental to how the fixture happens to
    // be written.
    expect(DEPLOYED_SECRETS.GITHUB_TOKEN).toBeTruthy()

    const response = await postAsDemo(true)
    expect(await response.json()).toMatchObject({ simulated: true })
  })
})
