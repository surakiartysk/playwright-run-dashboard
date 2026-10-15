import { Hono } from 'hono'
import type { Bindings, HonoEnv, Suite, WebhookPayload } from '../types'
import { REPORTABLE_STATUSES, isReportableStatus } from '../types'
import { verifyHmac } from '../crypto'
import { DEV_WEBHOOK_SECRET } from '../config'
import { sanitizeFailures } from '../details'

export const webhookRoutes = new Hono<HonoEnv>()

/** Requests older than this are refused, so a captured one cannot be replayed. */
const MAX_AGE_SECONDS = 300

/**
 * The secrets a callback may be signed with, and the suite each may report for.
 * `suite: null` is every suite.
 *
 * One secret per suite means a secret that leaks from one suite's repository
 * can report only that suite's runs. Before, both repositories held the same
 * one, so either could write a result for the other's runs.
 *
 * `WEBHOOK_SECRET`, the old shared one, still counts for every suite while it
 * is set, so a deployment can move to the new pair without a moment in which
 * a workflow's callback is signed with a secret the Worker does not know. When
 * none of the three is set, the development default stands in, as it always
 * has; once any is set, the default is not accepted.
 */
function webhookSecrets(env: Bindings): { secret: string; suite: Suite | null }[] {
  const secrets: { secret: string; suite: Suite | null }[] = []
  if (env.WEBHOOK_SECRET_API) secrets.push({ secret: env.WEBHOOK_SECRET_API, suite: 'api' })
  if (env.WEBHOOK_SECRET_UI) secrets.push({ secret: env.WEBHOOK_SECRET_UI, suite: 'ui' })
  if (env.WEBHOOK_SECRET) secrets.push({ secret: env.WEBHOOK_SECRET, suite: null })
  if (secrets.length === 0) secrets.push({ secret: DEV_WEBHOOK_SECRET, suite: null })
  return secrets
}

/**
 * POST /webhook — the workflow reporting its result.
 *
 * This endpoint writes the numbers the dashboard displays, so it is the one
 * worth signing: without it anyone who learns a run id could mark a failing
 * run green.
 *
 * The signature covers `timestamp.body` rather than the body alone. Signing
 * only the body leaves a valid request replayable forever; including the
 * timestamp binds it to a moment, and the age check enforces that.
 */
webhookRoutes.post('/', async (c) => {
  const timestamp = c.req.header('X-Webhook-Timestamp')
  const signature = c.req.header('X-Webhook-Signature')

  if (!timestamp || !signature) {
    return c.json({ error: 'Missing X-Webhook-Timestamp or X-Webhook-Signature' }, 400)
  }

  const age = Date.now() / 1000 - Number.parseInt(timestamp, 10)
  // A small negative allowance covers ordinary clock skew between the runner
  // and the edge; a large one would reopen the replay window.
  if (Number.isNaN(age) || age > MAX_AGE_SECONDS || age < -60) {
    return c.json({ error: 'Timestamp outside the accepted window' }, 401)
  }

  // Read as text: the signature covers the exact bytes sent, and re-serialising
  // parsed JSON would not reproduce them.
  const raw = await c.req.text()
  const provided = signature.replace(/^sha256=/, '')

  // Every secret is tried, so the time taken does not say which one matched.
  let allowedSuite: Suite | null | undefined
  for (const candidate of webhookSecrets(c.env)) {
    const ok = await verifyHmac(candidate.secret, `${timestamp}.${raw}`, provided)
    if (ok && allowedSuite === undefined) allowedSuite = candidate.suite
  }
  if (allowedSuite === undefined) {
    return c.json({ error: 'Bad signature' }, 401)
  }

  let payload: WebhookPayload
  try {
    payload = JSON.parse(raw) as WebhookPayload
  } catch {
    return c.json({ error: 'Body must be JSON' }, 400)
  }

  if (!payload.runId || !payload.status) {
    return c.json({ error: 'runId and status are required' }, 422)
  }

  /*
   * Checked here rather than left to the CHECK constraint in migration 0001.
   *
   * The database does refuse a bad status, but it refuses by throwing, and the
   * caller was told "Internal error" with a 500 — which points a suite author
   * at a dashboard that is working fine. This is a contract between three
   * repositories that cannot import each other, so this response is the only
   * place the mismatch can be named.
   */
  if (!isReportableStatus(payload.status)) {
    return c.json({ error: `status must be one of: ${REPORTABLE_STATUSES.join(', ')}` }, 422)
  }

  /*
   * A result that counted no tests is an error, not a pass or a fail.
   *
   * A scope and a tag the form lets someone pick can match nothing: Items with
   * @flow, Core with @smoke, fourteen pairs in the API suite. The workflow then
   * has nothing to run, Playwright exits non-zero with "No tests found", and the
   * callback said `failed` with 0 of 0. The row showed a red cross, counted
   * against the pass rate, and its detail said "This result did not say which
   * tests failed" about a run in which none had been run. `passed` with no
   * tests is as wrong the other way, and nothing sends it today.
   *
   * Decided here and not in each suite's workflow because this is where every
   * suite's result lands, and because "ran nothing" is a fact about the number
   * and not about the suite. Only an explicit 0: a workflow older than the
   * totals omits them, and that is not a run that counted nothing. `error` and
   * `timeout` are left as they were reported.
   */
  const status =
    payload.total === 0 && (payload.status === 'passed' || payload.status === 'failed')
      ? 'error'
      : payload.status

  const result = await c.env.DB.prepare(
    `UPDATE runs
        SET status = ?2, total = ?3, passed = ?4, failed = ?5,
            finished_at = ?6, duration_ms = ?7,
            report_path = COALESCE(?8, report_path),
            workflow_url = COALESCE(?9, workflow_url),
            suite_version = COALESCE(?10, suite_version),
            suite_sha = COALESCE(?11, suite_sha),
            details = COALESCE(?12, details)
      WHERE id = ?1 AND (?13 IS NULL OR suite = ?13)`,
  )
    .bind(
      payload.runId,
      status,
      payload.total ?? null,
      payload.passed ?? null,
      payload.failed ?? null,
      new Date().toISOString(),
      payload.durationMs ?? null,
      payload.reportPath ?? null,
      payload.workflowUrl ?? null,
      // COALESCEd like the two above: a workflow older than these fields sends
      // neither, and overwriting a recorded version with null would lose the
      // only record of what ran.
      payload.suiteVersion ?? null,
      payload.suiteSha ?? null,
      // Bounded and typed here, never rejected: a callback whose detail is
      // malformed still has to deliver its totals. COALESCEd like the rest, so a
      // callback without it keeps what an earlier one said.
      (() => {
        const details = sanitizeFailures(payload.failures, payload.failuresOmitted)
        return details ? JSON.stringify(details) : null
      })(),
      allowedSuite,
    )
    .run()

  if (result.meta.changes === 0) {
    // A run of the other suite is a different answer from no run at all: the
    // signature was good, and the secret that made it is not that suite's.
    // Worth saying, because it is what a secret put in the wrong repository
    // looks like.
    const other = await c.env.DB.prepare(`SELECT suite FROM runs WHERE id = ?1`)
      .bind(payload.runId)
      .first<{ suite: string }>()
    if (other) {
      return c.json(
        { error: `This secret may not report for runs of the ${other.suite} suite` },
        403,
      )
    }
    // A signed callback for a run with no record here means the two sides
    // disagree about what exists — worth a 404 rather than a silent no-op.
    return c.json({ error: `No run with id ${payload.runId}` }, 404)
  }

  return c.json({ ok: true })
})
