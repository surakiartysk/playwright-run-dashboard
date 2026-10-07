import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings, HonoEnv } from './types'
import { assertDeployable } from './config'
import { authRoutes } from './routes/auth'
import { demoRoutes } from './routes/demo'
import { runRoutes } from './routes/runs'
import { webhookRoutes } from './routes/webhook'
import { reportRoutes } from './routes/reports'
import { gateRoutes } from './routes/gate'
import { keyRoutes } from './routes/keys'
import { optionsRoutes } from './routes/options'
import { sweepStaleRuns } from './stale'
import { pruneReports } from './retention'
import { pruneSandbox } from './sandbox'
import pkg from '../package.json'

/**
 * This deployment's version — how far along the dashboard itself is.
 *
 * Read from package.json rather than repeated here, because a version written
 * in two places is a version that disagrees with itself. Distinct from the
 * `suite_version` on a run row: that says which test suite produced a result,
 * this says which dashboard is serving it.
 *
 * On /health so it is answerable without a session — the question "which
 * version is deployed?" is usually asked by someone who cannot sign in, or by
 * something that never could.
 */
const VERSION = pkg.version

/**
 * The dashboard API.
 *
 * The main surfaces, each with a different caller:
 *
 *   POST /auth/login  signing in — a password maps to a role
 *   POST /runs        a developer asking for a run     (session + policy)
 *   GET  /runs        the dashboard polling for status (scoped by role)
 *   POST /webhook     the workflow reporting a result   (HMAC-signed)
 *   GET  /reports     a browser opening a report        (token-scoped)
 *
 * They authenticate differently because they are trusted differently — the
 * webhook is the only one that can change a result, so it is the only one that
 * is signed.
 */
const app = new Hono<HonoEnv>()

/**
 * Everything this origin serves, except a report, opens in a browsing-context
 * group of its own.
 *
 * Reports are served from this origin (routes/reports.ts), so a script inside
 * one is a same-origin script. Its CSP stops it fetching the API; it does not
 * stop `window.open('/runs')` followed by reading the new window's document,
 * which the browser allows between same-origin windows — tried against a real
 * Allure report, and it read the response with the viewer's cookie. With
 * `same-origin` here and nothing on the report, the two land in different
 * groups and the handle the report gets back cannot see into the window.
 *
 * Reports are left out on purpose, not by oversight: a report carrying the
 * same value would share a group with the API again, and the read works — also
 * tried. The UI's pages need the same header, and get it from
 * `packages/ui/public/_headers`, because Pages serves them rather than this
 * Worker. Decision 40.
 */
app.use('*', async (c, next) => {
  await next()
  if (!c.req.path.startsWith('/reports/')) {
    c.res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  }
})

let configLogged = false

app.use('*', async (c, next) => {
  // Evaluated per request, logged once.
  //
  // The verdict is cheap — five property reads — so caching it buys nothing
  // and costs correctness: an isolate that cached one env's answer would apply
  // it to every later request, which is wrong the moment two environments
  // share a process. That is only visible in tests today, and a cache that is
  // only correct in production is a cache waiting to mislead someone.
  const problems = assertDeployable(c.env)

  if (!configLogged && problems.length > 0) {
    configLogged = true
    for (const problem of problems) {
      console.error(`[config] ${problem}`)
    }
  }

  c.set('configProblems', problems)

  /**
   * A misconfigured deployment refuses to serve, rather than logging and
   * carrying on.
   *
   * This used to only write to `console.error`. On a Worker that goes to a log
   * nobody is watching, so a deploy missing `TOKEN_SECRET` would run happily
   * and sign every report link with `dev-token-secret-not-for-deployment` — a
   * value published in this repo, which means anyone could forge a link to any
   * run's report. The function was named `assert*` and asserted nothing.
   *
   * `/health` stays open on purpose: a load balancer needs an answer, and
   * "misconfigured" is exactly what it should be told.
   */
  if (problems.length > 0 && c.req.path !== '/health') {
    return c.json(
      { error: 'This deployment is misconfigured and is refusing to serve.', problems },
      503,
    )
  }

  await next()
  return undefined
})

// credentials:true for a UI served from Vite's port talking to the Worker on
// 8787 directly. `pnpm dev` proxies through Vite and is same-origin, as
// production is; this keeps a direct call from the dev UI working too.
const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']
app.use('/auth/*', cors({ origin: devOrigins, credentials: true }))
app.use('/demo/*', cors({ origin: devOrigins, credentials: true }))
app.use('/runs', cors({ origin: devOrigins, credentials: true }))
app.use('/runs/*', cors({ origin: devOrigins, credentials: true }))
app.use('/gate', cors({ origin: devOrigins, credentials: true }))

/**
 * Health, which stays reachable even when the deployment is refusing to serve.
 *
 * It reports the refusal rather than a bare "ok", so whoever is looking at a
 * failing deploy sees the reason here instead of having to find the log.
 */
app.get('/health', (c) => {
  const problems = c.get('configProblems')
  return problems.length > 0
    ? c.json({ status: 'misconfigured', problems, version: VERSION }, 503)
    : c.json({ status: 'ok', version: VERSION })
})

app.route('/auth', authRoutes)
// Read-only role preview for an authenticated `demo` session — see routes/demo.ts.
app.route('/demo', demoRoutes)
// Mounted before `/runs` and under it: Worker routes on the production hostname
// are configured in the Cloudflare dashboard, so a new top-level path would be
// answered by the SPA until someone added it there. `/runs/*` is already routed,
// and this must come first or `/runs/:id` reads "options" as a run id.
app.route('/runs/options', optionsRoutes)
app.route('/runs', runRoutes)
app.route('/gate', gateRoutes)
// Admin-only throughout — see routes/keys.ts.
app.route('/keys', keyRoutes)
app.route('/webhook', webhookRoutes)
app.route('/reports', reportRoutes)

app.notFound((c) => c.json({ error: 'No such endpoint' }, 404))

app.onError((err, c) => {
  console.error('[api] unhandled:', err)
  return c.json({ error: 'Internal error' }, 500)
})

/**
 * The Worker has two entry points: requests (everything above) and a schedule.
 *
 * The schedule is `[triggers] crons` in wrangler.toml, and what it does is
 * `sweepStaleRuns` — see stale.ts for why a run can be left unfinished and why
 * something has to end it. `waitUntil` so the sweep is allowed to finish after
 * the handler returns.
 */
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        sweepStaleRuns(env.DB).then((marked) => {
          if (marked > 0) console.log(`[stale] marked ${marked} unfinished run(s) as timeout`)
        }),
        pruneSandbox(env.DB).then(({ keys, runs }) => {
          if (keys + runs > 0)
            console.log(`[prune] removed ${keys} sandbox key(s), ${runs} old demo run(s)`)
        }),
        pruneReports(env.DB, env.REPORTS).then((removed) => {
          if (removed > 0) console.log(`[retention] removed the report of ${removed} old run(s)`)
        }),
      ]),
    )
  },
}
