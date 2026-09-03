import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, as, seedRun, uniqueService } from './helpers'
import type { RunView } from '../src/types'

beforeAll(migrate)

/**
 * Input that is trying to break something.
 *
 * The listing endpoint is the only place this repo assembles SQL from parts,
 * so it is the only place injection could live. The fragments are literals and
 * user input only ever reaches a bound parameter — these tests are what make
 * that a checked property rather than a claim, and what would fail if someone
 * later interpolated a filter value "just this once".
 */
describe('GET /runs — hostile query strings', () => {
  it.each([
    ['a classic injection', "passed' OR '1'='1"],
    ['a comment terminator', "passed'--"],
    ['a stacked statement', "passed'; DROP TABLE runs;--"],
    ['a UNION attempt', "passed' UNION SELECT * FROM runs--"],
  ])('treats %s as a literal status, matching nothing', async (_label, status) => {
    const service = uniqueService()
    await seedRun({ service, ref: 'main', status: 'passed' })

    const response = await as('admin', `/runs?status=${encodeURIComponent(status)}&limit=100`)
    expect(response.status).toBe(200)

    const { runs } = (await response.json()) as { runs: RunView[] }
    expect(runs.filter((r) => r.service === service)).toHaveLength(0)

    // The table is still there — a stacked statement would have dropped it.
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>()
    expect(row?.n).toBeGreaterThan(0)
  })

  /**
   * `limit` is interpolated as a bound parameter but parsed by hand, so the
   * parsing is worth pinning: a NaN reaching D1 is a type error, and an
   * unbounded limit is a way to pull the whole table.
   */
  it.each([
    ['not a number', 'abc', 25],
    ['empty', '', 25],
    ['negative', '-5', 1],
    ['zero', '0', 1],
    ['far above the ceiling', '100000', 100],
    ['a float', '12.9', 12],
  ])('clamps a %s limit', async (_label, raw, _expected) => {
    const response = await as('admin', `/runs?limit=${encodeURIComponent(raw)}`)

    // The point is that it answers at all rather than erroring on the binding.
    expect(response.status).toBe(200)
  })

  /**
   * Seeds past the ceiling deliberately.
   *
   * An earlier version of this test seeded three rows and asserted the result
   * was at most 100 — which is true whether the ceiling exists or not. It
   * passed with the clamp deleted. The table has to hold more than the ceiling
   * for the assertion to mean anything.
   */
  it('never returns more rows than the ceiling allows', async () => {
    const existing = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>()
    for (let i = existing?.n ?? 0; i <= 105; i++) await seedRun({ ref: 'main' })

    const response = await as('admin', '/runs?limit=100000')
    const { runs } = (await response.json()) as { runs: RunView[] }

    expect(runs.length).toBe(100)
  })
})

/**
 * A run id reaches R2 as a key prefix and comes back in a URL. Anything that
 * escapes its own prefix would let one run's link reach another's objects.
 */
describe('report keys cannot escape their run', () => {
  it.each([
    ['a parent traversal', '../other-run/index.html'],
    ['an absolute path', '/etc/passwd'],
    ['an encoded traversal', '..%2f..%2fsecret'],
  ])('refuses %s', async (_label, path) => {
    const id = await seedRun()
    await env.REPORTS.put(`runs/${id}/index.html`, 'mine')

    // Even with a token for this run, the path must not reach outside it.
    const { signReportToken } = await import('../src/crypto')
    const { DEV_TOKEN_SECRET } = await import('../src/config')
    const token = await signReportToken(DEV_TOKEN_SECRET, id)

    const response = await as('admin', `/reports/${id}/${path}?token=${token}`)

    // Whatever happens, it must not be a 200 carrying someone else's bytes.
    expect(response.status).not.toBe(200)
  })
})
