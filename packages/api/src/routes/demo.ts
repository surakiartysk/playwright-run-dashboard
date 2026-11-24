import { Hono } from 'hono'
import type { HonoEnv, Role } from '../types'
import { ROLES, requireSession } from '../auth'
import { POLICIES } from '../policy'
import { issueVisitorKey } from '../visitorKeys'
import { liveSandbox } from '../sandboxes'

export const demoRoutes = new Hono<HonoEnv>()

/**
 * A key a member mints for themselves, to try the API from a terminal.
 *
 * Only a person may mint one — a key cannot mint a key (decision 25) — and the
 * key carries the member's own role, never admin: an admin-level key is issued
 * from the admin page, with a label chosen on purpose. See visitorKeys.ts for
 * the limits. The plaintext is returned once.
 */
demoRoutes.post('/keys', requireSession, async (c) => {
  if (c.get('apiKey')) {
    return c.json({ error: 'Keys may not mint keys — sign in to do that' }, 403)
  }
  const role = c.get('role')
  if (role === 'admin') {
    return c.json({ error: 'An admin key is issued from the admin page, with a label' }, 403)
  }
  const sandbox = await liveSandbox(c.env.DB, c.get('sandboxId'))
  if (!sandbox) return c.json({ error: 'This sandbox has expired' }, 401)
  const issued = await issueVisitorKey(c.env, sandbox, role)
  if (!issued.ok) {
    return c.json({ error: issued.error }, 429, { 'Retry-After': String(issued.retryAfter) })
  }
  return c.json({ key: issued.plaintext, expiresAt: issued.expiresAt, limits: issued.limits }, 201)
})

/**
 * What each role may do — so the UI can explain the difference rather than
 * leaving the reader to infer it from which buttons are greyed out.
 *
 * Served from the same table the API enforces, so the explanation cannot drift
 * from the behaviour.
 */
const SEES: Record<Role, string> = {
  dev: 'runs on main only — the CI runs and this sandbox’s',
  qa: 'every run, on any branch — the CI runs and this sandbox’s',
  admin: 'every run, on any branch — the CI runs and this sandbox’s',
}

demoRoutes.get('/roles', requireSession, (c) =>
  c.json({
    role: c.get('role'),
    simulates: true,
    roles: ROLES.map((role) => ({ role, ...POLICIES[role], sees: SEES[role] })),
  }),
)
