import { createExecutionContext, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { hmacHex } from '../src/crypto'
import { assertDeployable } from '../src/config'
import type { Bindings } from '../src/types'
import { migrate, seedRun, statusOf } from './helpers'

beforeAll(migrate)

/**
 * A secret for each suite, so a leak from one repository reaches only its runs.
 *
 * Both repositories held one shared secret, so either could write a result for
 * the other's runs. The callback is now accepted with the secret of the suite
 * the run belongs to, and refused with the other's. The old shared secret still
 * counts for both while it is set, so a deployment can move without a gap.
 */

const API = 'api-suite-secret'
const UI = 'ui-suite-secret'
const SHARED = 'the-old-shared-secret'

/** A signed callback, sent to a Worker configured with the given secrets. */
async function report(
  secret: string,
  runId: string,
  configured: Partial<Bindings>,
): Promise<Response> {
  const raw = JSON.stringify({ runId, status: 'passed', total: 3, passed: 3, failed: 0 })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await hmacHex(secret, `${timestamp}.${raw}`)
  return worker.fetch(
    new Request('http://api.test/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Timestamp': String(timestamp),
        'X-Webhook-Signature': signature,
      },
      body: raw,
    }),
    { ...env, ...configured },
    createExecutionContext(),
  )
}

const PAIR = { WEBHOOK_SECRET_API: API, WEBHOOK_SECRET_UI: UI }

describe('POST /webhook — a secret for each suite', () => {
  it("takes each suite's own secret for that suite's runs", async () => {
    const apiRun = await seedRun({ suite: 'api' })
    const uiRun = await seedRun({ suite: 'ui' })

    expect((await report(API, apiRun, PAIR)).status).toBe(200)
    expect((await report(UI, uiRun, PAIR)).status).toBe(200)
    expect(await statusOf(apiRun)).toBe('passed')
    expect(await statusOf(uiRun)).toBe('passed')
  })

  it("refuses one suite's secret for the other suite's run, and leaves the run as it was", async () => {
    const apiRun = await seedRun({ suite: 'api' })
    const uiRun = await seedRun({ suite: 'ui' })

    const uiWithApiSecret = await report(API, uiRun, PAIR)
    const apiWithUiSecret = await report(UI, apiRun, PAIR)

    expect(uiWithApiSecret.status).toBe(403)
    expect(await uiWithApiSecret.json()).toEqual({
      error: 'This secret may not report for runs of the ui suite',
    })
    expect(apiWithUiSecret.status).toBe(403)
    expect(await statusOf(uiRun)).toBe('queued')
    expect(await statusOf(apiRun)).toBe('queued')
  })

  it('still says 404 for a run that does not exist, with a good secret', async () => {
    expect((await report(API, 'no-such-run', PAIR)).status).toBe(404)
  })

  it('refuses a secret that is none of them, and the development default once any is set', async () => {
    const run = await seedRun({ suite: 'api' })

    expect((await report('not-a-secret', run, PAIR)).status).toBe(401)
    expect((await report('dev-webhook-secret-not-for-deployment', run, PAIR)).status).toBe(401)
    expect(await statusOf(run)).toBe('queued')
  })

  it('takes the old shared secret for either suite while it is still set', async () => {
    const apiRun = await seedRun({ suite: 'api' })
    const uiRun = await seedRun({ suite: 'ui' })
    const moving = { ...PAIR, WEBHOOK_SECRET: SHARED }

    expect((await report(SHARED, apiRun, moving)).status).toBe(200)
    expect((await report(SHARED, uiRun, moving)).status).toBe(200)
  })

  it('keeps the suites apart even while the old secret is set', async () => {
    const uiRun = await seedRun({ suite: 'ui' })

    expect((await report(API, uiRun, { ...PAIR, WEBHOOK_SECRET: SHARED })).status).toBe(403)
  })

  it('refuses the old shared secret once it is gone', async () => {
    const run = await seedRun({ suite: 'api' })

    expect((await report(SHARED, run, PAIR)).status).toBe(401)
  })
})

describe('what a real deployment must have set', () => {
  const real: Partial<Bindings> = {
    SIMULATE_DISPATCH: 'false',
    TOKEN_SECRET: 't',
    ADMIN_PASSWORD: 'a',
    QA_PASSWORD: 'q',
    DEV_PASSWORD: 'd',
  }
  const forgeable = (extra: Partial<Bindings>) =>
    assertDeployable({ ...env, ...real, ...extra }).filter((p) => p.includes('forgeable'))

  it('accepts the one shared secret, or both suites’ own', () => {
    expect(forgeable({ WEBHOOK_SECRET: SHARED })).toEqual([])
    expect(forgeable(PAIR)).toEqual([])
  })

  it('refuses none, and refuses only one suite’s', () => {
    expect(forgeable({})).toHaveLength(1)
    expect(forgeable({ WEBHOOK_SECRET_API: API })).toHaveLength(1)
    expect(forgeable({ WEBHOOK_SECRET_UI: UI })).toHaveLength(1)
  })
})
