import { describe, expect, it, beforeAll } from 'vitest'
import { migrate, postWebhook, seedRun, statusOf, request } from './helpers'
import { env } from 'cloudflare:test'
import { dispatchWorkflow } from '../src/github'
import { signReportToken } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'
import type { Bindings } from '../src/types'

beforeAll(migrate)

/**
 * The contract with the suite this dashboard triggers.
 *
 * Two repositories meet at exactly three points: the workflow inputs sent on
 * dispatch, the report uploaded into this bucket, and the callback posted when
 * the run finishes. Neither side can import the other, so nothing but a test
 * like this stops them drifting — and they had drifted: the dashboard was
 * sending a service name in an input the workflow only accepted a package name
 * for, and the workflow had no callback step at all.
 *
 * The payload below is the exact shape `.github/workflows/on-demand.yml`
 * builds in its "Report the result" step. If that step changes, this fails.
 */
describe('the callback the suite workflow sends', () => {
  it('is accepted, and records the totals', async () => {
    const id = await seedRun({ status: 'running' })

    // Field-for-field what the workflow posts.
    const response = await postWebhook({
      runId: id,
      status: 'passed',
      total: 92,
      passed: 92,
      failed: 0,
      workflowUrl: 'https://github.com/owner/repo/actions/runs/123',
    })

    expect(response.status).toBe(200)

    const row = await env.DB.prepare(
      'SELECT status, total, passed, failed, workflow_url FROM runs WHERE id = ?1',
    )
      .bind(id)
      .first<{
        status: string
        total: number
        passed: number
        failed: number
        workflow_url: string
      }>()

    expect(row).toMatchObject({
      status: 'passed',
      total: 92,
      passed: 92,
      failed: 0,
      workflow_url: 'https://github.com/owner/repo/actions/runs/123',
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
   * The workflow omits `reportPath` — it uploads its report as a GitHub
   * artifact rather than to this dashboard's bucket. The callback must not
   * fail for that, and must not invent a report link.
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

/**
 * The dispatch half of the same contract.
 *
 * These values are the workflow's `options:` lists, copied by hand. Copying is
 * the test — deriving them from the other repo would need it checked out, and
 * asserting against a list this repo also generates would prove nothing.
 *
 * If `on-demand.yml` changes its accepted values, this list goes stale and the
 * mismatch shows up here rather than as a 422 from GitHub in production.
 */
const WORKFLOW_ACCEPTS = {
  style: ['both', 'functional-style', 'class-style'],
  scope: ['all', 'smoke', 'isolated', 'flow', 'items', 'reservations', 'maintenance-logs', 'core'],
}

describe('the dispatch the dashboard sends', () => {
  /** Captures the body without reaching the network. */
  async function dispatchBody(input: {
    service: string
    tags: string
    workers?: number
    ref?: string
  }) {
    let captured: Record<string, string> = {}

    const fetchMock = async (_url: string, init: RequestInit) => {
      captured = (JSON.parse(String(init.body)) as { inputs: Record<string, string> }).inputs
      return new Response(null, { status: 204 })
    }

    const previous = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    try {
      await dispatchWorkflow(
        {
          SIMULATE_DISPATCH: 'false',
          GITHUB_TOKEN: 'test-token',
          GITHUB_REPO: 'owner/repo',
          GITHUB_WORKFLOW: 'on-demand.yml',
        } as Bindings,
        'run-1',
        'admin',
        input,
      )
    } finally {
      globalThis.fetch = previous
    }

    return captured
  }

  it.each([
    ['items', 'smoke'],
    ['reservations', 'flow'],
    ['maintenance-logs', 'isolated'],
    ['core', 'smoke'],
  ])('sends a service (%s) in an input the workflow accepts', async (service, tags) => {
    const body = await dispatchBody({ service, tags })

    expect(WORKFLOW_ACCEPTS.scope).toContain(body.scope)
    expect(WORKFLOW_ACCEPTS.style).toContain(body.style)
  })

  /**
   * The mismatch that existed: a service name was sent as `style`, which the
   * workflow only accepts package names for. Every dispatch would have been
   * rejected.
   */
  it('never sends a service name as the package selector', async () => {
    const body = await dispatchBody({ service: 'items', tags: 'smoke' })

    expect(body.style).not.toBe('items')
    expect(body.scope).toBe('items')
  })

  it('falls back to the tag when no single service was chosen', async () => {
    const body = await dispatchBody({ service: 'all', tags: 'smoke' })

    expect(body.scope).toBe('smoke')
  })

  it('sends the run id, so the callback can name the run it finished', async () => {
    const body = await dispatchBody({ service: 'items', tags: 'smoke' })

    expect(body.run_id).toBe('run-1')
  })

  it('sends workers as a string, which is all GitHub accepts', async () => {
    const body = await dispatchBody({ service: 'items', tags: 'smoke', workers: 8 })

    expect(body.workers).toBe('8')
  })
})

/**
 * The report half of the same contract.
 *
 * The workflow uploads its Allure report to `runs/{run_id}/` in R2, then posts
 * that path back as `reportPath`. Two repos have to agree on that string: the
 * workflow builds it, this one serves from it, and nothing checks they match
 * at compile time.
 *
 * Pinned as a literal, deliberately. Deriving the expected path from the same
 * code that produces it would agree by construction and prove nothing — the
 * mistake already made once here, in the simulator's report test.
 */
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
