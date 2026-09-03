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
  it('advances a queued run to a finished state', async () => {
    const id = await seedRun({ status: 'queued' })

    await simulateRun(env, id, 'items')

    expect(['passed', 'failed']).toContain(await statusOf(id))
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

    await simulateRun(env, id, 'items')

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

    await simulateRun(env, id, 'items')

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

      await simulateRun(env, id, 'items')

      expect(await statusOf(id)).toBe(status)
    },
  )

  it('does not touch a different run', async () => {
    const target = await seedRun({ status: 'queued' })
    const bystander = await seedRun({ status: 'queued' })

    await simulateRun(env, target, 'items')

    expect(await statusOf(bystander)).toBe('queued')
  })
})
