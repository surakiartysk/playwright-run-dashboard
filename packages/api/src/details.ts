/**
 * The failures a result callback carries, and what is allowed to reach a page.
 *
 * The callback is signed, so it is not hostile — but the text in it is whatever
 * a test's assertion happened to say, and it ends up rendered in front of
 * whoever may read the run. So it is taken as untrusted in the one way that
 * matters: bounded, typed, and cut, never rejected. A callback whose detail is
 * malformed still has to deliver its totals; the detail is a convenience, and
 * losing it must cost a list, not a result.
 */

export interface RunFailure {
  title: string
  file: string
  line?: number
  /** Which package ran it: the suites run each journey twice, once per style. */
  style: string
  tags: string[]
  message: string
}

export interface RunDetails {
  failures: RunFailure[]
  /** Failures the workflow left out because there were more than it sends. */
  omitted: number
}

export const MAX_FAILURES = 20
const MAX_TITLE = 300
const MAX_FILE = 200
const MAX_STYLE = 40
const MAX_MESSAGE = 240
const MAX_TAGS = 10
const MAX_OMITTED = 1_000_000
const TAG = /^[a-z][a-z0-9-]{0,39}$/

const cut = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : ''

/**
 * What to store for a callback's `failures`, or null when there is nothing.
 *
 * An entry with no title is dropped (it says nothing), the rest are cut to
 * size, and anything beyond twenty is counted into `omitted` rather than kept —
 * a workflow that sends a hundred must not be able to store a hundred.
 * `omitted` is the workflow's own count plus whatever this dropped.
 */
export function sanitizeFailures(failures: unknown, omitted: unknown): RunDetails | null {
  if (!Array.isArray(failures)) return null

  const kept: RunFailure[] = []
  let dropped = 0
  for (const entry of failures) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const title = cut(e.title, MAX_TITLE)
    if (!title || kept.length >= MAX_FAILURES) {
      if (title) dropped++
      continue
    }
    const line =
      typeof e.line === 'number' && Number.isInteger(e.line) && e.line > 0 ? e.line : null
    kept.push({
      title,
      file: cut(e.file, MAX_FILE),
      ...(line ? { line } : {}),
      style: cut(e.style, MAX_STYLE),
      tags: (Array.isArray(e.tags) ? e.tags : [])
        .filter((t): t is string => typeof t === 'string' && TAG.test(t))
        .slice(0, MAX_TAGS),
      message: cut(e.message, MAX_MESSAGE),
    })
  }

  if (kept.length === 0) return null

  const said = typeof omitted === 'number' && Number.isInteger(omitted) && omitted > 0 ? omitted : 0
  return { failures: kept, omitted: Math.min(MAX_OMITTED, said + dropped) }
}

/** The stored column back into the shape the API returns. Never throws. */
export function parseDetails(stored: string | null): RunDetails | null {
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const { failures, omitted } = parsed as { failures?: unknown; omitted?: unknown }
    return sanitizeFailures(failures, omitted)
  } catch {
    return null
  }
}

/**
 * Failures a simulated run can show.
 *
 * A simulated run that fails had a "details" panel with nothing in it, which is
 * a different demo from the real one. These are plainly invented — the run
 * carries the `simulated` flag and the panel says so — and drawn from a short
 * list per suite so they read like the real thing without claiming to be.
 */
const SAMPLE: Record<'api' | 'ui', Omit<RunFailure, 'style'>[]> = {
  api: [
    {
      title: 'should refuse a reservation that overlaps an existing one',
      file: 'reservations/create.spec.ts',
      line: 41,
      tags: ['reservations', 'flow'],
      message: 'expected business code RESERVATION_CONFLICT, got CREATED',
    },
    {
      title: 'should return the item with its status and price',
      file: 'items/get.spec.ts',
      line: 18,
      tags: ['items', 'smoke'],
      message: 'response did not match schema: price must be a number, received "12.50"',
    },
    {
      title: 'should list maintenance logs newest first',
      file: 'maintenance-logs/list.spec.ts',
      line: 27,
      tags: ['maintenance-logs', 'isolated'],
      message: 'expected 200, got 500 — body: {"error":"internal"}',
    },
  ],
  ui: [
    {
      title: 'a filled checkout reaches the confirmation',
      file: 'checkout.spec.ts',
      line: 23,
      tags: ['smoke'],
      message:
        'expect(locator).toBeVisible() — element(s) not found: [data-test="complete-header"]',
    },
    {
      title: 'the badge matches what the cart holds',
      file: 'cart.spec.ts',
      line: 15,
      tags: ['smoke'],
      message: 'expect(locator).toHaveText(expected) — Expected: "2", Received: "1"',
    },
    {
      title: 'a locked-out user is refused, and told why',
      file: 'auth.spec.ts',
      line: 17,
      tags: ['smoke'],
      message: 'expect(locator).toContainText(expected) — Expected substring: "locked out"',
    },
  ],
}

export function sampleFailures(suite: 'api' | 'ui', count: number): RunDetails | null {
  const pool = SAMPLE[suite]
  const failures = pool.slice(0, Math.max(0, Math.min(count, pool.length))).map((f) => ({
    ...f,
    style: suite === 'api' ? 'functional-style' : 'locator-first',
  }))
  return failures.length === 0 ? null : { failures, omitted: Math.max(0, count - failures.length) }
}
