import { beforeAll, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { as, migrate, seedRun, uniqueService } from './helpers'
import { readListFilters } from '../src/routes/runs'
import type { Role } from '../src/types'

beforeAll(migrate)

/**
 * Narrowing the run list by what a run was.
 *
 * Every test isolates itself behind a service name of its own, because storage
 * is shared across the file and an assertion on "all the runs with tag flow"
 * would be one about other tests' rows.
 */

interface Page {
  runs: { id: string; service: string; tags: string; ref: string; triggeredBy: string }[]
  total: number
  nextCursor: string | null
}

const list = async (role: Role, query: string): Promise<Page> =>
  (await (await as(role, `/runs?limit=100&${query}`)).json()) as Page

/** A run with the fields a filter looks at, seeded straight into the table. */
async function seed(
  service: string,
  over: Partial<{
    tags: string
    ref: string
    triggeredBy: Role
    startedAt: string
    suite: 'api' | 'ui'
    simulated: 0 | 1
  }> = {},
) {
  const id = await seedRun({
    service,
    tags: over.tags ?? 'all',
    ref: over.ref ?? 'main',
    triggeredBy: over.triggeredBy ?? 'qa',
    ...(over.startedAt ? { startedAt: over.startedAt } : {}),
  })
  await env.DB.prepare(`UPDATE runs SET suite = ?2, simulated = ?3 WHERE id = ?1`)
    .bind(id, over.suite ?? 'api', over.simulated ?? 0)
    .run()
  return id
}

const ids = (page: Page) => page.runs.map((r) => r.id).sort()

describe('GET /runs — narrowing', () => {
  it('by service', async () => {
    const service = uniqueService()
    const mine = await seed(service)
    await seed(uniqueService())
    expect(ids(await list('admin', `service=${service}`))).toEqual([mine])
  })

  it('by tag', async () => {
    const service = uniqueService()
    const flow = await seed(service, { tags: 'flow' })
    await seed(service, { tags: 'smoke' })
    expect(ids(await list('admin', `service=${service}&tag=flow`))).toEqual([flow])
  })

  it('by branch', async () => {
    const service = uniqueService()
    const develop = await seed(service, { ref: 'develop' })
    await seed(service, { ref: 'main' })
    expect(ids(await list('admin', `service=${service}&ref=develop`))).toEqual([develop])
  })

  it('by who started it, as a role', async () => {
    const service = uniqueService()
    const dev = await seed(service, { triggeredBy: 'dev' })
    await seed(service, { triggeredBy: 'qa' })
    expect(ids(await list('admin', `service=${service}&triggeredBy=dev`))).toEqual([dev])
  })

  it('by suite', async () => {
    const service = uniqueService()
    const ui = await seed(service, { suite: 'ui' })
    await seed(service, { suite: 'api' })
    expect(ids(await list('admin', `service=${service}&suite=ui`))).toEqual([ui])
  })

  it('by whether it was simulated', async () => {
    const service = uniqueService()
    const real = await seed(service, { simulated: 0 })
    const fake = await seed(service, { simulated: 1 })
    expect(ids(await list('admin', `service=${service}&simulated=real`))).toEqual([real])
    expect(ids(await list('admin', `service=${service}&simulated=simulated`))).toEqual([fake])
  })

  it('by how long ago', async () => {
    const service = uniqueService()
    const hour = await seed(service, { startedAt: new Date(Date.now() - 3600_000).toISOString() })
    // Just past a day, so a window of two days would let it in.
    const day = await seed(service, {
      startedAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
    })
    const week = await seed(service, {
      startedAt: new Date(Date.now() - 6 * 86400_000).toISOString(),
    })
    const old = await seed(service, {
      startedAt: new Date(Date.now() - 20 * 86400_000).toISOString(),
    })

    expect(ids(await list('admin', `service=${service}&since=24h`))).toEqual([hour])
    expect(ids(await list('admin', `service=${service}&since=7d`))).toEqual(
      [hour, day, week].sort(),
    )
    expect(ids(await list('admin', `service=${service}&since=30d`))).toEqual(
      [hour, day, week, old].sort(),
    )
  })

  it('by several at once, which narrow one another', async () => {
    const service = uniqueService()
    const target = await seed(service, { tags: 'flow', ref: 'develop', triggeredBy: 'qa' })
    await seed(service, { tags: 'flow', ref: 'main', triggeredBy: 'qa' })
    await seed(service, { tags: 'smoke', ref: 'develop', triggeredBy: 'qa' })
    await seed(service, { tags: 'flow', ref: 'develop', triggeredBy: 'dev' })
    const page = await list('admin', `service=${service}&tag=flow&ref=develop&triggeredBy=qa`)
    expect(ids(page)).toEqual([target])
  })

  it('counts the narrowed set, not the whole table', async () => {
    const service = uniqueService()
    await seed(service, { tags: 'flow' })
    await seed(service, { tags: 'flow' })
    await seed(service, { tags: 'smoke' })
    expect((await list('admin', `service=${service}&tag=flow`)).total).toBe(2)
  })

  it('pages through a narrowed set without losing or repeating a run', async () => {
    const service = uniqueService()
    const all = [await seed(service), await seed(service), await seed(service)]
    const first = (await (await as('admin', `/runs?limit=2&service=${service}`)).json()) as Page
    expect(first.runs).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = (await (
      await as('admin', `/runs?limit=2&service=${service}&cursor=${first.nextCursor}`)
    ).json()) as Page
    expect([...first.runs, ...second.runs].map((r) => r.id).sort()).toEqual(all.sort())
  })
})

describe('GET /runs — a filter never widens what a role may see', () => {
  it('leaves a developer on main, whatever branch they ask for', async () => {
    const service = uniqueService()
    const main = await seed(service, { ref: 'main', triggeredBy: 'qa' })
    await seed(service, { ref: 'develop', triggeredBy: 'qa' })

    expect(ids(await list('dev', `service=${service}`))).toEqual([main])
    expect(ids(await list('dev', `service=${service}&ref=develop`))).toEqual([])
  })

  it('leaves demo on its own runs, whoever it asks about', async () => {
    const service = uniqueService()
    const mine = await seed(service, { triggeredBy: 'demo' })
    await seed(service, { triggeredBy: 'admin' })
    expect(ids(await list('demo', `service=${service}`))).toEqual([mine])
    expect(ids(await list('demo', `service=${service}&triggeredBy=admin`))).toEqual([])
  })
})

describe('GET /runs — a bad filter is refused, not ignored', () => {
  it.each([
    ['service', "x'; DROP TABLE runs;--"],
    ['service', 'Upper'],
    ['tag', 'has space'],
    ['ref', 'has space'],
    ['since', '7days'],
    ['since', ''],
    ['triggeredBy', 'root'],
    ['simulated', 'maybe'],
  ])('%s=%j is a 422', async (name, value) => {
    const response = await as('admin', `/runs?${name}=${encodeURIComponent(value)}`)
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: string }).error).toContain(name)
  })
})

describe('readListFilters', () => {
  const read = (params: Record<string, string>, now = Date.parse('2026-10-04T12:00:00Z')) =>
    readListFilters((n) => params[n], now)

  it('has no clause when nothing is asked', () => {
    expect(read({})).toEqual({ clauses: [] })
  })

  it('binds every value as a parameter, never into the SQL', () => {
    const r = read({ service: 'items', tag: 'smoke', ref: 'main', triggeredBy: 'qa' })
    if ('error' in r) throw new Error(r.error)
    for (const clause of r.clauses) {
      expect(clause.sql).toMatch(/^[a-z_]+ (=|>=) \?$/)
      expect(clause.params).toHaveLength(1)
    }
    expect(r.clauses.flatMap((c) => c.params)).toEqual(['items', 'smoke', 'main', 'qa'])
  })

  it('turns "7d" into the instant a week before now', () => {
    const r = read({ since: '7d' })
    if ('error' in r) throw new Error(r.error)
    expect(r.clauses[0]!.params).toEqual(['2026-09-27T12:00:00.000Z'])
  })

  it('maps real and simulated to the column it is stored in', () => {
    const real = read({ simulated: 'real' })
    const fake = read({ simulated: 'simulated' })
    if ('error' in real || 'error' in fake) throw new Error('unexpected')
    expect(real.clauses[0]!.params).toEqual([0])
    expect(fake.clauses[0]!.params).toEqual([1])
  })

  it('names the filter that was wrong', () => {
    expect(read({ since: 'x' })).toMatchObject({ error: expect.stringContaining('since') })
    expect(read({ triggeredBy: 'x' })).toMatchObject({
      error: expect.stringContaining('triggeredBy'),
    })
  })
})
