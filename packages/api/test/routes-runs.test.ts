import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, as, seedRun, uniqueService, runsForService } from './helpers'
import type { RunView } from '../src/types'

beforeAll(migrate)

type Role = 'dev' | 'qa' | 'admin'

/**
 * Lists runs for one service only.
 *
 * The database is shared across this file, so every assertion is scoped to
 * rows the test itself created. Asserting on the whole list would make each
 * test depend on which others ran first — the failure mode that is invisible
 * until the suite is reordered or run in parallel.
 */
async function listFor(role: Role, service: string): Promise<RunView[]> {
  const response = await as(role, '/runs?limit=100')
  expect(response.status).toBe(200)
  const { runs } = (await response.json()) as { runs: RunView[] }
  return runs.filter((run) => run.service === service)
}

const create = (role: Role, body: unknown) =>
  as(role, '/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/**
 * Visibility is the rule most easily faked into passing.
 *
 * Each test seeds a run the role may see *and* one it may not, so a handler
 * that stopped filtering would fail. Asserting only that the main-branch run
 * is present would pass with no scoping at all.
 */
describe('GET /runs — visibility', () => {
  it('shows dev only main-branch runs', async () => {
    const service = uniqueService()
    const visible = await seedRun({ service, ref: 'main' })
    const hidden = await seedRun({ service, ref: 'develop' })

    const ids = (await listFor('dev', service)).map((run) => run.id)

    expect(ids).toContain(visible)
    expect(ids).not.toContain(hidden)
  })

  it.each(['qa', 'admin'] as const)('shows %s runs on every branch', async (role) => {
    const service = uniqueService()
    const onMain = await seedRun({ service, ref: 'main' })
    const onDevelop = await seedRun({ service, ref: 'develop' })

    const ids = (await listFor(role, service)).map((run) => run.id)

    expect(ids).toEqual(expect.arrayContaining([onMain, onDevelop]))
  })

  it('applies the status filter alongside the visibility clause', async () => {
    const service = uniqueService()
    const wanted = await seedRun({ service, ref: 'main', status: 'passed' })
    await seedRun({ service, ref: 'main', status: 'failed' })
    await seedRun({ service, ref: 'develop', status: 'passed' })

    const response = await as('dev', '/runs?status=passed&limit=100')
    const { runs } = (await response.json()) as { runs: RunView[] }

    const mine = runs.filter((run) => run.service === service)
    expect(mine.map((run) => run.id)).toEqual([wanted])
  })

  it('never returns a non-main run to dev, whatever else is in the table', async () => {
    const service = uniqueService()
    await seedRun({ service, ref: 'develop' })
    await seedRun({ service, ref: 'release' })

    const response = await as('dev', '/runs?limit=100')
    const { runs } = (await response.json()) as { runs: RunView[] }

    // Not scoped to this test's service on purpose: the guarantee is about
    // every row the endpoint is willing to hand a dev, not just these.
    expect(runs.every((run: RunView) => run.ref === 'main')).toBe(true)
  })
})

describe('GET /runs/:id — visibility', () => {
  it('404s a run on a branch dev may not see', async () => {
    const hidden = await seedRun({ ref: 'develop' })

    // 404 rather than 403: telling a developer the run exists would leak the
    // branch names they were scoped away from.
    expect((await as('dev', `/runs/${hidden}`)).status).toBe(404)
  })

  it('serves that same run to qa', async () => {
    const id = await seedRun({ ref: 'develop' })
    expect((await as('qa', `/runs/${id}`)).status).toBe(200)
  })

  it('404s a run that does not exist', async () => {
    expect((await as('admin', '/runs/no-such-run')).status).toBe(404)
  })
})

describe('POST /runs — policy enforcement', () => {
  it('lets dev run against main', async () => {
    const response = await create('dev', { service: uniqueService(), tags: 'smoke', ref: 'main' })
    expect(response.status).toBe(201)
  })

  it('refuses dev a branch it may not use, with 403 rather than 422', async () => {
    const response = await create('dev', {
      service: uniqueService(),
      tags: 'smoke',
      ref: 'develop',
    })

    // The request is well-formed; the caller simply may not make it.
    expect(response.status).toBe(403)
  })

  it('records no run when the ref is refused', async () => {
    const service = uniqueService()
    await create('dev', { service, tags: 'smoke', ref: 'develop' })

    expect(await runsForService(service)).toHaveLength(0)
  })

  it('refuses more workers than the role may use', async () => {
    const service = uniqueService()
    const response = await create('dev', { service, tags: 'smoke', workers: 8 })

    expect(response.status).toBe(403)
    expect(await runsForService(service)).toHaveLength(0)
  })

  it('allows qa the worker count it refuses dev', async () => {
    expect(
      (await create('dev', { service: uniqueService(), tags: 'smoke', workers: 8 })).status,
    ).toBe(403)
    expect(
      (await create('qa', { service: uniqueService(), tags: 'smoke', workers: 8 })).status,
    ).toBe(201)
  })

  it('lets admin use a branch no other role may', async () => {
    const response = await create('admin', {
      service: uniqueService(),
      tags: 'smoke',
      ref: 'feature/whatever',
    })
    expect(response.status).toBe(201)
  })

  it.each([
    ['a service with a slash', { service: 'items/x', tags: 'smoke' }],
    ['a service starting with a digit', { service: '1items', tags: 'smoke' }],
    ['an empty service', { service: '', tags: 'smoke' }],
    ['an uppercase tag', { service: 'items', tags: 'Smoke' }],
    ['a ref with a space', { service: 'items', tags: 'smoke', ref: 'ma in' }],
    ['zero workers', { service: 'items', tags: 'smoke', workers: 0 }],
    ['fractional workers', { service: 'items', tags: 'smoke', workers: 1.5 }],
  ])('rejects %s with 422', async (_label, body) => {
    expect((await create('admin', body)).status).toBe(422)
  })

  it('records the requesting role as who triggered it, and defaults to main', async () => {
    const service = uniqueService()
    await create('qa', { service, tags: 'smoke' })

    expect(await runsForService(service)).toEqual([
      expect.objectContaining({ triggered_by: 'qa', ref: 'main' }),
    ])
  })

  /**
   * Minute-precision ids collided on the PRIMARY KEY, so the second run of a
   * service within the same minute got a 500 for doing nothing wrong. Two
   * people pressing Run on the same service is ordinary, not an edge case.
   */
  it('accepts two runs of the same service in the same minute', async () => {
    const service = uniqueService()

    const first = await create('admin', { service, tags: 'smoke' })
    const second = await create('admin', { service, tags: 'smoke' })

    expect([first.status, second.status]).toEqual([201, 201])

    const runs = await runsForService(service)
    expect(runs).toHaveLength(2)
    expect(new Set(runs.map((run) => run.id)).size).toBe(2)
  })
})

describe('DELETE /runs/:id', () => {
  it('removes the row and the report objects together', async () => {
    const id = await seedRun({ reportPath: 'x' })
    await env.REPORTS.put(`runs/${id}/index.html`, '<html></html>')
    await env.REPORTS.put(`runs/${id}/assets/app.js`, 'console.log(1)')

    const response = await as('admin', `/runs/${id}`, { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ deletedObjects: 2 })

    expect(await env.DB.prepare('SELECT id FROM runs WHERE id = ?1').bind(id).first()).toBeNull()
    expect((await env.REPORTS.list({ prefix: `runs/${id}/` })).objects).toHaveLength(0)
  })

  it('does not touch another run’s report', async () => {
    const doomed = await seedRun()
    const keep = await seedRun()
    await env.REPORTS.put(`runs/${doomed}/index.html`, 'gone')
    await env.REPORTS.put(`runs/${keep}/index.html`, 'kept')

    await as('admin', `/runs/${doomed}`, { method: 'DELETE' })

    expect(await env.REPORTS.get(`runs/${keep}/index.html`)).not.toBeNull()
  })

  it('404s a run that does not exist', async () => {
    expect((await as('admin', '/runs/no-such-run', { method: 'DELETE' })).status).toBe(404)
  })
})
