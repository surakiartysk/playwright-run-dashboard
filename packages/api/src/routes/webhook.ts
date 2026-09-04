import { Hono } from 'hono'
import type { HonoEnv, WebhookPayload } from '../types'
import { verifyHmac } from '../crypto'
import { DEV_WEBHOOK_SECRET } from '../config'

export const webhookRoutes = new Hono<HonoEnv>()

/** Requests older than this are refused, so a captured one cannot be replayed. */
const MAX_AGE_SECONDS = 300

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
  const secret = c.env.WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET
  const provided = signature.replace(/^sha256=/, '')

  if (!(await verifyHmac(secret, `${timestamp}.${raw}`, provided))) {
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

  const result = await c.env.DB.prepare(
    `UPDATE runs
        SET status = ?2, total = ?3, passed = ?4, failed = ?5,
            finished_at = ?6, duration_ms = ?7,
            report_path = COALESCE(?8, report_path),
            workflow_url = COALESCE(?9, workflow_url),
            suite_version = COALESCE(?10, suite_version),
            suite_sha = COALESCE(?11, suite_sha)
      WHERE id = ?1`,
  )
    .bind(
      payload.runId,
      payload.status,
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
    )
    .run()

  // A signed callback for a run we have no record of means the two sides
  // disagree about what exists — worth a 404 rather than a silent no-op.
  if (result.meta.changes === 0) {
    return c.json({ error: `No run with id ${payload.runId}` }, 404)
  }

  return c.json({ ok: true })
})
