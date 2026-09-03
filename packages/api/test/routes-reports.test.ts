import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, request, as, seedRun } from './helpers'
import type { RunView } from '../src/types'
import { signReportToken } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'

beforeAll(migrate)

const tokenFor = (runId: string, ttl?: number) => signReportToken(DEV_TOKEN_SECRET, runId, ttl)

/**
 * A run whose report lives under its own prefix — the row points at it, and
 * the caller puts the bytes there.
 *
 * Both halves matter: `routes/reports.ts` reads `report_path` to learn which
 * prefix holds the report, so bytes in R2 with no path on the row is a state
 * a real run never reaches. `seedRun` alone leaves `report_path` null, which
 * is the "nothing was uploaded" case tested separately below.
 */
async function seedRunWithReport(overrides: Parameters<typeof seedRun>[0] = {}) {
  const id = await seedRun(overrides)
  await env.DB.prepare(`UPDATE runs SET report_path = ?2 WHERE id = ?1`)
    .bind(id, `runs/${id}/index.html`)
    .run()
  return id
}

/**
 * Reports live in a bucket that is never public.
 *
 * A Playwright report names environments, payloads and failure detail, so the
 * link is scoped to one run and expires. The token is accepted from the query
 * string because the report's own asset requests cannot carry a header — which
 * is only acceptable *because* it is scoped to a single run.
 */
describe('GET /reports/:runId/*', () => {
  it('serves the report to a correctly scoped token', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, '<h1>report</h1>', {
      httpMetadata: { contentType: 'text/html' },
    })

    const response = await request(`/reports/${id}/?token=${await tokenFor(id)}`)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('report')
  })

  it('serves an asset under the run prefix', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/assets/app.js`, 'console.log(1)')

    const response = await request(`/reports/${id}/assets/app.js?token=${await tokenFor(id)}`)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('console.log')
  })

  it('accepts the token as a bearer header too', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, 'ok')

    const response = await request(`/reports/${id}/`, {
      headers: { Authorization: `Bearer ${await tokenFor(id)}` },
    })

    expect(response.status).toBe(200)
  })

  /**
   * Asserts the message, not just the status.
   *
   * Both the missing-token guard and the verification below return 401, so a
   * status-only assertion passes with the first guard deleted — verified by
   * deleting it. The distinction is worth keeping: "you sent nothing" and
   * "what you sent is not valid" are different answers, and a caller
   * debugging a broken link needs to know which one it got.
   */
  it('refuses a request with no token, saying a token is required', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, 'secret')

    const response = await request(`/reports/${id}/`)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'A report token is required' })
  })

  it('distinguishes a malformed token from a missing one', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, 'secret')

    const response = await request(`/reports/${id}/?token=not-a-token`)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'Token is invalid or expired' })
  })

  it('refuses a token signed with another secret', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, 'secret')

    const forged = await signReportToken('not-the-secret', id)

    expect((await request(`/reports/${id}/?token=${forged}`)).status).toBe(401)
  })

  /**
   * The property that makes query-string tokens acceptable: holding a link to
   * one report must not open another.
   */
  it('refuses a valid token issued for a different run', async () => {
    const mine = await seedRunWithReport()
    const theirs = await seedRunWithReport()
    await env.REPORTS.put(`runs/${theirs}/index.html`, 'not yours')

    const response = await request(`/reports/${theirs}/?token=${await tokenFor(mine)}`)

    expect(response.status).toBe(403)
  })

  it('refuses an expired token', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, 'secret')

    // Minted already expired, rather than waiting an hour.
    const expired = await tokenFor(id, -10)

    expect((await request(`/reports/${id}/?token=${expired}`)).status).toBe(401)
  })

  it('404s when the token is good but nothing was uploaded', async () => {
    const id = await seedRun()

    expect((await request(`/reports/${id}/?token=${await tokenFor(id)}`)).status).toBe(404)
  })

  /**
   * A real Allure report pulls its JS, CSS and fonts by relative path, and a
   * browser does not carry the opening link's query string onto those
   * requests — so without this every asset 401s and the report renders as a
   * spinner forever. Verified against the deployment before it was fixed.
   */
  describe('the asset cookie', () => {
    it('is set when the entry point is opened with a valid token', async () => {
      const id = await seedRunWithReport()
      await env.REPORTS.put(`runs/${id}/index.html`, 'ok')

      const response = await request(`/reports/${id}/?token=${await tokenFor(id)}`)
      const cookie = response.headers.get('Set-Cookie') ?? ''

      expect(cookie).toContain('HttpOnly')
      // Pinned to this run's report: never sent to another run, never to the API.
      expect(cookie).toContain(`Path=/reports/${id}/`)
    })

    it('lets an asset request with no token of its own through', async () => {
      const id = await seedRunWithReport()
      await env.REPORTS.put(`runs/${id}/index.html`, 'ok')
      await env.REPORTS.put(`runs/${id}/app.js`, 'console.log(1)')

      const opened = await request(`/reports/${id}/?token=${await tokenFor(id)}`)
      const cookie = (opened.headers.get('Set-Cookie') ?? '').split(';')[0]!

      // No `?token=` — exactly what the browser sends for a relative <script>.
      const asset = await request(`/reports/${id}/app.js`, { headers: { Cookie: cookie } })

      expect(asset.status).toBe(200)
      expect(await asset.text()).toContain('console.log')
    })

    /**
     * The property that keeps the cookie from widening anything: it carries
     * the same run-scoped token, so it is refused for a different run exactly
     * as the token itself would be. `Path` stops a browser sending it there at
     * all; this proves the server refuses even when one is sent by hand.
     */
    it('does not open a different run, even if sent there deliberately', async () => {
      const mine = await seedRunWithReport()
      const theirs = await seedRunWithReport()
      await env.REPORTS.put(`runs/${mine}/index.html`, 'ok')
      await env.REPORTS.put(`runs/${theirs}/index.html`, 'not yours')

      const opened = await request(`/reports/${mine}/?token=${await tokenFor(mine)}`)
      const cookie = (opened.headers.get('Set-Cookie') ?? '').split(';')[0]!

      // Rename the cookie to the one the other run's report would look for,
      // keeping my token as its value.
      const forged = cookie.replace(
        `report_${mine.replace(/[^a-zA-Z0-9]/g, '_')}=`,
        `report_${theirs.replace(/[^a-zA-Z0-9]/g, '_')}=`,
      )
      const response = await request(`/reports/${theirs}/`, { headers: { Cookie: forged } })

      expect(response.status).toBe(403)
    })

    it('is not re-set on every asset, only on the entry point', async () => {
      const id = await seedRunWithReport()
      await env.REPORTS.put(`runs/${id}/index.html`, 'ok')
      await env.REPORTS.put(`runs/${id}/app.js`, 'x')

      const opened = await request(`/reports/${id}/?token=${await tokenFor(id)}`)
      const cookie = (opened.headers.get('Set-Cookie') ?? '').split(';')[0]!

      const asset = await request(`/reports/${id}/app.js`, { headers: { Cookie: cookie } })
      expect(asset.headers.get('Set-Cookie')).toBeNull()
    })

    /**
     * The bug this caught on the live deployment: with the entry point
     * cacheable, the edge replayed it to the next visitor without running the
     * handler — so no `Set-Cookie` was sent, and every asset the page asked
     * for 401'd. The page has to be uncacheable precisely *because* it is the
     * response that carries the cookie.
     */
    it('never caches the entry point, since it is what carries the cookie', async () => {
      const id = await seedRunWithReport()
      await env.REPORTS.put(`runs/${id}/index.html`, 'ok')
      await env.REPORTS.put(`runs/${id}/app.js`, 'x')

      const entry = await request(`/reports/${id}/?token=${await tokenFor(id)}`)
      expect(entry.headers.get('cache-control')).toContain('no-store')

      // Assets stay cacheable — they are immutable and carry no cookie.
      const cookie = (entry.headers.get('Set-Cookie') ?? '').split(';')[0]!
      const asset = await request(`/reports/${id}/app.js`, { headers: { Cookie: cookie } })
      expect(asset.headers.get('cache-control')).toContain('max-age')
    })

    it('re-sets the cookie on a repeat visit that already has one', async () => {
      const id = await seedRunWithReport()
      await env.REPORTS.put(`runs/${id}/index.html`, 'ok')

      const first = await request(`/reports/${id}/?token=${await tokenFor(id)}`)
      const cookie = (first.headers.get('Set-Cookie') ?? '').split(';')[0]!

      // A visitor reloading the page must not be left without a fresh cookie
      // just because they arrived holding one.
      const again = await request(`/reports/${id}/?token=${await tokenFor(id)}`, {
        headers: { Cookie: cookie },
      })
      expect(again.headers.get('Set-Cookie')).toContain('report_')
    })
  })

  it('marks the response private so shared caches do not hold a report', async () => {
    const id = await seedRunWithReport()
    await env.REPORTS.put(`runs/${id}/index.html`, 'ok')

    const response = await request(`/reports/${id}/?token=${await tokenFor(id)}`)

    expect(response.headers.get('cache-control')).toContain('private')
  })
})

describe('the report link handed to the UI', () => {
  it('carries a token that opens exactly that run', async () => {
    const id = await seedRunWithReport({ ref: 'main' })
    await env.REPORTS.put(`runs/${id}/index.html`, 'linked')

    const listed = await as('qa', '/runs?limit=100')
    const { runs } = (await listed.json()) as { runs: RunView[] }
    const mine = runs.find((run) => run.id === id)

    expect(mine?.reportUrl).toBeTruthy()

    // Follow the link the UI would render, rather than minting a fresh token —
    // a link that is generated but never resolvable is the failure this
    // catches.
    const opened = await request(mine!.reportUrl!)
    expect(opened.status).toBe(200)
    expect(await opened.text()).toBe('linked')
  })

  it('leaves reportUrl null while no report exists', async () => {
    const id = await seedRun({ ref: 'main', reportPath: null })

    const listed = await as('qa', '/runs?limit=100')
    const { runs } = (await listed.json()) as { runs: RunView[] }

    expect(runs.find((run) => run.id === id)?.reportUrl).toBeNull()
  })
})
