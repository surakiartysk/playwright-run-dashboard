import { Hono, type Context } from 'hono'
import type { HonoEnv } from '../types'
import {
  adminCookie,
  clearAdminCookie,
  clearCookie,
  createAdminToken,
  createToken,
  isHttps,
  readSessionCookie,
  requireSession,
  sessionCookie,
  verifyToken,
} from '../auth'
import { DEV_TOKEN_SECRET } from '../config'
import { LOGIN_WINDOW_MINUTES, chargeAttempt, refundAttempt } from '../loginLimit'
import {
  OUTSIDER_EMAIL,
  SEED_MEMBERS,
  VISITOR_EMAIL,
  adminKeyFor,
  liveSandbox,
  makeSandbox,
  type SandboxRow,
} from '../sandboxes'
import { listMembers, listedRole, normalizeEmail } from '../members'
import { record } from '../audit'
import { constantTimeEquals } from '../crypto'

export const authRoutes = new Hono<HonoEnv>()

/**
 * Signing in, without a password (decision 52).
 *
 * Two ways in, and both are the demo. "Log in to demo" makes a sandbox and
 * signs in as its visitor account. "Sign in with Google" is a concept: it is
 * not connected to Google. It shows the account chooser a real deployment
 * would put in front of a company's Google Workspace, lists the sandbox's
 * accounts plus one that is on no list, and applies the real whitelist check to
 * whichever is picked — so the one thing worth showing, that an account outside
 * the list is refused, happens rather than being described.
 */

/** The sandbox a request's session cookie points at, if it is still alive. */
async function currentSandbox(c: Context<HonoEnv>): Promise<SandboxRow | null> {
  const token = readSessionCookie(c.req.header('Cookie'))
  if (!token) return null
  const session = await verifyToken(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, token)
  if (!session) return null
  return liveSandbox(c.env.DB, session.sandboxId)
}

async function signIn(c: Context<HonoEnv>, sandbox: SandboxRow, email: string) {
  const secure = isHttps(c.req.url)
  const session = await createToken(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, sandbox, email)
  const maxAge = session.expiresAt - Math.floor(Date.now() / 1000)
  c.header('Set-Cookie', sessionCookie(session.token, maxAge, secure))
  // A new account in the same browser starts without the last one's admin hour.
  c.header('Set-Cookie', clearAdminCookie(secure), { append: true })
  await record(c.env.DB, sandbox.id, email, 'sign-in')
  return c.json({ email, sandbox: { expiresAt: sandbox.expires_at } })
}

/** A new sandbox, signed in as its visitor account. */
authRoutes.post('/demo', async (c) => {
  const made = await makeSandbox(c.env)
  if (!made.ok) {
    return c.json({ error: made.error }, 429, { 'Retry-After': String(made.retryAfter) })
  }
  return signIn(c, made.sandbox, VISITOR_EMAIL)
})

/**
 * The concept chooser's accounts: the sandbox's members when there is one, the
 * accounts a new sandbox would start with when there is not, and the outsider
 * either way.
 */
authRoutes.get('/accounts', async (c) => {
  const sandbox = await currentSandbox(c)
  const members = sandbox
    ? (await listMembers(c.env.DB, sandbox.id)).map(({ email, role }) => ({ email, role }))
    : SEED_MEMBERS.map(({ email, role }) => ({ email, role }))
  return c.json({ accounts: [...members, { email: OUTSIDER_EMAIL, role: null }] })
})

/**
 * Pick an account in the concept chooser.
 *
 * Within the visitor's sandbox when they have one, so switching account keeps
 * what they made; otherwise a new sandbox. An account that is not on the list
 * is refused — and when there is no sandbox yet, refused before one is made,
 * so a refusal does not spend a sandbox nobody can sign in to.
 */
authRoutes.post('/account', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null
  const email = normalizeEmail(body?.email)
  if (!email) return c.json({ error: 'email must be one plain address' }, 422)

  const existing = await currentSandbox(c)
  if (!existing) {
    if (!SEED_MEMBERS.some((member) => member.email === email)) {
      return c.json({ error: `${email} is not on this sandbox's list` }, 403)
    }
    const made = await makeSandbox(c.env)
    if (!made.ok) {
      return c.json({ error: made.error }, 429, { 'Retry-After': String(made.retryAfter) })
    }
    return signIn(c, made.sandbox, email)
  }

  if (!(await listedRole(c.env.DB, existing.id, email))) {
    await record(c.env.DB, existing.id, email, 'sign-in-refused', 'not on the list')
    return c.json({ error: `${email} is not on this sandbox's list` }, 403)
  }
  return signIn(c, existing, email)
})

authRoutes.post('/logout', (c) => {
  const secure = isHttps(c.req.url)
  c.header('Set-Cookie', clearCookie(secure))
  c.header('Set-Cookie', clearAdminCookie(secure), { append: true })
  return c.json({ ok: true })
})

/** Who am I — lets the UI restore a session without signing in again. */
authRoutes.get('/me', requireSession, async (c) => {
  const sandbox = await liveSandbox(c.env.DB, c.get('sandboxId'))
  return c.json({
    email: c.get('email') ?? null,
    role: c.get('role'),
    listedRole: c.get('listedRole') ?? null,
    adminUntil: c.get('adminUntil') ?? null,
    sandbox: { expiresAt: sandbox?.expires_at ?? null, lockdown: c.get('lockdown') },
  })
})

// ── Admin key ─────────────────────────────────────────────────────────────

/**
 * The sandbox's admin key, shown on the admin page (decision 52).
 *
 * Only to an account listed as admin, and only to a person: a key may not read
 * it. On a real deployment the key is a secret nobody can ask the server for;
 * here the page hands it over, because a demo whose admin cannot be reached
 * shows nothing. What is real is the check in `POST /auth/admin`.
 */
authRoutes.get('/admin-key', requireSession, async (c) => {
  if (c.get('apiKey') || c.get('listedRole') !== 'admin') {
    return c.json({ error: 'Only an account listed as admin is shown the admin key' }, 403)
  }
  return c.json({ key: await adminKeyFor(c.env, c.get('sandboxId')), demo: true })
})

/**
 * Unlock admin: the account must be listed as admin, and the key must match.
 *
 * Ten tries in fifteen minutes per account, counted before the key is compared
 * so parallel guesses each see their own place in the queue (decision 28).
 */
authRoutes.post('/admin', requireSession, async (c) => {
  const email = c.get('email')
  const sandboxId = c.get('sandboxId')
  if (c.get('apiKey') || !email) {
    return c.json({ error: 'Keys may not unlock admin — sign in to do that' }, 403)
  }
  if (c.get('listedRole') !== 'admin') {
    await record(c.env.DB, sandboxId, email, 'admin-key-refused', 'not listed as admin')
    return c.json({ error: `${email} is not listed as admin in this sandbox` }, 403)
  }
  const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null
  if (typeof body?.key !== 'string' || body.key.length === 0 || body.key.length > 256) {
    return c.json({ error: 'key is required' }, 422)
  }

  const bucket = `admin:${sandboxId}:${email}`
  if (!(await chargeAttempt(c.env.DB, bucket))) {
    return c.json(
      { error: `Too many wrong keys. Try again within ${LOGIN_WINDOW_MINUTES} minutes.` },
      429,
    )
  }
  if (!(await constantTimeEquals(body.key, await adminKeyFor(c.env, sandboxId)))) {
    await record(c.env.DB, sandboxId, email, 'admin-key-refused', 'wrong key')
    return c.json({ error: 'Wrong admin key' }, 401)
  }
  await refundAttempt(c.env.DB, bucket)

  const admin = await createAdminToken(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, sandboxId, email)
  const maxAge = admin.expiresAt - Math.floor(Date.now() / 1000)
  c.header('Set-Cookie', adminCookie(admin.token, maxAge, isHttps(c.req.url)))
  await record(c.env.DB, sandboxId, email, 'admin-unlocked')
  return c.json({ role: 'admin', adminUntil: admin.expiresAt })
})

/** Give up the admin hour early. */
authRoutes.delete('/admin', (c) => {
  c.header('Set-Cookie', clearAdminCookie(isHttps(c.req.url)))
  return c.json({ ok: true })
})
