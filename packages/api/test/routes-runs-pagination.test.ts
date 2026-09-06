import { describe, expect, it, beforeAll } from 'vitest'
import { migrate, as, seedRun, uniqueService } from './helpers'
import type { RunView } from '../src/types'

beforeAll(migrate)

/**
 * Pagination over the run list.
 *
 * The list was capped at 25 with no way past it: run 26 was not merely below
 * the fold, it was unreachable, and nothing in the response said so. These
 * tests pin the cursor's two properties that matter — every row appears on
 * exactly one page, and the page boundary survives rows that share a
 * timestamp.
 *
 * The database is shared across the suite, so each test seeds its own service
 * and asserts only on rows it created.
 */

type Page = {
  runs: RunView[]
  total: number
  nextCursor: string | null
}

const pageOf = async (path: string): Promise<Page> => {
  const response = await as('admin', path)
  expect(response.status).toBe(200)
  return (await response.json()) as Page
}

/** Walks every page, returning the ids in the order they were served. */
async function walk(service: string, limit: number): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null

  for (let guard = 0; guard < 50; guard++) {
    const query: string = cursor
      ? `/runs?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `/runs?limit=${limit}`
    const page: Page = await pageOf(query)

    ids.push(...page.runs.filter((run) => run.service === service).map((run) => run.id))
    if (!page.nextCursor) return ids
    cursor = page.nextCursor
  }

  throw new Error('pagination did not terminate')
}

describe('GET /runs pagination', () => {
  it('reaches every run through the cursor, each exactly once', async () => {
    const service = uniqueService()
    const seeded: string[] = []

    // Descending timestamps, so the seeded order is the served order.
    for (let i = 0; i < 12; i++) {
      seeded.push(
        await seedRun({
          service,
          startedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, i)).toISOString(),
        }),
      )
    }

    const walked = await walk(service, 5)

    expect(walked).toHaveLength(seeded.length)
    expect(new Set(walked).size).toBe(seeded.length)
    expect(walked).toEqual([...seeded].reverse())
  })

  it('does not drop or repeat runs that share a timestamp across a page boundary', async () => {
    const service = uniqueService()
    // `started_at` is not unique, so a cursor on it alone would either skip
    // these or serve one twice. All four sit on one instant, and the page
    // boundary is placed in the middle of them.
    const sameInstant = new Date(Date.UTC(2026, 0, 2, 9, 30, 0)).toISOString()
    const ids = [
      await seedRun({ service, startedAt: sameInstant, id: '20260102-0930-aaaa1111' }),
      await seedRun({ service, startedAt: sameInstant, id: '20260102-0930-bbbb2222' }),
      await seedRun({ service, startedAt: sameInstant, id: '20260102-0930-cccc3333' }),
      await seedRun({ service, startedAt: sameInstant, id: '20260102-0930-dddd4444' }),
    ]

    const walked = await walk(service, 2)

    expect(new Set(walked).size).toBe(ids.length)
    expect([...walked].sort()).toEqual([...ids].sort())
  })

  it('reports a total that counts past the page and does not shrink while paging', async () => {
    const service = uniqueService()
    for (let i = 0; i < 7; i++) {
      await seedRun({
        service,
        startedAt: new Date(Date.UTC(2026, 0, 3, 8, 0, i)).toISOString(),
      })
    }

    const first = await pageOf('/runs?limit=3')
    expect(first.runs.length).toBe(3)
    // The total counts every visible run, not the page — that is what lets the
    // UI say "showing 3 of N" rather than silently truncating.
    expect(first.total).toBeGreaterThanOrEqual(7)
    expect(first.nextCursor).not.toBeNull()

    const second = await pageOf(`/runs?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`)
    expect(second.total).toBe(first.total)
  })

  it('ends with a null cursor rather than a cursor onto an empty page', async () => {
    /*
     * The boundary case: a result set that is an exact multiple of the page
     * size. Asking for N rows and receiving N is ambiguous — it can mean "there
     * are exactly N" or "there are more". Guessing "more" hands back a cursor
     * that leads to an empty page and shows the reader a Next button that does
     * nothing; guessing "no more" silently truncates.
     *
     * Reading limit + 1 rows resolves it, and only a test that lands exactly on
     * the boundary can tell the two apart — which is why this seeds a filtered
     * page size rather than asking for far more rows than exist.
     */
    const service = uniqueService()
    for (let i = 0; i < 4; i++) {
      await seedRun({
        service,
        status: 'timeout',
        startedAt: new Date(Date.UTC(2026, 0, 4, 7, 0, i)).toISOString(),
      })
    }

    // `status=timeout` narrows the shared table to these four rows, so limit=2
    // lands the second page exactly on the end of the list.
    const first = await pageOf('/runs?limit=2&status=timeout')
    expect(first.nextCursor).not.toBeNull()

    const second = await pageOf(
      `/runs?limit=2&status=timeout&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
    expect(second.runs).toHaveLength(2)

    // Four rows read two at a time: the second page is the last one, and must
    // say so rather than offering a third that would come back empty.
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a malformed cursor instead of silently serving page one', async () => {
    const response = await as('admin', '/runs?cursor=not-a-real-cursor')
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/cursor/i)
  })

  it('keeps every cursor page inside the caller’s visibility scope', async () => {
    /*
     * The one that matters. A dev is scoped to `main`, and the cursor clause is
     * ANDed onto the visibility clause — if it ever replaced it, page two would
     * be a way around the scoping that page one enforces.
     *
     * Deliberately NOT scoped to a single service: filtering the response by a
     * service this test owns would hide exactly the rows a leak would produce.
     * Every row of every page has to be checked, whoever created it.
     */
    const service = uniqueService()
    await seedRun({ service, ref: 'feature/secret', status: 'passed' })
    await seedRun({ service, ref: 'feature/other', status: 'passed' })
    await seedRun({ service, ref: 'main', status: 'passed' })

    let cursor: string | null = null
    const refs: string[] = []
    let pages = 0

    for (let guard = 0; guard < 200; guard++) {
      const path: string = cursor
        ? `/runs?limit=1&cursor=${encodeURIComponent(cursor)}`
        : '/runs?limit=1'
      const response = await as('dev', path)
      expect(response.status).toBe(200)
      const page = (await response.json()) as Page

      // Asserted on the raw page, not on rows this test happens to own.
      refs.push(...page.runs.map((run) => run.ref))
      pages++
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }

    expect(pages).toBeGreaterThan(1)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((ref) => ref === 'main')).toBe(true)
  })
})
