import { describe, expect, it, beforeAll } from 'vitest'
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { migrate, sessionFor } from './helpers'
import { DEV_TOKEN_SECRET } from '../src/config'
import worker from '../src/index'

beforeAll(migrate)

/**
 * Which way round the loud error runs.
 *
 * `SIMULATE_DISPATCH` is opt-out: an unset flag is not `'false'`, so a
 * deployment that sets a GITHUB_TOKEN and forgets the flag **simulates,
 * silently**. It does not fail, and `assertDeployable` says nothing — it
 * returns early the moment simulation is on.
 *
 * That is one of the two things CLAUDE.md records as having actually
 * broken a deployment: `wrangler deploy` without `--var` reverts to
 * simulating, and the dashboard keeps working while dispatching nothing.
 *
 * Nothing pinned it. Every other test that sets a token sets
 * `SIMULATE_DISPATCH: 'false'` alongside it, or is about `demo` — which
 * overrides the flag anyway — so the one combination a real deployment
 * actually gets wrong was the one combination untested, and a comment in
 * `github.ts` claimed the opposite behaviour.
 *
 * Pinned here so that making it fail loudly is a decision someone takes on
 * purpose, against the reason it was not: `assertDeployable` refuses to serve,
 * so promoting this to a startup problem locks out anyone keeping a token in a
 * local `.env` while simulating.
 */
describe('POST /runs — a token without the flag still simulates', () => {
  /**
   * Deliberately does not wait for `waitUntil`: `simulated` comes back in the
   * response body before the background simulator has started. Same pattern as
   * demo-role-safety.test.ts.
   */
  async function postAsQa(patch: Record<string, string>) {
    const ctx = createExecutionContext()
    return worker.fetch(
      new Request('http://api.test/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('qa') },
        body: JSON.stringify({ service: 'items', tags: 'all' }),
      }),
      { ...env, ...patch },
      ctx,
    )
  }

  it('simulates when a real-looking token is set but the flag is unset', async () => {
    // `qa`, not `demo` — demo overrides the flag, so it cannot show this.
    const response = await postAsQa({ GITHUB_TOKEN: 'a-real-looking-token' })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ simulated: true })
  })

  it('still simulates when the flag says anything other than exactly false', async () => {
    // The comparison is `!== 'false'`, so 'FALSE' and '0' are not opt-outs.
    // Someone reading the flag as a boolean would expect otherwise.
    for (const value of ['FALSE', '0', 'no', '']) {
      const response = await postAsQa({
        GITHUB_TOKEN: 'a-real-looking-token',
        SIMULATE_DISPATCH: value,
      })

      expect(await response.json(), `SIMULATE_DISPATCH=${JSON.stringify(value)}`).toMatchObject({
        simulated: true,
      })
    }
  })

  /*
   * The direction that *does* fail loudly, so the pair is visible: one of
   * these two configurations is silent and the other is not, and which is
   * which is the whole point of this file.
   *
   * Every other secret has to be present to reach it. `assertDeployable` runs
   * first and refuses to serve at all when a deployment opts out of simulation
   * on development secrets, so `dispatchWorkflow`'s own missing-token error is
   * only reachable once that gate is satisfied — which is worth knowing, since
   * the two failures read very differently to whoever is deploying.
   */
  it('reports the missing token once the deployment is otherwise configured', async () => {
    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request('http://api.test/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('qa') },
        body: JSON.stringify({ service: 'items', tags: 'all' }),
      }),
      {
        ...env,
        SIMULATE_DISPATCH: 'false',
        WEBHOOK_SECRET: 'w',
        TOKEN_SECRET: DEV_TOKEN_SECRET,
        ADMIN_PASSWORD: 'a',
        QA_PASSWORD: 'q',
        DEV_PASSWORD: 'd',
        GITHUB_TOKEN: undefined,
      } as typeof env,
      ctx,
    )
    await waitOnExecutionContext(ctx)

    const body = (await response.json()) as { simulated?: boolean; error?: string }
    expect(body.simulated).not.toBe(true)
    expect(JSON.stringify(body)).toMatch(/GITHUB_TOKEN/)
  })
})
