import { Hono } from 'hono'
import type { HonoEnv, Role } from '../types'
import {
  ROLES,
  requireSession,
  signPreviewRole,
  previewRoleCookie,
  clearPreviewRoleCookie,
} from '../auth'
import { DEV_TOKEN_SECRET } from '../config'
import { POLICIES } from '../policy'

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

  c.header('Set-Cookie', previewRoleCookie(token, maxAge))
  return c.json({ previewing: previewed })
})

demoRoutes.post('/stop-preview', (c) => {
  c.header('Set-Cookie', clearPreviewRoleCookie())
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
  demo: 'only the runs it started itself',
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
    roles: ROLES.map((role) => ({
      role,
      ...POLICIES[role],
      sees: SEES[role],
    })),
  }),
)
