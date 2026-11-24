import { describe, expect, it, beforeAll } from 'vitest'
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { migrate } from './helpers'
import worker from '../src/index'

beforeAll(migrate)

/**
 * A deployment missing its secrets refuses to serve.
 *
 * `assertDeployable` used to only `console.error` its findings. On a Worker
 * that goes to a log nobody is watching, so a deploy without `TOKEN_SECRET`
 * would run happily and sign every report link with
 * `dev-token-secret-not-for-deployment` — a value published in this repo,
 * which means anyone could forge a link to any run's report.
 *
 * The isolate caches its verdict, so each test builds its own request rather
 * than sharing a module-level flag. That is also why the tests here use a
 * fresh env object per call.
 */

/** The test env with whatever secrets are given; deployed by the host it is called on. */
const deployed = (secrets: Record<string, string> = {}) => ({ ...env, ...secrets }) as typeof env

const ALL_SECRETS = { WEBHOOK_SECRET: 'w', TOKEN_SECRET: 't' }

async function call(bindings: typeof env, path: string) {
  const ctx = createExecutionContext()
  const response = await worker.fetch(
    new Request(`https://runs.example.com${path}`, {}),
    bindings,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return response
}

describe('a misconfigured deployment', () => {
  it('refuses to serve, naming what is missing', async () => {
    const response = await call(deployed(), '/runs')

    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: string; problems: string[] }
    expect(body.problems.join('\n')).toContain('TOKEN_SECRET')
    expect(body.problems.join('\n')).toContain('WEBHOOK_SECRET')
  })

  /**
   * Health has to stay reachable — a load balancer needs an answer, and
   * "misconfigured" is exactly what it should be told.
   */
  it('still answers health, and says it is misconfigured', async () => {
    const response = await call(deployed(), '/health')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ status: 'misconfigured' })
  })

  it('refuses the webhook too, not just the browsing surfaces', async () => {
    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request('https://runs.example.com/webhook', { method: 'POST', body: '{}' }),
      deployed(),
      ctx,
    )
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(503)
  })
})

describe('a correctly configured deployment', () => {
  it('serves normally once every secret is set', async () => {
    const response = await call(deployed(ALL_SECRETS), '/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })

  it('is unaffected on a local host, where the defaults are the point', async () => {
    const ctx = createExecutionContext()
    const response = await worker.fetch(new Request('http://api.test/health'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    // Matched exactly rather than by property, so a field added to this
    // response has to be considered rather than appearing unnoticed — which is
    // how `version` was caught being added.
    expect(await response.json()).toEqual({
      status: 'ok',
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    })
  })
})
