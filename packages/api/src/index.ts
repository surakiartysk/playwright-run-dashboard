import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { HonoEnv } from './types'
import { assertDeployable } from './config'
import { authRoutes } from './routes/auth'
import { demoRoutes } from './routes/demo'
import { runRoutes } from './routes/runs'
import { webhookRoutes } from './routes/webhook'
import { reportRoutes } from './routes/reports'
import { gateRoutes } from './routes/gate'

/**
 * The dashboard API.
 *
 * Four surfaces, each with a different caller:
 *
 *   POST /auth      signing in — a password maps to a role
 *   POST /runs      a developer asking for a run     (session + policy)
 *   GET  /runs      the dashboard polling for status (scoped by role)
 *   POST /webhook   the workflow reporting a result   (HMAC-signed)
 *   GET  /reports   a browser opening a report        (token-scoped)
 *
 * They authenticate differently because they are trusted differently — the
 * webhook is the only one that can change a result, so it is the only one that
 * is signed.
 */
const app = new Hono<HonoEnv>()

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

// credentials:true so the session cookie survives the cross-origin dev setup
// (Vite on 5173, Worker on 8787). In production both are same-origin.
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
    ? c.json({ status: 'misconfigured', problems }, 503)
    : c.json({ status: 'ok' })
})

app.route('/auth', authRoutes)
// Refuses outside simulation — see routes/demo.ts.
app.route('/demo', demoRoutes)
app.route('/runs', runRoutes)
app.route('/gate', gateRoutes)
app.route('/webhook', webhookRoutes)
app.route('/reports', reportRoutes)

app.notFound((c) => c.json({ error: 'No such endpoint' }, 404))

app.onError((err, c) => {
  console.error('[api] unhandled:', err)
  return c.json({ error: 'Internal error' }, 500)
})

export default app
