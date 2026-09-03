import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { verifyReportToken, reportTokenExpiry } from '../crypto'
import { DEV_TOKEN_SECRET } from '../config'

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
 * A real report is not one file. Allure's `index.html` pulls a megabyte of JS,
 * CSS and fonts by *relative* path, and a browser does not carry the opening
 * link's query string onto those requests — so every one of them arrived with
 * no token and 401'd, leaving a report that renders as a spinner forever.
 * Serving the entry point therefore also sets a cookie scoped to
 * `/reports/{runId}/`, and that cookie is accepted in the token's place. The
 * scope is the safety: the browser sends it only back to this run's own
 * prefix, so it opens exactly what the token that minted it already opened.
 */
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
  const row = await c.env.DB.prepare(`SELECT report_path FROM runs WHERE id = ?1`)
    .bind(runId)
    .first<{ report_path: string | null }>()

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
      `${cookieName}=${token}; HttpOnly; Path=/reports/${runId}/; SameSite=Lax; Max-Age=${remaining}`,
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

  return new Response(object.body, { headers })
})
