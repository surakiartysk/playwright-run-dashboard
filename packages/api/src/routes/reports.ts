import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { verifyReportToken, reportTokenExpiry } from '../crypto'
import { DEV_TOKEN_SECRET } from '../config'
import { cookie, isHttps } from '../auth'

export const reportRoutes = new Hono<HonoEnv>()

/**
 * GET /reports/:runId/* — serves a report out of R2 behind a signed token.
 *
 * The bucket is never public. A report can name environments, payloads and
 * failure detail, so the link is scoped to one run and expires.
 *
 * The token is accepted from the query string as well as a header, because the
 * page's own asset requests cannot carry one — a browser fetching
 * `report.css` sends no Authorization header. Scoping the token to a single
 * run is what makes that acceptable.
 *
 * ## The asset cookie, and why it is still here
 *
 * Reports were multi-file once. Allure's `index.html` pulls a megabyte of JS,
 * CSS and fonts by *relative* path, and a browser does not carry the opening
 * link's query string onto those requests — so every one of them arrived with
 * no token and 401'd, leaving a report that rendered as a spinner forever.
 * Serving the entry point therefore also sets a cookie scoped to
 * `/reports/{runId}/`, and that cookie is accepted in the token's place. The
 * scope is the safety: the browser sends it only back to this run's own
 * prefix, so it opens exactly what the token that minted it already opened.
 *
 * **No report this system stores today needs it.** Both suites build Allure
 * with `--single-file` and upload one object per run, and the shared demo
 * report is the same — so in practice nothing ever asks for a second file, and
 * the cookie is set for a page that will not use it.
 *
 * Kept rather than deleted, because the thing that makes it unnecessary is a
 * flag in repositories this one cannot see (`SINGLE_FILE` in the suites'
 * `scripts/allure-report.mjs`). Removing this would make serving reports
 * correct only while that flag stays as it is, and the failure would be a
 * report that renders empty — which reads as a run that produced nothing
 * rather than as a dashboard that broke.
 *
 * It is no longer enough on its own. `REPORT_CSP` below admits nothing from
 * `'self'`, so a multi-file report's assets are refused by the browser even
 * with the cookie in place; a suite moving back would need the policy widened
 * as well, and the comment on it says what that would cost.
 *
 * `integration-contract.test.ts` pins the single-file shape as the fourth
 * point the repositories meet at, so a suite moving to multi-file has to
 * change a test on purpose rather than quietly land a blank page here.
 */
/**
 * What a report may load and reach: nothing off its own page.
 *
 * A report is served from the dashboard's own origin, so its scripts run with
 * the viewer's session — and a report is a third party's program. Allure 3
 * writes a Google Analytics tag into every report it builds, with no option to
 * leave it out (`analyticsEnable: true` in its generator), so before this
 * every report opened here loaded a script from Google on to the dashboard's
 * origin and handed it a URL carrying the report's token.
 *
 * Every source below is the page itself — inline, `data:` or `blob:` — because
 * a `--single-file` report is exactly that, and each was checked by opening a
 * real Allure 3.20 report under this policy in Chromium: the list, a failed
 * test, a JSON, HTML, PNG and WebM attachment all render; the analytics tag and
 * a `fetch('/runs')` from the page are both refused. `media-src` is there
 * because the first attempt without it blocked the video.
 *
 * What it does not do is isolate. `'unsafe-inline'` is the price of a
 * single-file report, so a script that got into one would still run — and a
 * script on this origin can open the API in a new window and read it. That is
 * closed separately, by `Cross-Origin-Opener-Policy` on everything else the
 * origin serves (index.ts), and only for the ways in that are known. Decision
 * 40 has the reasoning and what full isolation would take.
 *
 * A multi-file report would load from `'self'` and is refused here. Nothing
 * stores one today (`integration-contract.test.ts` pins the single-file shape);
 * a suite that moved back would need this widened on purpose, and `connect-src
 * 'self'` is the line that would hand a report the API again.
 */
export const REPORT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' data:",
  "style-src 'unsafe-inline' data:",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  'connect-src data: blob:',
  'frame-src data: blob:',
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const assetCookieName = (runId: string) => `report_${runId.replace(/[^a-zA-Z0-9]/g, '_')}`

reportRoutes.get('/:runId/*', async (c) => {
  const runId = c.req.param('runId')
  const cookieName = assetCookieName(runId)
  const fromCookie = (c.req.header('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)

  const token =
    c.req.header('Authorization')?.replace(/^Bearer /, '') ??
    c.req.query('token') ??
    fromCookie ??
    ''

  if (!token) return c.json({ error: 'A report token is required' }, 401)

  const secret = c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET
  const tokenRunId = await verifyReportToken(secret, token)

  if (!tokenRunId) return c.json({ error: 'Token is invalid or expired' }, 401)

  // A token for run A must not open run B.
  if (tokenRunId !== runId) return c.json({ error: 'Token is for a different run' }, 403)

  const url = new URL(c.req.url)
  const prefix = `/reports/${runId}/`
  const relative = url.pathname.slice(prefix.length) || 'index.html'
  const path = relative.endsWith('/') ? `${relative}index.html` : relative

  /**
   * Which prefix holds this run's report is read from the row, not guessed.
   *
   * Simulated runs share one stored Allure report: writing a copy per run
   * would store several megabytes of duplicate every time. So
   * `simulate.ts` records the shared prefix in `report_path` and real runs
   * record their own — the row says which, and a real run whose upload never
   * arrived still 404s rather than quietly serving someone else's results.
   */
  const row = await c.env.DB.prepare(
    `SELECT report_path, report_removed_at FROM runs WHERE id = ?1`,
  )
    .bind(runId)
    .first<{ report_path: string | null; report_removed_at: string | null }>()

  // 410 and not 404: the report existed and was taken away on purpose, which is
  // a different thing from a run that never had one, and a person holding an old
  // link should be told which.
  if (row?.report_removed_at) {
    return c.json(
      {
        error: `This run's report was removed on ${row.report_removed_at.slice(0, 10)} to keep storage bounded. The run's result is still recorded.`,
      },
      410,
    )
  }
  if (!row?.report_path) return c.json({ error: 'That run has no report' }, 404)

  // `report_path` names the report's entry point; its directory is the prefix
  // every asset under it is served from.
  const base = row.report_path.replace(/\/[^/]*$/, '')
  const object = await c.env.REPORTS.get(`${base}/${path}`)

  if (!object) return c.json({ error: `No report at ${path}` }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  const isEntryPoint = path === 'index.html'

  /**
   * Hand the page a cookie so its own assets resolve.
   *
   * Only on the entry point, and only past the token checks above — this
   * converts a token the browser will not replay onto relative URLs into one
   * it will, without widening what may be opened. `Path` pins it to this run's
   * report, so it is never sent to another run or to the API, and it expires
   * with the token rather than outliving it.
   *
   * Set on every entry-point load, including one that already carries the
   * cookie: a reload is how a visitor recovers from an expired or cleared
   * cookie, and skipping it there would leave them on a page whose assets
   * fail with no way back.
   */
  if (isEntryPoint) {
    const expiry = (await reportTokenExpiry(secret, token)) ?? 0
    const remaining = Math.max(0, expiry - Math.floor(Date.now() / 1000))
    headers.append(
      'Set-Cookie',
      cookie(cookieName, token, {
        path: `/reports/${runId}/`,
        maxAge: remaining,
        secure: isHttps(c.req.url),
      }),
    )
  }

  /**
   * The entry point is never cached; assets are, privately.
   *
   * A cacheable entry point is a response the edge may replay to the next
   * visitor — without running this handler, and so without the `Set-Cookie`
   * above. That is exactly what happened on the deployment: the page loaded
   * from cache with no cookie, and every asset it asked for 401'd. Assets
   * themselves stay cacheable: they are immutable, and a run id is never
   * reused.
   */
  headers.set('cache-control', isEntryPoint ? 'private, no-store' : 'private, max-age=3600')

  headers.set('content-security-policy', REPORT_CSP)
  // The token rides in this page's URL, so the page names no one where it came from.
  headers.set('referrer-policy', 'no-referrer')

  return new Response(object.body, { headers })
})
