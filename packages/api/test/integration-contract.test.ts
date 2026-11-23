import { describe, expect, it, beforeAll } from 'vitest'
import { migrate, postWebhook, seedRun, statusOf, request } from './helpers'
import { env } from 'cloudflare:test'
import { signReportToken } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'

beforeAll(migrate)

/**
 * The contract with the suites whose results this dashboard shows.
 *
 * The repositories meet at two points now that nothing is dispatched (decision
 * 52): the report uploaded into this bucket, and the callback posted when a
 * run finishes. There used to be a third, the workflow inputs sent on
 * dispatch, and it is where they had drifted — a service name sent in an input
 * the workflow only accepted a package name for.
 *
 * None of them can import the others, so nothing but a test like this stops
 * them drifting. The payload below is the shape both `.github/workflows/on-demand.yml`
 * files build in their "Report the result" step. If either changes, this fails.
 */
describe('the callback the suite workflow sends', () => {
  /*
   * Every field both workflows' "Report the result" step builds, on the path
   * where everything worked: the suite ran, the report uploaded, and the
   * callback carries the lot.
   *
   * Listing all of them is the point. A payload holding only the four totals
   * would still pass while the dashboard dropped `durationMs` on the floor —
   * which is exactly what a partial version of this test did until the
   * workflows started sending it.
   */
  it('is accepted, and records everything it carries', async () => {
    const id = await seedRun({ status: 'running' })

    const response = await postWebhook({
      runId: id,
      status: 'passed',
      total: 92,
      passed: 92,
      failed: 0,
      durationMs: 41_200,
      reportPath: `runs/${id}/index.html`,
      workflowUrl: 'https://github.com/owner/repo/actions/runs/123',
      suiteVersion: '1.0.0',
      suiteSha: '0f2c1ab',
    })

    expect(response.status).toBe(200)

    const row = await env.DB.prepare(
      `SELECT status, total, passed, failed, duration_ms, report_path,
              workflow_url, suite_version, suite_sha
         FROM runs WHERE id = ?1`,
    )
      .bind(id)
      .first<{
        status: string
        total: number
        passed: number
        failed: number
        duration_ms: number
        report_path: string
        workflow_url: string
        suite_version: string
        suite_sha: string
      }>()

    expect(row).toMatchObject({
      status: 'passed',
      total: 92,
      passed: 92,
      failed: 0,
      duration_ms: 41_200,
      report_path: `runs/${id}/index.html`,
      workflow_url: 'https://github.com/owner/repo/actions/runs/123',
      suite_version: '1.0.0',
      suite_sha: '0f2c1ab',
    })
  })

  it('accepts a failed run, which the workflow reports the same way', async () => {
    const id = await seedRun({ status: 'running' })

    const response = await postWebhook({
      runId: id,
      status: 'failed',
      total: 92,
      passed: 90,
      failed: 2,
      workflowUrl: 'https://github.com/owner/repo/actions/runs/124',
    })

    expect(response.status).toBe(200)
    expect(await statusOf(id)).toBe('failed')
  })

  /**
   * The workflow omits `reportPath` when its upload step did not succeed —
   * that step is `continue-on-error`, so a failed upload still reaches the
   * callback. The callback must not fail for that, and must not invent a
   * report link. The same omission happens on a run whose deployment has no
   * R2 credentials configured at all.
   */
  it('accepts a callback with no report path', async () => {
    const id = await seedRun({ status: 'running', reportPath: null })

    expect(
      (await postWebhook({ runId: id, status: 'passed', total: 1, passed: 1, failed: 0 })).status,
    ).toBe(200)

    const row = await env.DB.prepare('SELECT report_path FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ report_path: string | null }>()

    expect(row?.report_path).toBeNull()
  })
})

describe('the report path the workflow posts back', () => {
  it('resolves to a report the serving route can find', async () => {
    const id = await seedRun()
    await env.REPORTS.put(`runs/${id}/index.html`, '<h1>real</h1>', {
      httpMetadata: { contentType: 'text/html' },
    })

    // Exactly what `on-demand.yml`'s callback step sends after a good upload.
    const response = await postWebhook({
      runId: id,
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
      reportPath: `runs/${id}/index.html`,
    })
    expect(response.status).toBe(200)

    const opened = await request(
      `/reports/${id}/?token=${await signReportToken(DEV_TOKEN_SECRET, id)}`,
    )
    expect(opened.status).toBe(200)
    expect(await opened.text()).toContain('real')
  })

  /*
   * The fourth meeting point, which the other three do not cover.
   *
   * The documented three are the workflow inputs, this path, and the callback
   * shape. There is a fourth, and it went uncounted: the report's *form*. Both
   * suites build Allure with `--single-file`, and their workflows upload
   * exactly one object — `allure-report/index.html` to `runs/{runId}/index.html`.
   *
   * Nothing held that. `SINGLE_FILE` is an environment variable in the suites
   * (`scripts/allure-report.mjs`), so the multi-file build is one variable
   * away; the upload step would still send only `index.html`, and this
   * dashboard would serve an entry point whose ~450 relative assets all 404.
   * A report that renders empty is not a loud failure — it looks like a run
   * that produced nothing.
   *
   * So this pins the shape the contract actually relies on: an entry point
   * that is self-contained, served without any second request. If a suite ever
   * moves to multi-file, this is the test that has to be changed on purpose
   * rather than a page that quietly stops rendering.
   */
  it('serves a report that needs nothing but its own entry point', async () => {
    const id = await seedRun()

    // One object under the prefix, which is what both workflows upload.
    await env.REPORTS.put(`runs/${id}/index.html`, '<html><body>inlined</body></html>', {
      httpMetadata: { contentType: 'text/html' },
    })

    await postWebhook({
      runId: id,
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
      reportPath: `runs/${id}/index.html`,
    })

    const token = await signReportToken(DEV_TOKEN_SECRET, id)
    const opened = await request(`/reports/${id}/?token=${token}`)

    expect(opened.status).toBe(200)
    expect(await opened.text()).toContain('inlined')

    // And the prefix really does hold only that one object — an assertion that
    // fails the day an upload starts sending assets alongside it.
    const listed = await env.REPORTS.list({ prefix: `runs/${id}/` })
    expect(listed.objects.map((o) => o.key)).toEqual([`runs/${id}/index.html`])
  })

  /**
   * The upload step is `continue-on-error`, so a failed upload still reaches
   * the callback — with `reportPath` omitted. The run must not end up claiming
   * a report that was never written.
   */
  it('leaves the run without a report when the upload did not happen', async () => {
    const id = await seedRun()

    const response = await postWebhook({
      runId: id,
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
    })
    expect(response.status).toBe(200)

    const row = await env.DB.prepare('SELECT report_path FROM runs WHERE id = ?1')
      .bind(id)
      .first<{ report_path: string | null }>()
    expect(row?.report_path).toBeNull()
  })
})
