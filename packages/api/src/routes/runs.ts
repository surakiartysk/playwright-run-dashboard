import { Hono } from 'hono'
import type { CreateRunRequest, HonoEnv, RunRow } from '../types'
import {
  toView,
  isSuite,
  SUITES,
  isRunStatus,
  RUN_STATUSES,
  isOutcomeMode,
  OUTCOME_MODES,
} from '../types'
import { simulateRun } from '../simulate'
import { parseDetails } from '../details'
import { VISITOR_KEY_RUNS_PER_HOUR, visitorKeyWait } from '../visitorKeys'
import { secondsUntilRoom } from '../retry'
import { signReportToken } from '../crypto'
import { DEV_TOKEN_SECRET } from '../config'
import { ROLES, actorFor, refuseKeys, requireSession, requireRole } from '../auth'
import { matchesRef, policyFor, visibilityClause } from '../policy'
import { record } from '../audit'
import { gateApplies, loadGate, resolveGate } from '../gate'
import { DEFAULT_WORKERS, SUITE_OPTIONS } from '../options'

export const runRoutes = new Hono<HonoEnv>()

// Every route here needs a session; none of them are public.
runRoutes.use('*', requireSession)

/**
 * `20260826-1430-items-k3f9qw` — sortable, readable, usable as an R2 prefix.
 *
 * The suffix is not decoration. Minute precision alone collides the moment two
 * people run the same service in the same minute, which is ordinary
 * rather than an edge case; the id is the PRIMARY KEY, so the second insert
 * fails and the caller gets a 500 for doing nothing wrong. The random tail
 * makes that vanishingly unlikely while keeping the id readable — a UUID would
 * need a second column to answer "when, and what did it cover?".
 */
export function makeRunId(service: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-${service}-${randomSuffix()}`
}

/**
 * Six characters from a 32-symbol alphabet — about a billion possibilities.
 *
 * `crypto.getRandomValues` rather than `Math.random`: the id is not a secret,
 * so this is not about guessability, but `Math.random` carries no uniformity
 * guarantee at all and the cost of the real thing here is nothing. It is also
 * the only one that stays sound if this id ever ends up somewhere that does
 * care — which is exactly the kind of assumption that changes quietly.
 *
 * Crockford's alphabet: no `I`, `L`, `O` or `U`, so an id read off a screen and
 * typed into a search box cannot become a different one. Lowercased to match
 * the rest of the id.
 *
 * The suffix only has to be unique within one minute for one service, which the
 * rest of the id already pins down. Across 32^6 ≈ 1.07 billion values that is
 * about one in 24 million for ten runs in the same minute, and still one in
 * 200,000 for a hundred — an unreachable rate for a dashboard someone presses
 * by hand, and far past the point where the id is what fails first.
 */
export function randomSuffix(length = 6): string {
  const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
  const bytes = crypto.getRandomValues(new Uint8Array(length))

  // The alphabet is 32 symbols, so five bits map onto it exactly and a
  // modulo introduces no bias — every symbol is equally likely.
  return Array.from(bytes, (byte) => ALPHABET[byte % 32]).join('')
}

/**
 * Runs one sandbox may start in an hour.
 *
 * A housekeeping limit, not a security control: every run is simulated, so the
 * only thing a script starting runs in a loop can cost is rows in D1. Generous
 * on purpose — the number exists to stop a script, not to interrupt a visitor
 * pressing Run a few times to see what happens. Per sandbox, because a sandbox
 * is the one identity a visitor has; the number of sandboxes is itself capped
 * (sandboxes.ts), which is what bounds the total.
 */
export const SANDBOX_RUNS_PER_HOUR = 30

// The history's filters: a name a past run carried need not be offered today.
const SERVICE_RE = /^[a-z][a-z0-9-]*$/
const TAG_RE = /^[a-z][a-z0-9-]*$/
const REF_RE = /^[a-zA-Z0-9._\-/]+$/

// ── POST /runs ──────────────────────────────────────────────────────────────
runRoutes.post('/', async (c) => {
  const role = c.get('role')
  const sandboxId = c.get('sandboxId')
  const apiKey = c.get('apiKey')

  // A key's policy is its role's, already narrowed by its own limits — see
  // effectivePolicy in apiKeys.ts. Reading it here rather than re-deriving the
  // narrowing means the rule lives in one place, and a handler that forgets to
  // ask gets the role's limits rather than something wrong.
  const policy = apiKey?.policy ?? policyFor(role)

  const body = (await c.req.json().catch(() => null)) as CreateRunRequest | null
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)

  const { service, tags } = body
  /*
   * Omitted means the suites' default, lowered to what this caller may use.
   * It used to be checked only when it was sent: leave it out and the
   * dispatch filled in 4 — past any key limited below 4.
   */
  const workers = body.workers ?? Math.min(DEFAULT_WORKERS, policy.maxWorkers)
  const ref = body.ref ?? 'main'

  // Defaulted rather than required: a client written before the second suite
  // existed sends no `suite`, and it meant the only one there was.
  const suite = body.suite ?? 'api'
  if (!isSuite(suite)) {
    return c.json({ error: `suite must be one of: ${SUITES.join(', ')}` }, 422)
  }

  /*
   * Checked against what the suite takes, not against a shape.
   *
   * A pattern let through anything shaped like a name: the API suite's run of
   * `cart` (a UI-suite group) and a tag nobody defined were both accepted, and
   * simulation reported each one green in everyone's history. A real
   * workflow would refuse an input it does not accept, and the simulator
   * should not report green for one either. The names are in `SUITE_OPTIONS`,
   * which is also what the form offers.
   */
  const offered = SUITE_OPTIONS[suite]
  if (!service || !offered.services.includes(service)) {
    return c.json(
      { error: `service must be one of the ${suite} suite's: ${offered.services.join(', ')}` },
      422,
    )
  }
  if (!tags || !offered.tags.includes(tags)) {
    return c.json(
      { error: `tags must be one of the ${suite} suite's: ${offered.tags.join(', ')}` },
      422,
    )
  }

  /*
   * A service and a tag together are a real request: the tests of that service
   * that carry that tag.
   *
   * This used to be refused. The suites' workflows took a single `scope` input
   * whose values were a union of tag names and service names, so a request
   * naming both could only be honoured by dropping one — and the run row went
   * on recording the one that was dropped (decision 26). Both suites came to
   * take an optional second input, `tag`, so the pair is a request a suite can
   * honour, and it is recorded whole.
   *
   * What is still not checked here is whether any test carries the pair. A
   * combination nothing matches (`items` with `flow`) is a run the suite fails
   * with "No tests found"; the API cannot know, because the tags live in the
   * suites' specs and this repository cannot see them.
   */
  if (!REF_RE.test(ref)) {
    return c.json({ error: 'ref contains characters that are not valid in a git ref' }, 422)
  }

  /*
   * What the simulated run should come back as. Every run started here is
   * simulated (decision 52), so the field always means something.
   */
  const outcome = body.outcome ?? 'random'
  if (!isOutcomeMode(outcome)) {
    return c.json({ error: `outcome must be one of: ${OUTCOME_MODES.join(', ')}` }, 422)
  }

  // 403, not 422: the request is well-formed, the caller simply may not make
  // it. A client can tell "fix your input" from "ask for access" by the status.
  const refAllowed = matchesRef(policy.allowedRefs, ref)

  if (!refAllowed) {
    return c.json(
      {
        error: apiKey
          ? `This key may only run against: ${policy.allowedRefs.join(', ') || '(nothing)'}`
          : `Role '${role}' may only run against: ${policy.allowedRefs.join(', ')}`,
      },
      403,
    )
  }

  // The gate is checked after the policy, not before: "you may never run
  // against develop" is a different answer from "not right now", and a caller
  // told the second when the first is also true would fix the timing and hit
  // the wall again.
  if (gateApplies(role)) {
    const gate = resolveGate(await loadGate(c.env.DB, sandboxId), new Date())
    if (gate.state === 'closed') {
      return c.json(
        {
          error:
            gate.opensAt === null
              ? 'Runs are paused for your role. Ask an admin to reopen the gate.'
              : `Runs are paused for your role until ${gate.opensAt}.`,
          gate,
        },
        // 503, not 403: the request is allowed and the caller should retry
        // later, which is exactly what this status means.
        503,
      )
    }
  }

  /*
   * Checked last of the refusals. A caller who is over the limit but also
   * asked for a branch they may never use should hear about the branch: that
   * answer does not change in an hour, and telling them to come back later
   * would send them round the same wall.
   *
   * Counted per sandbox: one visitor's runs do not use up another's.
   */
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM runs WHERE sandbox_id = ?1 AND started_at > ?2`,
  )
    .bind(sandboxId, since)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= SANDBOX_RUNS_PER_HOUR) {
    const retryAfter = await secondsUntilRoom(c.env.DB, {
      from: 'runs',
      where: 'sandbox_id = ?1 AND started_at > ?2',
      column: 'started_at',
      params: [sandboxId, since],
      count: recent?.n ?? 0,
      limit: SANDBOX_RUNS_PER_HOUR,
      holdMs: 60 * 60 * 1000,
      atMostMs: 60 * 60 * 1000,
    })
    return c.json(
      {
        error:
          'This sandbox has run its hourly limit. It resets within the hour — ' +
          'or clone the repo and run it locally with no limit at all.',
      },
      429,
      { 'Retry-After': String(retryAfter) },
    )
  }

  // A key has its own hourly allowance on top of the sandbox's: the sandbox's
  // limit stops a script from filling the table, and this stops one key from
  // using all of it.
  const keyWait = apiKey ? await visitorKeyWait(c.env.DB, apiKey.id) : null
  if (keyWait !== null) {
    return c.json(
      {
        error: `This key has started its ${VISITOR_KEY_RUNS_PER_HOUR} runs for the hour. It resets within the hour.`,
      },
      429,
      { 'Retry-After': String(keyWait) },
    )
  }

  if (!Number.isInteger(workers) || workers < 1) {
    return c.json({ error: 'workers must be a positive integer' }, 422)
  }
  if (workers > policy.maxWorkers) {
    return c.json(
      {
        error: apiKey
          ? `This key may use at most ${policy.maxWorkers} workers`
          : `Role '${role}' may use at most ${policy.maxWorkers} workers`,
      },
      403,
    )
  }

  const id = makeRunId(service)

  await c.env.DB.prepare(
    `INSERT INTO runs (id, suite, service, tags, workers, triggered_by, status, ref, started_at,
                       api_key_id, started_by, simulated, sandbox_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, 1, ?11)`,
  )
    .bind(
      id,
      suite,
      service,
      tags,
      workers ?? null,
      role,
      ref,
      new Date().toISOString(),
      // Null for a person; the key's id for a key, so "which pipeline?" has an
      // answer the role alone cannot give.
      apiKey?.id ?? null,
      // The account that started it. Null for a key: a key has an id and a
      // label already, and inventing a person for it would be a worse answer.
      apiKey ? null : (c.get('email') ?? null),
      sandboxId,
    )
    .run()

  // Nothing is dispatched (decision 52). The simulator walks the run through
  // the states a real one passes through, after the response has gone.
  c.executionCtx.waitUntil(simulateRun(c.env, id, suite, service, outcome))

  return c.json({ runId: id, status: 'queued', simulated: true }, 201)
})

/**
 * A page cursor: the sort key of the last row already sent.
 *
 * `started_at` alone is not enough. It is a plain timestamp with no uniqueness
 * guarantee, and two runs started in the same second would sit either side of
 * a page boundary — a cursor on a non-unique key silently drops rows or repeats
 * them. `id` breaks the tie, so `(started_at, id)` is a total order and every
 * row appears on exactly one page.
 *
 * Opaque to the client on purpose: base64 of the pair, so nobody starts
 * hand-assembling one and depending on the shape.
 */
const encodeCursor = (row: RunRow) => btoa(`${row.started_at}\u0000${row.id}`)

const decodeCursor = (raw: string): { startedAt: string; id: string } | null => {
  try {
    const [startedAt, id] = atob(raw).split('\u0000')
    if (!startedAt || !id) return null
    return { startedAt, id }
  } catch {
    // A malformed cursor is a bad request, not a server error — the caller is
    // told, rather than being handed page one as though nothing happened.
    return null
  }
}

/**
 * The narrower filters on the run list, read and checked.
 *
 * Every value is validated and a bad one is a 422, for the reason `suite` and
 * `status` are: a filter that quietly does nothing cannot be told from one that
 * worked, and a typo'd `since=7days` returning every run reads as "this filter
 * does nothing". They are separate clauses rather than one string so each is
 * bound as a parameter — none of these values is ever written into the SQL.
 */
const SINCE_MS: Record<string, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
}

export function readListFilters(
  query: (name: string) => string | undefined,
  now: number = Date.now(),
): { clauses: { sql: string; params: unknown[] }[] } | { error: string } {
  const clauses: { sql: string; params: unknown[] }[] = []

  const service = query('service')
  if (service !== undefined) {
    if (!SERVICE_RE.test(service)) return { error: 'service must match /^[a-z][a-z0-9-]*$/' }
    clauses.push({ sql: 'service = ?', params: [service] })
  }

  const tag = query('tag')
  if (tag !== undefined) {
    if (!TAG_RE.test(tag)) return { error: 'tag must match /^[a-z][a-z0-9-]*$/' }
    clauses.push({ sql: 'tags = ?', params: [tag] })
  }

  const ref = query('ref')
  if (ref !== undefined) {
    if (!REF_RE.test(ref))
      return { error: 'ref contains characters that are not valid in a git ref' }
    clauses.push({ sql: 'ref = ?', params: [ref] })
  }

  const since = query('since')
  if (since !== undefined) {
    const span = SINCE_MS[since]
    if (span === undefined)
      return { error: `since must be one of: ${Object.keys(SINCE_MS).join(', ')}` }
    clauses.push({ sql: 'started_at >= ?', params: [new Date(now - span).toISOString()] })
  }

  const triggeredBy = query('triggeredBy')
  if (triggeredBy !== undefined) {
    if (!(ROLES as readonly string[]).includes(triggeredBy)) {
      return { error: `triggeredBy must be one of: ${ROLES.join(', ')}` }
    }
    clauses.push({ sql: 'triggered_by = ?', params: [triggeredBy] })
  }

  const simulated = query('simulated')
  if (simulated !== undefined) {
    if (simulated !== 'real' && simulated !== 'simulated') {
      return { error: 'simulated must be one of: real, simulated' }
    }
    clauses.push({ sql: 'simulated = ?', params: [simulated === 'simulated' ? 1 : 0] })
  }

  return { clauses }
}

// ── GET /runs ───────────────────────────────────────────────────────────────
runRoutes.get('/', async (c) => {
  const role = c.get('role')
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') ?? '25', 10) || 25))
  const status = c.req.query('status')
  const suite = c.req.query('suite')
  const rawCursor = c.req.query('cursor')
  const filters = readListFilters(c.req.query.bind(c.req))
  if ('error' in filters) return c.json({ error: filters.error }, 422)

  // Rejected rather than ignored. A typo'd suite silently returning every run
  // reads as "this filter does nothing", which is a worse answer than an
  // error — the caller cannot tell a broken filter from an empty one.
  if (suite !== undefined && !isSuite(suite)) {
    return c.json({ error: `suite must be one of: ${SUITES.join(', ')}` }, 422)
  }

  // Same argument, same answer. This filter used to be passed through
  // unchecked, so `?status=failedd` returned an empty list that read as "no
  // failed runs" — the caller could not tell a broken filter from an empty one,
  // which is the exact reason the line above rejects rather than ignores.
  if (status !== undefined && !isRunStatus(status)) {
    return c.json({ error: `status must be one of: ${RUN_STATUSES.join(', ')}` }, 422)
  }

  const cursor = rawCursor ? decodeCursor(rawCursor) : null
  if (rawCursor && !cursor) return c.json({ error: 'Invalid cursor' }, 400)

  // Visibility is applied in SQL, so a role cannot receive rows it may not see
  // even if a later handler forgets to filter.
  const visibility = visibilityClause(role, c.get('sandboxId'))
  const conditions: string[] = []
  const params: unknown[] = []

  if (visibility.sql) {
    conditions.push(visibility.sql)
    params.push(...visibility.params)
  }
  if (status) {
    conditions.push('status = ?')
    params.push(status)
  }
  // Added before the count below, so the total describes the filtered set
  // rather than every run in the table.
  if (suite) {
    conditions.push('suite = ?')
    params.push(suite)
  }
  // The same, for the narrower facets. Each is AND-ed with the role's visibility
  // above, never instead of it: asking for `triggeredBy=admin` as a developer
  // narrows what a developer may see, and reveals nothing they may not.
  for (const clause of filters.clauses) {
    conditions.push(clause.sql)
    params.push(...clause.params)
  }

  // The total is counted against the same conditions but WITHOUT the cursor:
  // it answers "how many runs are there", which must not shrink as the reader
  // pages through them.
  const countWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const countParams = [...params]

  if (cursor) {
    // Strictly after the cursor row in the same (started_at DESC, id DESC)
    // order the query below sorts by.
    conditions.push('(started_at < ? OR (started_at = ? AND id < ?))')
    params.push(cursor.startedAt, cursor.startedAt, cursor.id)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // One row more than asked for, to learn whether another page exists without
  // a second query. The extra row is dropped before the response is built.
  params.push(limit + 1)

  const [{ results }, totalRow] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM runs ${where} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .bind(...params)
      .all<RunRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM runs ${countWhere}`)
      .bind(...countParams)
      .first<{ total: number }>(),
  ])

  const hasMore = results.length > limit
  const page = hasMore ? results.slice(0, limit) : results

  const secret = c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET

  const runs = await Promise.all(
    page.map(async (row) =>
      toView(
        row,
        row.report_path
          ? `/reports/${row.id}/?token=${await signReportToken(secret, row.id)}`
          : null,
      ),
    ),
  )

  // `total` is what the reader may see, not what the table holds: it is counted
  // through the same visibility clause, so a dev is never told there are runs
  // they cannot reach.
  return c.json({
    runs,
    role,
    total: totalRow?.total ?? runs.length,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
  })
})

// ── GET /runs/:id ───────────────────────────────────────────────────────────
runRoutes.get('/:id', async (c) => {
  // The same clause as the list, in the query: a run of another sandbox is
  // "no such run", exactly as one that does not exist.
  const visibility = visibilityClause(c.get('role'), c.get('sandboxId'))
  const row = await c.env.DB.prepare(`SELECT * FROM runs WHERE id = ? AND ${visibility.sql}`)
    .bind(c.req.param('id'), ...visibility.params)
    .first<RunRow>()
  if (!row) return c.json({ error: 'No such run' }, 404)

  const secret = c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET
  const reportUrl = row.report_path
    ? `/reports/${row.id}/?token=${await signReportToken(secret, row.id)}`
    : null
  return c.json({ ...toView(row, reportUrl), details: parseDetails(row.details) })
})

runRoutes.delete('/:id', requireRole('admin'), refuseKeys('delete runs'), async (c) => {
  const id = c.req.param('id') as string
  // Only a run of the caller's own sandbox. A real run has no sandbox, so no
  // visitor can delete one; retention is what removes those.
  const result = await c.env.DB.prepare(`DELETE FROM runs WHERE id = ?1 AND sandbox_id = ?2`)
    .bind(id, c.get('sandboxId'))
    .run()
  if (result.meta.changes === 0) return c.json({ error: 'No such run' }, 404)
  await record(c.env.DB, c.get('sandboxId'), actorFor(c), 'run-deleted', id)
  // A sandbox run points at the shared demo report and owns no stored object,
  // so there is nothing in R2 to remove with it.
  return c.json({ ok: true })
})
