import { Hono } from 'hono'
import type { Context } from 'hono'
import type { CreateRunRequest, HonoEnv, Role, RunRow } from '../types'
import { toView } from '../types'
import { dispatchWorkflow } from '../github'
import { simulateRun } from '../simulate'
import { signReportToken } from '../crypto'
import { DEV_TOKEN_SECRET } from '../config'
import { requireSession, requireRole, verifyPreviewRole } from '../auth'
import { mayUseRef, policyFor, visibilityClause } from '../policy'
import { gateApplies, loadGate, resolveGate } from '../gate'

export const runRoutes = new Hono<HonoEnv>()

// Every route here needs a session; none of them are public.
runRoutes.use('*', requireSession)

/**
 * The role to show a *read* response for — the caller's real, authenticated
 * role, unless they are a `demo` session previewing another one.
 *
 * Deliberately not used by POST / or DELETE /:id below: those keep reading
 * `c.get('role')` directly, so a demo session previewing 'admin' still hits
 * demo's own policy and dispatch guarantees on every write path. Only the two
 * GET handlers call this — see docs/decisions.md on why the preview cookie is
 * a display-only concept, never a second claim on write authorisation.
 */
async function resolveViewRole(c: Context<HonoEnv>): Promise<Role> {
  const role = c.get('role')
  if (role !== 'demo') return role

  const previewed = await verifyPreviewRole(
    c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET,
    c.req.header('Cookie'),
    c.get('sessionExpiresAt'),
  )
  return previewed ?? role
}

/**
 * `20260826-1430-items-k3f9qw` — sortable, readable, usable as an R2 prefix.
 *
 * The suffix is not decoration. Minute precision alone collides the moment two
 * people run the same service in the same minute, which is an ordinary Tuesday
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

const SERVICE_RE = /^[a-z][a-z0-9-]*$/
const TAG_RE = /^[a-z][a-z0-9-]*$/
const REF_RE = /^[a-zA-Z0-9._\-/]+$/

// ── POST /runs ──────────────────────────────────────────────────────────────
runRoutes.post('/', async (c) => {
  const role = c.get('role')
  const apiKey = c.get('apiKey')

  // A key's policy is its role's, already narrowed by its own limits — see
  // effectivePolicy in apiKeys.ts. Reading it here rather than re-deriving the
  // narrowing means the rule lives in one place, and a handler that forgets to
  // ask gets the role's limits rather than something wrong.
  const policy = apiKey?.policy ?? policyFor(role)

  const body = (await c.req.json().catch(() => null)) as CreateRunRequest | null
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)

  const { service, tags, workers } = body
  const ref = body.ref ?? 'main'

  if (!service || !SERVICE_RE.test(service)) {
    return c.json({ error: 'service must match /^[a-z][a-z0-9-]*$/' }, 422)
  }
  if (!tags || !TAG_RE.test(tags)) {
    return c.json({ error: 'tags must match /^[a-z][a-z0-9-]*$/' }, 422)
  }
  if (!REF_RE.test(ref)) {
    return c.json({ error: 'ref contains characters that are not valid in a git ref' }, 422)
  }

  // 403, not 422: the request is well-formed, the caller simply may not make
  // it. A client can tell "fix your input" from "ask for access" by the status.
  const refAllowed = apiKey
    ? policy.allowedRefs.includes('*') || policy.allowedRefs.includes(ref)
    : mayUseRef(role, ref)

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
    const gate = resolveGate(await loadGate(c.env.DB), new Date())
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

  if (workers !== undefined) {
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
  }

  const id = makeRunId(service)

  // Written before dispatching. A run that fails to reach GitHub is still a run
  // someone asked for, and it should be visible with its error rather than
  // vanishing.
  await c.env.DB.prepare(
    `INSERT INTO runs (id, service, tags, workers, triggered_by, status, ref, started_at, api_key_id)
     VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8)`,
  )
    .bind(
      id,
      service,
      tags,
      workers ?? null,
      role,
      ref,
      new Date().toISOString(),
      // Null for a person. `triggered_by` still holds the role either way, so
      // an existing reader is unaffected; this only adds the answer to "which
      // pipeline?" that the role alone cannot give.
      apiKey?.id ?? null,
    )
    .run()

  const dispatch = await dispatchWorkflow(c.env, id, role, { service, tags, workers, ref })

  if (!dispatch.ok) {
    await c.env.DB.prepare(`UPDATE runs SET status = 'error', finished_at = ?2 WHERE id = ?1`)
      .bind(id, new Date().toISOString())
      .run()
    return c.json({ error: dispatch.error ?? 'Dispatch failed', runId: id }, 502)
  }

  if (dispatch.simulated) {
    c.executionCtx.waitUntil(simulateRun(c.env, id, service))
  }

  return c.json({ runId: id, status: 'queued', simulated: dispatch.simulated }, 201)
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

// ── GET /runs ───────────────────────────────────────────────────────────────
runRoutes.get('/', async (c) => {
  const role = c.get('role')
  const viewAs = await resolveViewRole(c)
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') ?? '25', 10) || 25))
  const status = c.req.query('status')
  const rawCursor = c.req.query('cursor')

  const cursor = rawCursor ? decodeCursor(rawCursor) : null
  if (rawCursor && !cursor) return c.json({ error: 'Invalid cursor' }, 400)

  // Visibility is applied in SQL, so a role cannot receive rows it may not see
  // even if a later handler forgets to filter.
  const visibility = visibilityClause(viewAs)
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

  // `role` is always the real, authenticated session; `viewAs` only differs
  // from it for a demo session previewing another role's read view — the UI
  // needs both so it can be honest about which is which.
  //
  // `total` is what the reader may see, not what the table holds: it is counted
  // through the same visibility clause, so a dev is never told there are runs
  // they cannot reach.
  return c.json({
    runs,
    role,
    viewAs,
    total: totalRow?.total ?? runs.length,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
  })
})

// ── GET /runs/:id ───────────────────────────────────────────────────────────
runRoutes.get('/:id', async (c) => {
  const viewAs = await resolveViewRole(c)

  const row = await c.env.DB.prepare(`SELECT * FROM runs WHERE id = ?1`)
    .bind(c.req.param('id'))
    .first<RunRow>()

  if (!row) return c.json({ error: 'No such run' }, 404)

  // 404 rather than 403 for a run this role may not see: telling a developer
  // that a run exists but is off-limits leaks the branch names they were
  // scoped away from — and for demo, would confirm that some other visitor's
  // run id is real.
  const visibility = visibilityClause(viewAs)
  if (visibility.column && row[visibility.column as keyof RunRow] !== visibility.value) {
    return c.json({ error: 'No such run' }, 404)
  }

  const secret = c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET
  const reportUrl = row.report_path
    ? `/reports/${row.id}/?token=${await signReportToken(secret, row.id)}`
    : null

  return c.json(toView(row, reportUrl))
})

// ── DELETE /runs/:id ────────────────────────────────────────────────────────
runRoutes.delete('/:id', requireRole('admin'), async (c) => {
  /*
   * `requireRole('admin')` checks the role and nothing else, and a key carries
   * a role — so an admin-level key reached this handler and deleted a run.
   *
   * Caught by a test, not by review. It is the shape of bug this whole feature
   * invites: a key is deliberately made to look like a person by the time a
   * handler sees it, which is what keeps every other rule working unchanged —
   * and it means a rule enforced by role alone silently applies to keys too.
   *
   * Deletion is destructive, irreversible, and has no automated use case, so
   * `effectivePolicy` refuses it for every key regardless of role. This is
   * where that refusal is enforced.
   */
  if (c.get('apiKey')) {
    return c.json({ error: 'Keys may not delete runs — sign in to do that' }, 403)
  }

  const id = c.req.param('id')

  const result = await c.env.DB.prepare(`DELETE FROM runs WHERE id = ?1`).bind(id).run()
  if (result.meta.changes === 0) return c.json({ error: 'No such run' }, 404)

  // The report outlives the row otherwise, and R2 is billed by what it holds.
  const listed = await c.env.REPORTS.list({ prefix: `runs/${id}/` })
  await Promise.all(listed.objects.map((object) => c.env.REPORTS.delete(object.key)))

  return c.json({ ok: true, deletedObjects: listed.objects.length })
})
