import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import {
  migrate,
  as,
  seedRun,
  uniqueService,
  createdRun,
  runCount,
  sharedSandbox,
  makeTestSandbox,
} from './helpers'
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
    const response = await create('dev', { service: 'items', tags: 'all', ref: 'main' })
    expect(response.status).toBe(201)
  })

  it('refuses dev a branch it may not use, with 403 rather than 422', async () => {
    const response = await create('dev', {
      service: 'items',
      tags: 'all',
      ref: 'develop',
    })

    // The request is well-formed; the caller simply may not make it.
    expect(response.status).toBe(403)
  })

  it('lets qa run a release branch, and not a lookalike', async () => {
    const before = await runCount()
    const ok = await create('qa', { service: 'items', tags: 'all', ref: 'release/1.0.0' })
    expect(ok.status).toBe(201)

    for (const ref of ['release', 'releasefoo', 'release/../main', 'release/1.0/x']) {
      const refused = await create('qa', { service: 'items', tags: 'all', ref })
      expect(refused.status, ref).toBe(403)
    }
    expect(await runCount()).toBe(before + 1)
  })

  /** `*` is not a character a git ref may carry here, so the pattern cannot be named as a ref. */
  it('refuses the pattern itself as a branch name', async () => {
    const response = await create('qa', { service: 'items', tags: 'all', ref: 'release/*' })
    expect(response.status).toBe(422)
  })

  it('does not let dev run a release branch', async () => {
    const response = await create('dev', {
      service: 'items',
      tags: 'all',
      ref: 'release/1.0.0',
    })
    expect(response.status).toBe(403)
  })

  it('records no run when the ref is refused', async () => {
    const before = await runCount()
    await create('dev', { service: 'items', tags: 'all', ref: 'develop' })

    expect(await runCount()).toBe(before)
  })

  it('refuses more workers than the role may use', async () => {
    const before = await runCount()
    const response = await create('dev', { service: 'items', tags: 'all', workers: 8 })

    expect(response.status).toBe(403)
    expect(await runCount()).toBe(before)
  })

  it('gives a run that names no workers the default, lowered to what the caller may use', async () => {
    // It used to dispatch 4 whatever the caller's limit.
    const workersOf = async (response: Response) => {
      const { runId } = (await response.json()) as { runId: string }
      return (
        await env.DB.prepare(`SELECT workers FROM runs WHERE id = ?1`)
          .bind(runId)
          .first<{ workers: number | null }>()
      )?.workers
    }

    expect(await workersOf(await create('qa', { service: 'items', tags: 'all' }))).toBe(4)
    // A key limited to two workers, which may not take the default of four.
    const issued = (await (
      await as('admin', '/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'two workers', role: 'qa', maxWorkers: 2 }),
      })
    ).json()) as { plaintext: string }
    const viaKey = await as('admin', '/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issued.plaintext}` },
      body: JSON.stringify({ service: 'items', tags: 'all' }),
    })
    expect(await workersOf(viaKey)).toBe(2)
  })

  it('allows qa the worker count it refuses dev', async () => {
    expect((await create('dev', { service: 'items', tags: 'all', workers: 8 })).status).toBe(403)
    expect((await create('qa', { service: 'items', tags: 'all', workers: 8 })).status).toBe(201)
  })

  it('lets admin use a branch no other role may', async () => {
    const response = await create('admin', {
      service: 'items',
      tags: 'all',
      ref: 'feature/whatever',
    })
    expect(response.status).toBe(201)
  })

  it.each([
    ['a service with a slash', { service: 'items/x', tags: 'smoke' }],
    ['a service starting with a digit', { service: '1items', tags: 'all' }],
    ['an empty service', { service: '', tags: 'smoke' }],
    ['an uppercase tag', { service: 'items', tags: 'Smoke' }],
    ['a ref with a space', { service: 'items', tags: 'all', ref: 'ma in' }],
    ['zero workers', { service: 'items', tags: 'all', workers: 0 }],
    ['fractional workers', { service: 'items', tags: 'all', workers: 1.5 }],
    ['a service the suite does not have', { service: 'payments', tags: 'all' }],
    ["the other suite's service", { suite: 'api', service: 'cart', tags: 'all' }],
    ['a tag the suite does not have', { service: 'items', tags: 'nightly' }],
    ["the other suite's tag", { suite: 'ui', service: 'cart', tags: 'flow' }],
  ])('rejects %s with 422', async (_label, body) => {
    expect((await create('admin', body)).status).toBe(422)
  })

  /*
   * A slice is checked against what the suite takes, not against the shape of
   * a name. `cart` on the API suite and a tag nobody defined were both accepted
   * once, and simulation reported each one green in everyone's history.
   */
  it('names what the suite takes when a slice is not one of them', async () => {
    const response = await create('admin', { suite: 'api', service: 'cart', tags: 'all' })
    const body = (await response.json()) as { error: string }

    expect(body.error).toContain('items')
    expect(body.error).not.toContain('cart')
  })

  it('records nothing for a slice the suite does not take', async () => {
    const before = await runCount()
    await create('admin', { service: 'items', tags: 'nightly' })

    expect(await runCount()).toBe(before)
  })

  it("takes each suite's own names", async () => {
    expect((await create('admin', { suite: 'ui', service: 'cart', tags: 'smoke' })).status).toBe(
      201,
    )
    expect((await create('admin', { suite: 'api', service: 'items', tags: 'flow' })).status).toBe(
      201,
    )
  })

  /*
   * The combination the dashboard used to offer and the suite could not run.
   *
   * It was refused with a 422 for as long as the workflows took one `scope`
   * input, because honouring both was impossible and silently dropping one
   * left the history describing a run that never happened (decision 26). Both
   * suites now take a second input, so the request is accepted and recorded
   * as made — and `integration-contract.test.ts` holds what is sent for it.
   */
  it('accepts a service and a tag together, and records both as asked', async () => {
    const response = await create('admin', { service: 'items', tags: 'smoke' })

    expect(response.status).toBe(201)
    expect(await createdRun(response)).toEqual(expect.objectContaining({ tags: 'smoke' }))
  })

  it.each([
    ['a tag across every service', { service: 'all', tags: 'smoke' }],
    ['a whole service', { service: 'items', tags: 'all' }],
    ['everything', { service: 'all', tags: 'all' }],
  ])('still accepts %s', async (_label, body) => {
    expect((await create('admin', body)).status).toBe(201)
  })

  /*
   * Accepting the combination is not a privilege of one role: it is the shape of
   * the request, not what the request is allowed to touch.
   */
  it('accepts the combination for any role that may run at all', async () => {
    for (const role of ['dev', 'qa', 'admin'] as const) {
      const response = await create(role, { service: 'items', tags: 'flow' })
      expect(response.status, role).toBe(201)
    }
  })

  it('records the requesting role as who triggered it, and defaults to main', async () => {
    const response = await create('qa', { service: 'items', tags: 'all' })

    expect(await createdRun(response)).toEqual(
      expect.objectContaining({ triggered_by: 'qa', ref: 'main' }),
    )
  })

  /**
   * Minute-precision ids collided on the PRIMARY KEY, so the second run of a
   * service within the same minute got a 500 for doing nothing wrong. Two
   * people pressing Run on the same service is ordinary, not an edge case.
   */
  it('accepts two runs of the same service in the same minute', async () => {
    const first = await create('admin', { service: 'items', tags: 'all' })
    const second = await create('admin', { service: 'items', tags: 'all' })

    expect([first.status, second.status]).toEqual([201, 201])

    const runs = [await createdRun(first), await createdRun(second)]
    expect(runs.every(Boolean)).toBe(true)
    expect(new Set(runs.map((run) => run!.id)).size).toBe(2)
  })
})

describe('DELETE /runs/:id', () => {
  const exists = async (id: string) =>
    (await env.DB.prepare('SELECT id FROM runs WHERE id = ?1').bind(id).first()) !== null

  it('removes a run of the admin’s own sandbox', async () => {
    const id = await seedRun({ sandboxId: (await sharedSandbox()).id })
    const response = await as('admin', `/runs/${id}`, { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(await exists(id)).toBe(false)
  })

  /*
   * A real run has no sandbox, so no visitor — admin included — may delete it.
   * It is the same "no such run" as a missing one: there is nothing about a
   * real run that a visitor's admin is responsible for.
   */
  it('does not delete a real run from a suite’s CI', async () => {
    const id = await seedRun()
    expect((await as('admin', `/runs/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect(await exists(id)).toBe(true)
  })

  it('does not delete another sandbox’s run', async () => {
    const other = await makeTestSandbox()
    const id = await seedRun({ sandboxId: other.id })
    expect((await as('admin', `/runs/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect(await exists(id)).toBe(true)
  })

  /*
   * Every sandbox run points `report_path` at the one shared demo report.
   * Deleting a run must not take the report every other run shows.
   */
  it('leaves the shared demo report alone', async () => {
    const shared = 'demo-report/index.html'
    await env.REPORTS.put(shared, '<html>sample</html>')
    const id = await seedRun({ sandboxId: (await sharedSandbox()).id, reportPath: shared })

    expect((await as('admin', `/runs/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await env.REPORTS.get(shared)).not.toBeNull()
  })

  it('records the deletion in the sandbox’s activity', async () => {
    const sandbox = await sharedSandbox()
    const id = await seedRun({ sandboxId: sandbox.id })
    await as('admin', `/runs/${id}`, { method: 'DELETE' })
    const row = await env.DB.prepare(
      `SELECT detail FROM audit_log WHERE sandbox_id = ?1 AND action = 'run-deleted' AND detail = ?2`,
    )
      .bind(sandbox.id, id)
      .first()
    expect(row).not.toBeNull()
  })

  it('404s a run that does not exist', async () => {
    expect((await as('admin', '/runs/no-such-run', { method: 'DELETE' })).status).toBe(404)
  })
})
