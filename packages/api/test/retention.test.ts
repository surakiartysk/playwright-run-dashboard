import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { as, migrate, request, seedRun } from './helpers'
import worker from '../src/index'
import { signReportToken } from '../src/crypto'
import { DEMO_REPORT_PREFIX, DEV_TOKEN_SECRET } from '../src/config'
import { pruneReports } from '../src/retention'
import type { RunView } from '../src/types'

beforeAll(migrate)
beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM runs`).run()
})

/**
 * How long a stored report is kept.
 *
 * A report is the detail behind a run's row, several megabytes each, and the only
 * thing that grows without bound. The rule is the one for a log someone may need
 * to read back through: remove the oldest, only when there are too many, never
 * the recent, and leave the row that says the run happened.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 7)
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString()

/** A real run whose report is stored under its own prefix. */
async function stored(id: string, ageDays: number): Promise<string> {
  await seedRun({
    id,
    status: 'passed',
    startedAt: daysAgo(ageDays),
    reportPath: `runs/${id}/index.html`,
  })
  await env.REPORTS.put(`runs/${id}/index.html`, `<h1>${id}</h1>`)
  return id
}

const hasObject = async (key: string) => (await env.REPORTS.head(key)) !== null
const rowOf = (id: string) =>
  env.DB.prepare(`SELECT report_path, report_removed_at FROM runs WHERE id = ?1`)
    .bind(id)
    .first<{ report_path: string | null; report_removed_at: string | null }>()

const options = { keep: 3, minAgeMs: 180 * DAY, batch: 25 }

describe('pruneReports', () => {
  it('removes nothing while there are no more than it keeps, however old they are', async () => {
    await stored('keep-a', 400)
    await stored('keep-b', 500)
    await stored('keep-c', 600)

    expect(await pruneReports(env.DB, env.REPORTS, NOW, options)).toBe(0)
    expect(await hasObject('runs/keep-c/index.html')).toBe(true)
    expect((await rowOf('keep-c'))?.report_removed_at).toBeNull()
  })

  it('removes nothing younger than the minimum age, however many there are', async () => {
    for (let i = 1; i <= 6; i++) await stored(`young-${i}`, i * 10)

    expect(await pruneReports(env.DB, env.REPORTS, NOW, options)).toBe(0)
    expect(await hasObject('runs/young-6/index.html')).toBe(true)
  })

  it('removes the oldest beyond what it keeps, when they are old enough, and keeps the newest', async () => {
    const ages = [400, 390, 380, 370, 360, 350]
    for (const [i, age] of ages.entries()) await stored(`old-${i}`, age)

    expect(await pruneReports(env.DB, env.REPORTS, NOW, options)).toBe(3)

    for (const i of [0, 1, 2]) expect(await hasObject(`runs/old-${i}/index.html`)).toBe(false)
    for (const i of [3, 4, 5]) expect(await hasObject(`runs/old-${i}/index.html`)).toBe(true)
  })

  it('needs both: a run outside the newest few but younger than the minimum age stays', async () => {
    await stored('mixed-new-1', 1)
    await stored('mixed-new-2', 2)
    await stored('mixed-new-3', 3)
    await stored('mixed-recent', 100)
    await stored('mixed-old', 300)

    expect(await pruneReports(env.DB, env.REPORTS, NOW, options)).toBe(1)
    expect(await hasObject('runs/mixed-recent/index.html')).toBe(true)
    expect(await hasObject('runs/mixed-old/index.html')).toBe(false)
  })

  it('keeps the run, and says its report was removed', async () => {
    for (let i = 0; i < 4; i++) await stored(`row-${i}`, 400 - i)

    await pruneReports(env.DB, env.REPORTS, NOW, options)

    const removed = await rowOf('row-0')
    expect(removed?.report_path).toBeNull()
    expect(removed?.report_removed_at).toBe(new Date(NOW).toISOString())

    const view = (await (await as('admin', '/runs/row-0')).json()) as RunView
    expect(view.status).toBe('passed')
    expect(view.reportUrl).toBeNull()
    expect(view.reportRemovedAt).toBe(new Date(NOW).toISOString())
  })

  it('does not count the shared sample, or touch it', async () => {
    await env.REPORTS.put(`${DEMO_REPORT_PREFIX}/index.html`, 'sample')
    // Newer than every real run below, so counting them would push the real ones
    // out of the newest three.
    for (let i = 0; i < 4; i++) {
      await seedRun({
        id: `sim-${i}`,
        status: 'passed',
        startedAt: daysAgo(i + 1),
        reportPath: `${DEMO_REPORT_PREFIX}/index.html`,
      })
    }
    for (let i = 0; i < 3; i++) await stored(`real-${i}`, 300 + i)
    // Old enough to be removed by age, were it a real run's report.
    await seedRun({
      id: 'sim-old',
      status: 'passed',
      startedAt: daysAgo(900),
      reportPath: `${DEMO_REPORT_PREFIX}/index.html`,
    })

    expect(await pruneReports(env.DB, env.REPORTS, NOW, options)).toBe(0)
    expect(await hasObject('runs/real-2/index.html')).toBe(true)
    expect(await hasObject(`${DEMO_REPORT_PREFIX}/index.html`)).toBe(true)
    expect(await rowOf('sim-old')).toEqual({
      report_path: `${DEMO_REPORT_PREFIX}/index.html`,
      report_removed_at: null,
    })
  })

  it('removes at most one batch per sweep, the oldest first', async () => {
    for (let i = 0; i < 8; i++) await stored(`batch-${i}`, 400 - i)

    expect(await pruneReports(env.DB, env.REPORTS, NOW, { ...options, keep: 2, batch: 2 })).toBe(2)

    expect(await hasObject('runs/batch-0/index.html')).toBe(false)
    expect(await hasObject('runs/batch-1/index.html')).toBe(false)
    expect(await hasObject('runs/batch-2/index.html')).toBe(true)
  })

  it('leaves a run that has no report alone', async () => {
    for (let i = 0; i < 4; i++) await stored(`has-${i}`, 400 - i)
    await seedRun({ id: 'never-uploaded', status: 'passed', startedAt: daysAgo(900) })

    await pruneReports(env.DB, env.REPORTS, NOW, options)

    expect(await rowOf('never-uploaded')).toEqual({ report_path: null, report_removed_at: null })
  })

  it('finishes a removal that an earlier sweep stopped halfway', async () => {
    for (let i = 0; i < 4; i++) await stored(`half-${i}`, 400 - i)
    await env.REPORTS.delete('runs/half-0/index.html')

    expect(await pruneReports(env.DB, env.REPORTS, NOW, options)).toBe(1)
    expect((await rowOf('half-0'))?.report_path).toBeNull()
  })

  it('removes only the objects under the run’s own prefix', async () => {
    for (let i = 0; i < 4; i++) await stored(`pre-${i}`, 400 - i)
    await stored('pre-0x', 20)

    await pruneReports(env.DB, env.REPORTS, NOW, options)

    expect(await hasObject('runs/pre-0/index.html')).toBe(false)
    expect(await hasObject('runs/pre-0x/index.html')).toBe(true)
  })
})

describe('the report of a run whose report was removed', () => {
  it('answers 410 and says when, not "no report"', async () => {
    for (let i = 0; i < 4; i++) await stored(`gone-${i}`, 400 - i)
    await pruneReports(env.DB, env.REPORTS, NOW, options)

    const token = await signReportToken(DEV_TOKEN_SECRET, 'gone-0')
    const response = await request(`/reports/gone-0/?token=${token}`)

    expect(response.status).toBe(410)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain('2026-10-07')
    expect(error).toContain('result is still recorded')
  })

  it('still answers 404 "no report" for a run that never had one', async () => {
    const id = await seedRun({ id: 'never-had-one', status: 'passed' })
    const token = await signReportToken(DEV_TOKEN_SECRET, id)

    const response = await request(`/reports/${id}/?token=${token}`)

    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toBe('That run has no report')
  })
})

/**
 * What the cron does with the real numbers.
 *
 * 501 runs, every one older than the minimum age: with the real constants,
 * exactly the oldest is beyond the newest 500 and old enough. It is the only
 * test that reaches `scheduled`, and it is also what pins the numbers.
 */
describe('the schedule', () => {
  it('removes the one report beyond the newest five hundred, and no other', async () => {
    const statements = []
    for (let i = 0; i < 501; i++) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO runs (id, service, tags, triggered_by, status, ref, started_at, report_path)
           VALUES (?1, 'items', 'smoke', 'qa', 'passed', 'main', ?2, ?3)`,
        ).bind(
          `sched-${i}`,
          new Date(Date.now() - (200 + i) * DAY).toISOString(),
          `runs/sched-${i}/index.html`,
        ),
      )
    }
    await env.DB.batch(statements)
    await env.REPORTS.put('runs/sched-500/index.html', 'the oldest')
    await env.REPORTS.put('runs/sched-499/index.html', 'the next oldest')

    const pending: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext
    worker.scheduled({} as ScheduledController, env, ctx)
    await Promise.all(pending)

    expect((await rowOf('sched-500'))?.report_path).toBeNull()
    expect(await hasObject('runs/sched-500/index.html')).toBe(false)
    expect((await rowOf('sched-499'))?.report_path).toBe('runs/sched-499/index.html')
    expect(await hasObject('runs/sched-499/index.html')).toBe(true)
    const removed = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM runs WHERE report_removed_at IS NOT NULL`,
    ).first<{ n: number }>()
    expect(removed?.n).toBe(1)
  })
})
