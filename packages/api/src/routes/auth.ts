import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { clearCookie, createToken, requireSession, roleForPassword, sessionCookie } from '../auth'
import { DEV_PASSWORDS, DEV_TOKEN_SECRET } from '../config'

export const authRoutes = new Hono<HonoEnv>()

/**
 * A password per role, plus an optional name.
 *
 * Still no user accounts: the dashboard answers "may this person start a run,
 * and whose runs may they see", and a user table with invitations and password
 * resets would be a large answer to a question nobody is asking.
 *
 * What did change is an assumption. The original note here said the dashboard
 * "does not need to know who they are", and migration 0006 stated it plainly —
 * "there is one human behind each password". Teams share one, so a history of
 * runs all attributed to `qa` answers "who ran this?" no better than the
 * machine case 0006 was written to fix.
 *
 * So the name is asked for and signed into the session, and it is a *claim*
 * rather than an identity: anyone with the password can type anything. That is
 * the honest limit of a shared password, and pretending otherwise by calling
 * it a user would be worse than saying so. It answers "who should I ask about
 * this run" — nothing that anyone would defend in a disagreement.
 */
authRoutes.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    password?: string
    name?: string
  } | null
  if (!body?.password) return c.json({ error: 'Password is required' }, 422)

  const role = await roleForPassword(c.env, body.password)

  // No distinction between "wrong password" and "no such role" — there is
  // nothing to enumerate.
  if (!role) return c.json({ error: 'Wrong password' }, 401)

  // Optional on purpose: a blank name is a valid sign-in, and refusing one
  // would turn a label into a gate. `demo` never gets one — it is a published
  // password anyone may use, so a name there would be noise at best.
  const name = role === 'demo' ? undefined : body.name

  const session = await createToken(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, role, name)
  const maxAge = session.expiresAt - Math.floor(Date.now() / 1000)

  c.header('Set-Cookie', sessionCookie(session.token, maxAge))
  return c.json({ role: session.role, expiresAt: session.expiresAt, name: session.name })
})

authRoutes.post('/logout', (c) => {
  c.header('Set-Cookie', clearCookie())
  return c.json({ ok: true })
})

/** Who am I — lets the UI restore a session without a second login. */
authRoutes.get('/me', requireSession, (c) =>
  c.json({ role: c.get('role'), name: c.get('sessionName') }),
)

/**
 * The credentials the login screen may show.
 *
 * `mode` is why this is not a single `passwords` object with sometimes-fewer
 * keys: the UI needs to say something different depending on which case it
 * is in, and guessing that from which keys happened to arrive is exactly the
 * kind of inference that breaks quietly when a role is renamed.
 *
 * `'full'` — simulating. Every password is safe to print; nothing here can
 * reach a real system.
 *
 * `'demo-only'` — not simulating, so at least one of dev/qa/admin dispatches
 * for real. Those three stay hidden; a reader is told them out of band, the
 * way any real deployment's credentials are shared. `demo`'s password is
 * still printed — its safety was never secrecy, see decision 12, so hiding
 * it here would gate a link that is meant to be handed out and gain nothing:
 * the role it unlocks still cannot dispatch anything real.
 */
authRoutes.get('/dev-credentials', (c) => {
  if (c.env.SIMULATE_DISPATCH === 'false') {
    return c.json({ mode: 'demo-only' as const, passwords: { demo: DEV_PASSWORDS.demo } })
  }
  return c.json({ mode: 'full' as const, passwords: DEV_PASSWORDS })
})
