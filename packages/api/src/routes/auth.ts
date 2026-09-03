import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { clearCookie, createToken, requireSession, roleForPassword, sessionCookie } from '../auth'
import { DEV_PASSWORDS, DEV_TOKEN_SECRET } from '../config'

export const authRoutes = new Hono<HonoEnv>()

/**
 * A password per role rather than user accounts.
 *
 * The dashboard answers "may this person start a run, and whose runs may they
 * see" — it does not need to know who they are. Adding user records would mean
 * a user table, invitations and password resets to answer a question nobody is
 * asking. When that changes, this is the seam to replace.
 */
authRoutes.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { password?: string } | null
  if (!body?.password) return c.json({ error: 'Password is required' }, 422)

  const role = await roleForPassword(c.env, body.password)

  // No distinction between "wrong password" and "no such role" — there is
  // nothing to enumerate.
  if (!role) return c.json({ error: 'Wrong password' }, 401)

  const session = await createToken(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, role)
  const maxAge = session.expiresAt - Math.floor(Date.now() / 1000)

  c.header('Set-Cookie', sessionCookie(session.token, maxAge))
  return c.json({ role: session.role, expiresAt: session.expiresAt })
})

authRoutes.post('/logout', (c) => {
  c.header('Set-Cookie', clearCookie())
  return c.json({ ok: true })
})

/** Who am I — lets the UI restore a session without a second login. */
authRoutes.get('/me', requireSession, (c) => c.json({ role: c.get('role') }))

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
