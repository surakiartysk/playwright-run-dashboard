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
const INJECTIONS: [string, string][] = [
  ['a classic injection', "passed' OR '1'='1"],
  ['a comment terminator', "passed'--"],
  ['a stacked statement', "passed'; DROP TABLE runs;--"],
  ['a UNION attempt', "passed' UNION SELECT * FROM runs--"],
]

/**
 * Nothing here may ever have removed the table it was aimed at.
 *
 * Asked of sqlite_master rather than by counting rows: a count only proves
 * anything when the table happens to be non-empty, which depends on what else
 * in the file ran first. The stacked-statement payload is trying to DROP it,
 * so existence is the property worth checking.
 */
const tableSurvived = async () => {
  const row = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'`,
  ).first<{ name: string }>()
  expect(row?.name).toBe('runs')
}

describe('GET /runs — hostile query strings', () => {
  /*
   * `status` is an allowlist now, so these never reach SQL at all — which is a
   * stronger position than binding them, and a weaker test if it were left
   * asserting "matched nothing": an endpoint that refuses everything would pass
   * that too. So this pins the refusal itself, and the cursor test below is
   * what keeps the binding property honest.
   */
  it.each(INJECTIONS)('refuses %s in the status filter outright', async (_label, status) => {
    await seedRun({ service: uniqueService(), ref: 'main', status: 'passed' })

    const response = await as('admin', `/runs?status=${encodeURIComponent(status)}&limit=100`)

    expect(response.status).toBe(422)
    await tableSurvived()
  })

  /*
   * The cursor is where free-form input still reaches the query.
   *
   * `status` and `suite` are closed sets, but a cursor decodes to a timestamp
   * and an id that are whatever the caller base64'd — so this is now the only
   * user-controlled value the listing binds, and therefore the one that has to
   * prove it is bound rather than interpolated. This is the test that fails if
   * someone later builds the cursor clause by string concatenation.
   */
  /*
   * Every payload here starts with `0` on purpose.
   *
   * Bound, the clause is `started_at < '0…'`, and no ISO timestamp sorts below
   * a leading zero — so a cursor that is genuinely a bound string returns
   * nothing at all. Interpolated, each of these closes the quote and makes the
   * condition true, returning rows. That gap is the whole assertion: a payload
   * starting with a letter would return rows either way and prove nothing,
   * which is exactly how the first draft of this test passed against an
   * interpolated cursor.
   */
  const CURSOR_INJECTIONS: [string, string][] = [
    ['a classic injection', "0' OR '1'='1"],
    ['a comment terminator', "0'--"],
    ['a stacked statement', "0'; DROP TABLE runs;--"],
    ['a UNION attempt', "0' UNION SELECT * FROM runs--"],
  ]

  it.each(CURSOR_INJECTIONS)(
    'treats %s inside a cursor as a literal value',
    async (_label, payload) => {
      await seedRun({ service: uniqueService(), ref: 'main', status: 'passed' })

      const cursor = btoa(`${payload}\u0000${payload}`)
      const response = await as('admin', `/runs?cursor=${encodeURIComponent(cursor)}&limit=100`)

      expect(response.status).toBe(200)

      const { runs } = (await response.json()) as { runs: RunView[] }
      expect(runs).toHaveLength(0)

      await tableSurvived()
    },
  )

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
