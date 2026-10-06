import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest'
import { env, createExecutionContext } from 'cloudflare:test'
import { migrate, sessionFor, settle } from './helpers'
import { DEV_TOKEN_SECRET } from '../src/config'
import { outcome } from '../src/simulate'
import worker from '../src/index'
import type { Role, RunView } from '../src/types'

beforeAll(migrate)

/**
 * A visitor can ask a simulated run to fail.
 *
 * The simulator failed one run in five at random, which is how the red path was
 * reachable at all, and also why someone who came to see the failures panel had
 * to click Run until the dice agreed. `outcome` lets them ask: `random` is the
 * old behaviour, `pass` and `fail` are outright. A real run takes none of it.
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

async function post(role: Role, body: object, real: boolean) {
  const previous = globalThis.fetch
  // GitHub answering a real dispatch the way it does.
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch
  try {
    return await worker.fetch(
      new Request('http://api.test/runs', {
        method: 'POST',
        body: JSON.stringify({ service: 'items', tags: 'all', ...body }),
        headers: { 'Content-Type': 'application/json', Cookie: await sessionFor(role) },
      }),
      real ? { ...env, ...REAL_DEPLOYMENT } : env,
      createExecutionContext(),
    )
  } finally {
    globalThis.fetch = previous
  }
}

/**
 * The decision itself, with the dice injected so each case is one fixed roll.
 *
 * A roll of 0.9 is a run that passes by chance and 0.1 one that fails by
 * chance (the threshold is 0.2); the mode must override both.
 */
describe('outcome', () => {
  const lucky = () => 0.9
  const unlucky = () => 0.1

  it('leaves `random` to chance, as the simulator always did', () => {
    expect(outcome('api', 'all', 'random', lucky).status).toBe('passed')
    expect(outcome('api', 'all', 'random', unlucky).status).toBe('failed')
  })

  it('fails outright when asked, whatever the roll', () => {
    const result = outcome('api', 'all', 'fail', lucky)
    expect(result.status).toBe('failed')
    expect(result.failed).toBeGreaterThanOrEqual(1)
    expect(result.passed + result.failed).toBe(result.total)
  })

  it('passes outright when asked, whatever the roll', () => {
    const result = outcome('api', 'all', 'pass', unlucky)
    expect(result).toMatchObject({ status: 'passed', failed: 0 })
    expect(result.passed).toBe(result.total)
  })

  /** One to three, as it always was: a failure panel of one reads as a typo. */
  it('fails between one and three tests', () => {
    expect(outcome('api', 'all', 'fail', () => 0).failed).toBe(1)
    expect(outcome('api', 'all', 'fail', () => 0.999).failed).toBe(3)
  })
})

describe('POST /runs outcome', () => {
  it('refuses a mode it does not know, naming the ones it does', async () => {
    const response = await post('demo', { outcome: 'flaky' }, false)
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: string }).error).toBe(
      'outcome must be one of: random, pass, fail',
    )
  })

  /** Ignoring it would answer a request for a failure with a green run. */
  it('refuses `fail` for a real run rather than ignoring it', async () => {
    const response = await post('qa', { outcome: 'fail' }, true)
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: string }).error).toContain('only to simulated')
  })

  it('refuses `pass` for a real run too', async () => {
    expect((await post('admin', { outcome: 'pass' }, true)).status).toBe(422)
  })

  /** The form sends `random` whenever the field is shown or not. */
  it('takes `random`, or nothing, for a real run', async () => {
    expect((await post('qa', { outcome: 'random' }, true)).status).toBe(201)
    expect((await post('qa', {}, true)).status).toBe(201)
  })

  it('takes `fail` from demo, which always simulates, even on a real deployment', async () => {
    const response = await post('demo', { outcome: 'fail' }, true)
    expect(response.status).toBe(201)
    expect(((await response.json()) as { simulated: boolean }).simulated).toBe(true)
  })
})

/**
 * The mode reaches the simulator, and the run it finishes says so.
 *
 * Through the endpoint and waiting for the simulation, because the unit cases
 * above cannot show that the handler passes the mode on. Slow by nature: the
 * simulator sleeps on purpose so a person watching sees the transition.
 */
describe('a requested failure', { timeout: 30_000 }, () => {
  type Finished = RunView & { details: { failures: { title: string }[] } | null }

  afterEach(() => vi.restoreAllMocks())

  /**
   * The dice are loaded against the request.
   *
   * Asking for `fail` with a roll that would pass by chance, and `pass` with
   * one that would fail, so a simulator that went back to chance cannot satisfy
   * either by luck. Left to the real dice, a handler that dropped the mode
   * would still pass these four times in five, and the mutation that proves
   * they can fail would be caught only some of the time.
   */
  async function finished(mode: 'fail' | 'pass'): Promise<Finished> {
    vi.spyOn(Math, 'random').mockReturnValue(mode === 'fail' ? 0.9 : 0.1)
    const created = await settle('/runs', {
      method: 'POST',
      body: JSON.stringify({ service: 'items', tags: 'all', outcome: mode }),
      headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('demo') },
    })
    expect(created.status).toBe(201)
    const { runId } = (await created.json()) as { runId: string }

    const read = await settle(`/runs/${runId}`, {
      headers: { Cookie: await sessionFor('admin') },
    })
    return (await read.json()) as Finished
  }

  it('comes back failed, and names what failed', async () => {
    const run = await finished('fail')
    expect(run.status).toBe('failed')
    expect(run.failed).toBeGreaterThanOrEqual(1)
    expect(run.simulated).toBe(true)
    // Not a red row with nothing to read: the panel it exists to show is full.
    expect(run.details?.failures.length).toBe(run.failed)
  })

  it('comes back passed when asked for that', async () => {
    const run = await finished('pass')
    expect(run.status).toBe('passed')
    expect(run.failed).toBe(0)
    expect(run.details).toBeNull()
  })
})
