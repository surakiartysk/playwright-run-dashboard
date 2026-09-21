import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, seedRun, statusOf, postWebhook, request } from './helpers'
import { simulateRun } from '../src/simulate'
import { signReportToken } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'

beforeAll(migrate)

/**
 * The simulator races the webhook, and the webhook must win.
 *
 * Both write the same row. Without a guard whichever lands second overwrites
 * the other, and locally that is reachable: post a signed webhook for a
 * simulated run and the simulator clobbers the result a second later, which
 * looks exactly like the webhook silently failing.
 *
 * These tests call `simulateRun` directly rather than through `POST /runs`,
 * because the point is what it does to a row that changed underneath it —
 * awkward to arrange through the endpoint, and slower still.
 *
 * The timeout is raised because the sleeps are the feature: the simulator
 * pauses so that someone watching the dashboard sees queued become running
 * rather than a row that is finished before it renders. Stubbing the clock
 * would remove the ordering these tests are about.
 */
describe('simulateRun', { timeout: 20_000 }, () => {
  /*
   * A simulation that dies mid-flight must not leave the row in `running`.
   *
   * `POST /runs` hands the simulator to `waitUntil` and returns. A real
   * dispatch that fails is recorded — twenty lines above, the handler writes
   * `status = 'error'` — but a simulation that throws was recorded nowhere, so
   * the row kept whatever state it had reached and nothing would ever change
   * it again. There is no sweeper, no cron trigger and no timeout anywhere in
   * this Worker: `running` is where it stays, permanently.
   *
   * CLAUDE.md names that exact symptom — "runs that never leave `running`" —
   * as what the worst deployment failure here looked like from outside, which
   * is why a second way of producing it is worth closing rather than leaving
   * to the simulator being reliable.
   *
   * The DB is replaced with one that fails the finishing write specifically,
   * matched on `duration_ms` — a column only that write sets.
   *
   * Matching on `finished_at` instead looks equivalent and is not: the write
   * that *records* the failure sets it too, so the fake broke both and the
   * test failed while the code under it was already correct. A fake that is
   * too broad tests the fake.
   */
  it('marks the run as errored when the finishing write fails', async () => {
    const id = await seedRun({ status: 'queued' })

    let seen = 0
    const failing = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        // Only the finishing write sets a duration.
        if (query.includes('duration_ms')) {
          seen += 1
          return {
            bind: () => ({
              run: () => Promise.reject(new Error('D1 is unavailable')),
            }),
          }
        }
        return statement
      },
    }

    await simulateRun({ ...env, DB: failing } as unknown as typeof env, id, 'api', 'items')

    expect(seen, 'the failing write must actually have been attempted').toBe(1)
    expect(await statusOf(id)).toBe('error')
  })

  /*
   * ...and must not overwrite a result that arrived while it was failing.
   *
   * The pair to the test above, and the one that earns the in-flight guard on
   * the error write. Without it that test still passes: a run that reaches
   * `error` from `running` looks identical whether or not the guard is there.
   *
   * Removing `AND status IN ('queued', 'running')` from the error write passed
   * every other test in this file, which is how untested insurance stops
   * working without anyone noticing. Here the webhook has already landed, so
   * the simulator failing afterwards must find the row finished and leave it —
   * the webhook holds the real answer and the simulator's own failure is the
   * less interesting fact.
   */
  it('leaves a result the webhook already wrote when it fails afterwards', async () => {
    const id = await seedRun({ status: 'passed' })

    const failing = {
      prepare(query: string) {
        if (query.includes('duration_ms')) {
          return { bind: () => ({ run: () => Promise.reject(new Error('D1 is unavailable')) }) }
        }
        return env.DB.prepare(query)
      },
    }

    await simulateRun({ ...env, DB: failing } as unknown as typeof env, id, 'api', 'items')

    expect(await statusOf(id)).toBe('passed')
  })

  it('advances a queued run to a finished state', async () => {
    const id = await seedRun({ status: 'queued' })

    await simulateRun(env, id, 'api', 'items')

    expect(['passed', 'failed']).toContain(await statusOf(id))
  })

  /**
   * A simulated run reports a size that belongs to the suite it claims.
   *
   * One figure was hardcoded for every run before the second suite existed,
   * so the demo reported the same total whichever suite was picked — for the
   * UI suite, roughly twice the tests it has, on the most visible page of the
   * deployment.
   *
   * The bound is deliberately loose. Pinning an exact number would make this
   * fail every time a suite gains a test, which is not what it is protecting:
   * the bug was a *category* error, one suite reporting the other's size.
   * Verified able to fail — with the suite argument ignored and the API size
   * used for both, the `ui` case reports well past 60 and this goes red.
   */
  it.each([
    ['api', 60, 400],
    ['ui', 1, 60],
  ] as const)('reports a %s-sized run', async (suite, min, max) => {
    const id = await seedRun({ status: 'queued' })

    await simulateRun(env, id, suite, 'all')

    const row = await env.DB.prepare('SELECT total FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ total: number }>()
    expect(row?.total).toBeGreaterThanOrEqual(min)
    expect(row?.total).toBeLessThanOrEqual(max)
  })

  /**
   * The simulator points at the shared Allure report rather than writing one
   * of its own — see DEMO_REPORT_PREFIX.
   *
   * The literal prefix is asserted rather than interpolating the constant.
   * Writing `${DEMO_REPORT_PREFIX}/index.html` on both sides makes the test
   * agree with the code by construction: renaming the constant renames the
   * expectation too, and the assertion passes while every deployed report link
   * 404s, because the bytes live under the *old* prefix that was uploaded to.
   * Verified — with the constant interpolated here, changing it to 'nowhere'
   * left this file green.
   */
  it('points the run at a report the reports endpoint can serve', async () => {
    const id = await seedRun({ status: 'queued' })
    await env.REPORTS.put('demo-report/index.html', '<h1>allure</h1>', {
      httpMetadata: { contentType: 'text/html' },
    })

    await simulateRun(env, id, 'api', 'items')

    const row = await env.DB.prepare('SELECT report_path FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ report_path: string }>()
    expect(row?.report_path).toBe('demo-report/index.html')

    // The link a reader would actually click, followed end to end — a
    // `report_path` naming a prefix nothing was uploaded to would satisfy a
    // column-only assertion and still hand the reader a 404.
    const opened = await request(
      `/reports/${id}/?token=${await signReportToken(DEV_TOKEN_SECRET, id)}`,
    )
    expect(opened.status).toBe(200)
    expect(await opened.text()).toContain('allure')
  })

  it('does not overwrite a run a webhook already finished', async () => {
    const id = await seedRun({ status: 'queued' })

    // The real callback lands first, with numbers the simulator would not pick.
    const webhook = await postWebhook({
      runId: id,
      status: 'passed',
      total: 999,
      passed: 999,
      failed: 0,
    })
    expect(webhook.status).toBe(200)

    await simulateRun(env, id, 'api', 'items')

    const row = await env.DB.prepare('SELECT status, total, passed FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ status: string; total: number; passed: number }>()

    // The guard is `WHERE status IN ('queued','running')`; the row is neither.
    expect(row).toMatchObject({ status: 'passed', total: 999, passed: 999 })
  })

  it.each(['passed', 'failed', 'error', 'timeout'] as const)(
    'leaves a run already in %s alone',
    async (status) => {
      const id = await seedRun({ status })

      await simulateRun(env, id, 'api', 'items')

      expect(await statusOf(id)).toBe(status)
    },
  )

  it('does not touch a different run', async () => {
    const target = await seedRun({ status: 'queued' })
    const bystander = await seedRun({ status: 'queued' })

    await simulateRun(env, target, 'api', 'items')

    expect(await statusOf(bystander)).toBe('queued')
  })
})
