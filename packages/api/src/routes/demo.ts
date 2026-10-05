import { Hono } from 'hono'
import type { HonoEnv, Role } from '../types'
import {
  ROLES,
  requireSession,
  signPreviewRole,
  previewRoleCookie,
  clearPreviewRoleCookie,
  isHttps,
} from '../auth'
import { DEV_TOKEN_SECRET } from '../config'
import { POLICIES } from '../policy'
import { simulates } from '../github'
import { issueSandboxKey } from '../sandbox'

export const demoRoutes = new Hono<HonoEnv>()

/**
 * Previewing another role's read views, for a genuinely authenticated `demo`
 * session.
 *
 * This used to be `/switch-role`: any caller, authenticated or not, could ask
 * for a session token for any role — including `admin` — gated only by
 * `SIMULATE_DISPATCH`, a deployment-wide flag. That made it unusable on a real
 * deployment (the flag is off there, so it 403s for everyone) and, had the
 * flag ever been misconfigured, a free admin token for anyone who asked.
 *
 * This version mints no session token at all. It requires a real, verified
 * `demo` session (`requireSession` below, plus the `role === 'demo'` check in
 * the handler), and on success sets a *separate* cookie naming a role to
 * preview. That cookie is never passed to `verifyToken`, never changes
 * `c.get('role')`, and is consulted only by the read paths in routes/runs.ts —
 * `POST /runs`, `DELETE /runs/:id`, and dispatchWorkflow all keep reading the
 * real, authenticated role directly, untouched by anything here. See
 * decision 12 in docs/decisions.md for why that boundary matters, and the new
 * entry there for why this is a second cookie rather than a second claim on
 * the session token.
 */
demoRoutes.use('*', requireSession)

demoRoutes.post('/preview-role', async (c) => {
  const role = c.get('role')
  if (role !== 'demo') {
    return c.json({ error: 'Only the demo role may preview another role' }, 403)
  }

  const body = (await c.req.json().catch(() => null)) as { role?: string } | null
  const requested = body?.role

  if (!requested || !(ROLES as readonly string[]).includes(requested)) {
    return c.json({ error: `role must be one of: ${ROLES.join(', ')}` }, 422)
  }

  const previewed = requested as Role
  const sessionExpiresAt = c.get('sessionExpiresAt')
  const token = await signPreviewRole(
    c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET,
    previewed,
    sessionExpiresAt,
  )
  const maxAge = sessionExpiresAt - Math.floor(Date.now() / 1000)

  c.header('Set-Cookie', previewRoleCookie(token, maxAge, isHttps(c.req.url)))
  return c.json({ previewing: previewed })
})

/**
 * A key a visitor can mint for themselves, to try the API from a terminal.
 *
 * Only for the demo role, and only a real session: a key cannot mint a key
 * (decision 25), and the other roles have the admin panel. What comes back is
 * the demo role's own key, so it can only ever simulate; see sandbox.ts for the
 * limits that keep it from costing anything. The plaintext is returned once.
 */
demoRoutes.post('/keys', async (c) => {
  if (c.get('role') !== 'demo' || c.get('apiKey')) {
    return c.json({ error: 'Only a demo session may mint a sandbox key' }, 403)
  }

  const issued = await issueSandboxKey(c.env)
  if (!issued.ok) {
    return c.json({ error: issued.error }, 429, { 'Retry-After': String(issued.retryAfter) })
  }

  return c.json({ key: issued.plaintext, expiresAt: issued.expiresAt, limits: issued.limits }, 201)
})

demoRoutes.post('/stop-preview', (c) => {
  c.header('Set-Cookie', clearPreviewRoleCookie(isHttps(c.req.url)))
  return c.json({ ok: true })
})

/**
 * What each role may do — so the UI can explain the difference rather than
 * leaving the reader to infer it from which buttons are greyed out.
 *
 * Served from the same table the API enforces, so the explanation cannot drift
 * from the behaviour.
 */
const SEES: Record<Role, string> = {
  // Every visitor's, not one's own: `triggered_by` holds the role, and every
  // visitor signs in as the same one. It said "only the runs it started
  // itself", and a visitor watching saw runs they had not started.
  demo: 'runs started from the demo sign-in, by any visitor',
  dev: 'runs on main only',
  qa: 'every run, on any branch',
  admin: 'every run, on any branch',
}

demoRoutes.get('/roles', (c) =>
  c.json({
    // A real, authenticated demo session may always preview — this no
    // longer depends on the deployment's SIMULATE_DISPATCH flag, since the
    // preview cookie can never reach a write or dispatch path regardless of
    // that flag's value.
    canPreview: c.get('role') === 'demo',
    // Whether the runs *this* session starts are simulated — the real role's,
    // never a previewed one's. Lets the run form say so before Run is pressed.
    simulates: simulates(c.env, c.get('role')),
    roles: ROLES.map((role) => ({
      role,
      ...POLICIES[role],
      sees: SEES[role],
    })),
  }),
)
