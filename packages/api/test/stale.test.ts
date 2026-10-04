import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { STALE_AFTER_MS, sweepStaleRuns } from '../src/stale'
import { migrate, postWebhook, seedRun, statusOf } from './helpers'
import type { RunStatus } from '../src/types'

/**
 * Ending the runs that will never report.
 *
 * Each test seeds its own rows and reads them back by id: storage is shared
 * across the file, so a count of all runs would be a count of other tests'.
 */

beforeAll(migrate)

const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const minutes = (n: number) => n * 60 * 1000

const seed = (status: RunStatus, startedAgoMs: number) =>
  seedRun({ status, startedAt: ago(startedAgoMs) })

describe('sweepStaleRuns', () => {
  it('ends a queued run older than the limit', async () => {
    const id = await seed('queued', minutes(45))
    await sweepStaleRuns(env.DB, NOW)
    expect(await statusOf(id)).toBe('timeout')
  })

  it('ends a running run older than the limit', async () => {
    const id = await seed('running', minutes(31))
    await sweepStaleRuns(env.DB, NOW)
    expect(await statusOf(id)).toBe('timeout')
  })

  it('leaves a run that is still within its time', async () => {
    const queued = await seed('queued', minutes(5))
    const running = await seed('running', minutes(29))
    await sweepStaleRuns(env.DB, NOW)
    expect(await statusOf(queued)).toBe('queued')
    expect(await statusOf(running)).toBe('running')
  })

  /** Exactly at the limit is not past it: the cutoff is strict. */
  it('leaves a run exactly at the limit, and ends one a millisecond past it', async () => {
    const atLimit = await seed('running', STALE_AFTER_MS)
    const past = await seed('running', STALE_AFTER_MS + 1)
    await sweepStaleRuns(env.DB, NOW)
    expect(await statusOf(atLimit)).toBe('running')
    expect(await statusOf(past)).toBe('timeout')
  })

  /** A run with a result keeps it, however old. */
  it.each(['passed', 'failed', 'error', 'timeout'] as const)(
    'never touches a finished run (%s)',
    async (status) => {
      const id = await seed(status, minutes(600))
      await sweepStaleRuns(env.DB, NOW)
      expect(await statusOf(id)).toBe(status)
    },
  )

  it('stamps when it ended the run', async () => {
    const id = await seed('running', minutes(60))
    await sweepStaleRuns(env.DB, NOW)
    const row = await env.DB.prepare(`SELECT finished_at FROM runs WHERE id = ?1`)
      .bind(id)
      .first<{ finished_at: string }>()
    expect(row?.finished_at).toBe(new Date(NOW).toISOString())
  })

  it('says how many it ended', async () => {
    await seed('queued', minutes(90))
    await seed('running', minutes(90))
    expect(await sweepStaleRuns(env.DB, NOW)).toBeGreaterThanOrEqual(2)
    // Nothing left to end: a second sweep is a no-op, not an error.
    expect(await sweepStaleRuns(env.DB, NOW)).toBe(0)
  })

  /**
   * The sweep is a guess and the callback is the fact. A real result that
   * arrives late must replace the timeout, not be refused by it.
   */
  it('lets a late result replace the timeout', async () => {
    const id = await seed('running', minutes(60))
    await sweepStaleRuns(env.DB, NOW)
    expect(await statusOf(id)).toBe('timeout')

    const response = await postWebhook({
      runId: id,
      status: 'passed',
      total: 3,
      passed: 3,
      failed: 0,
    })
    expect(response.status).toBe(200)
    expect(await statusOf(id)).toBe('passed')
  })
})

describe('the schedule', () => {
  it('runs the sweep when the cron fires, and waits for it', async () => {
    const id = await seed('running', STALE_AFTER_MS + minutes(60))
    // `Date.now()` is the real clock here, and the seeded run is an hour past
    // the limit by it, so the handler's own clock reaches the same verdict.
    const pending: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext
    // The real clock, so the run seeded relative to NOW is also hours old by it.
    await env.DB.prepare(`UPDATE runs SET started_at = ?2 WHERE id = ?1`)
      .bind(id, new Date(Date.now() - STALE_AFTER_MS - minutes(60)).toISOString())
      .run()

    worker.scheduled({} as ScheduledController, env, ctx)
    await Promise.all(pending)

    expect(pending).toHaveLength(1)
    expect(await statusOf(id)).toBe('timeout')
  })
})
