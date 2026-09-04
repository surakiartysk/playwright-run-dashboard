import { describe, expect, it, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, postWebhook, request, seedRun, statusOf } from './helpers'
import { hmacHex } from '../src/crypto'
import { DEV_WEBHOOK_SECRET } from '../src/config'

beforeEach(migrate)

/**
 * The webhook writes the numbers the dashboard shows, so it is the endpoint
 * worth attacking: anyone who learns a run id and can post unsigned would be
 * able to mark a failing run green.
 */
describe('POST /webhook — what it refuses', () => {
  it('refuses a request with no signature at all', async () => {
    const id = await seedRun()

    const response = await request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: id, status: 'passed' }),
    })

    expect(response.status).toBe(400)
    expect(await statusOf(id)).toBe('queued')
  })

  it('refuses a signature made with the wrong secret', async () => {
    const id = await seedRun()

    const response = await postWebhook(
      { runId: id, status: 'passed' },
      { secret: 'not-the-secret' },
    )

    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('queued')
  })

  /**
   * The signature covers `timestamp.body`. Signing the body alone would leave
   * a captured request replayable forever — this is the test that would fail
   * if someone "simplified" the signed payload back to just the body.
   */
  it('refuses a body whose signature covers the body alone', async () => {
    const id = await seedRun()
    const raw = JSON.stringify({ runId: id, status: 'passed' })

    const response = await postWebhook(raw, {
      signature: await hmacHex(DEV_WEBHOOK_SECRET, raw),
    })

    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('queued')
  })

  it('refuses a validly signed request that is too old to be fresh', async () => {
    const id = await seedRun()

    const response = await postWebhook(
      { runId: id, status: 'passed' },
      { timestamp: Math.floor(Date.now() / 1000) - 600 },
    )

    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('queued')
  })

  it('refuses a timestamp far in the future', async () => {
    const id = await seedRun()

    const response = await postWebhook(
      { runId: id, status: 'passed' },
      { timestamp: Math.floor(Date.now() / 1000) + 3600 },
    )

    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('queued')
  })

  it('tolerates small clock skew, so a slightly fast runner still reports', async () => {
    const id = await seedRun()

    const response = await postWebhook(
      { runId: id, status: 'passed' },
      { timestamp: Math.floor(Date.now() / 1000) + 30 },
    )

    expect(response.status).toBe(200)
  })

  it('refuses a body that was altered after signing', async () => {
    const id = await seedRun()
    const timestamp = Math.floor(Date.now() / 1000)
    const signed = JSON.stringify({ runId: id, status: 'failed' })

    const response = await request('/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Timestamp': String(timestamp),
        'X-Webhook-Signature': await hmacHex(DEV_WEBHOOK_SECRET, `${timestamp}.${signed}`),
      },
      // Signed as failed, sent as passed.
      body: JSON.stringify({ runId: id, status: 'passed' }),
    })

    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('queued')
  })

  it('rejects a signed body that is not JSON', async () => {
    const response = await postWebhook('not json at all')
    expect(response.status).toBe(400)
  })

  it('rejects a signed payload missing runId or status', async () => {
    expect((await postWebhook({ status: 'passed' })).status).toBe(422)
    expect((await postWebhook({ runId: 'x' })).status).toBe(422)
  })

  it('404s a signed callback for a run that does not exist', async () => {
    const response = await postWebhook({ runId: 'never-created', status: 'passed' })
    expect(response.status).toBe(404)
  })
})

describe('POST /webhook — what it accepts', () => {
  it('records a full result', async () => {
    const id = await seedRun()

    const response = await postWebhook({
      runId: id,
      status: 'failed',
      total: 83,
      passed: 80,
      failed: 3,
      durationMs: 4200,
      reportPath: `runs/${id}/index.html`,
    })

    expect(response.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM runs WHERE id = ?1').bind(id).first<{
      status: string
      total: number
      passed: number
      failed: number
      duration_ms: number
      report_path: string
      finished_at: string
    }>()

    expect(row).toMatchObject({
      status: 'failed',
      total: 83,
      passed: 80,
      failed: 3,
      duration_ms: 4200,
      report_path: `runs/${id}/index.html`,
    })
    expect(row?.finished_at).not.toBeNull()
  })

  /**
   * `report_path` uses COALESCE, so a later callback that omits it must not
   * erase a report that was already uploaded.
   */
  it('does not erase an existing report path when a later callback omits it', async () => {
    const id = await seedRun({ reportPath: `runs/keep/index.html` })

    await postWebhook({ runId: id, status: 'passed', total: 1, passed: 1, failed: 0 })

    const row = await env.DB.prepare('SELECT report_path FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ report_path: string }>()

    expect(row?.report_path).toBe('runs/keep/index.html')
  })

  /**
   * Which suite produced a result is the whole point of recording it — a run
   * whose version was dropped is a result nobody can trace back to a tree.
   */
  it('records the suite version and sha the workflow reported', async () => {
    const id = await seedRun()

    await postWebhook({
      runId: id,
      status: 'passed',
      total: 3,
      passed: 3,
      failed: 0,
      suiteVersion: '1.2.0',
      suiteSha: 'a'.repeat(40),
    })

    const row = await env.DB.prepare('SELECT suite_version, suite_sha FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ suite_version: string; suite_sha: string }>()

    expect(row).toMatchObject({ suite_version: '1.2.0', suite_sha: 'a'.repeat(40) })
  })

  /**
   * The same COALESCE reasoning as `report_path` above, and the case that made
   * it necessary: a workflow older than these fields sends neither, and a
   * second callback from one would otherwise wipe the version a first callback
   * had already recorded.
   */
  it('does not erase a recorded suite version when a later callback omits it', async () => {
    const id = await seedRun()

    await postWebhook({
      runId: id,
      status: 'passed',
      suiteVersion: '1.2.0',
      suiteSha: 'b'.repeat(40),
    })
    await postWebhook({ runId: id, status: 'failed', total: 1, passed: 0, failed: 1 })

    const row = await env.DB.prepare('SELECT suite_version, status FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ suite_version: string; status: string }>()

    // The status moved, proving the second callback was applied — and the
    // version survived it.
    expect(row).toMatchObject({ suite_version: '1.2.0', status: 'failed' })
  })

  /**
   * A run that was never told a version must read as unknown rather than as a
   * version, so the UI can leave the chip off instead of inventing one.
   */
  it('leaves the suite version null when no callback reported one', async () => {
    const id = await seedRun()

    await postWebhook({ runId: id, status: 'passed', total: 1, passed: 1, failed: 0 })

    const row = await env.DB.prepare('SELECT suite_version, suite_sha FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ suite_version: string | null; suite_sha: string | null }>()

    expect(row).toMatchObject({ suite_version: null, suite_sha: null })
  })
})
