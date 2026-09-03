import type { Context, Next } from 'hono'
import type { HonoEnv, Role } from './types'
import { hmacHex, verifyHmac } from './crypto'
import { DEV_PASSWORDS, DEV_TOKEN_SECRET } from './config'

/**
 * Session tokens and the role they carry.
 *
 * Format: `<exp>.<role>.<hmac(exp.role)>`. Deliberately not a JWT — there is
 * one issuer and one consumer, the payload is two fields, and a library would
 * be more surface than the twenty lines it replaces. Signed, not encrypted:
 * the role is not a secret, and tampering is what needs preventing.
 *
 * Eight hours: long enough to cover a working day without a mid-afternoon
 * re-login, short enough that a token left on a shared machine expires the
 * same day.
 */

const TOKEN_TTL_SECONDS = 8 * 60 * 60

export const ROLES = ['demo', 'dev', 'qa', 'admin'] as const

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value)

export interface Session {
  role: Role
  expiresAt: number
}

export async function createToken(
  secret: string,
  role: Role,
): Promise<Session & { token: string }> {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  const payload = `${expiresAt}.${role}`
  return { token: `${payload}.${await hmacHex(secret, payload)}`, role, expiresAt }
}

/** Returns the role a token carries, or null if it is invalid or expired. */
export async function verifyToken(secret: string, token: string): Promise<Role | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [expRaw, roleRaw, signature] = parts as [string, string, string]

  // Signature is checked before anything is trusted, including the expiry —
  // otherwise an attacker picks their own expiry and only the signature stops
  // them, which is the same thing but harder to reason about.
  if (!(await verifyHmac(secret, `${expRaw}.${roleRaw}`, signature))) return null

  const exp = Number.parseInt(expRaw, 10)
  if (Number.isNaN(exp) || Date.now() / 1000 > exp) return null
  if (!isRole(roleRaw)) return null

  return roleRaw
}

/** Which password maps to which role. */
export async function roleForPassword(
  env: HonoEnv['Bindings'],
  password: string,
): Promise<Role | null> {
  const configured: Record<Role, string | undefined> = {
    demo: env.DEMO_PASSWORD ?? DEV_PASSWORDS.demo,
    dev: env.DEV_PASSWORD ?? DEV_PASSWORDS.dev,
    qa: env.QA_PASSWORD ?? DEV_PASSWORDS.qa,
    admin: env.ADMIN_PASSWORD ?? DEV_PASSWORDS.admin,
  }

  // Every candidate is compared even after a match, so the time taken does not
  // reveal which role was hit — or whether any was.
  let matched: Role | null = null
  for (const role of ROLES) {
    const expected = configured[role]
    if (expected && (await constantTimeEquals(password, expected))) matched = role
  }
  return matched
}

async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  // Comparing HMACs of the inputs rather than the inputs themselves: equal
  // length is then guaranteed, so the comparison cannot leak length, and the
  // key is per-process so the digests are not useful elsewhere.
  const key = crypto.randomUUID()
  return (await hmacHex(key, a)) === (await hmacHex(key, b))
}

// ── Middleware ──────────────────────────────────────────────────────────────

declare module 'hono' {
  interface ContextVariableMap {
    role: Role
    /**
     * The current session's expiry, in epoch seconds. Set alongside `role` by
     * `requireSession` — exists so a preview-role cookie can be bound to it
     * (see signPreviewRole/verifyPreviewRole below).
     */
    sessionExpiresAt: number
    /** Set by the config check in index.ts; empty when the deployment is sound. */
    configProblems: string[]
  }
}

const COOKIE_NAME = 'session'

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [cookieName, ...rest] = part.trim().split('=')
    if (cookieName === name) return rest.join('=')
  }
  return null
}

export const readSessionCookie = (header: string | undefined) => readCookie(header, COOKIE_NAME)

export const sessionCookie = (token: string, maxAgeSeconds: number) =>
  // SameSite=Lax rather than Strict: the report opens in a new tab from a link,
  // and Strict would drop the cookie on that navigation.
  `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`

export const clearCookie = () => `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`

// ── Preview role ────────────────────────────────────────────────────────────

/**
 * Lets an authenticated `demo` session look at what another role's read views
 * show, without ever minting a session token for that role.
 *
 * Deliberately not `createToken` for the previewed role: that would produce a
 * cookie cryptographically indistinguishable from a real login for that role,
 * and every write path (`POST /runs`, `DELETE /runs/:id`, `dispatchWorkflow`)
 * trusts `role` completely — see decision 12. This cookie is a second,
 * narrower thing: it is only ever consulted by the two GET handlers in
 * routes/runs.ts, never by anything that writes or dispatches.
 *
 * The HMAC covers the previewed role plus the *underlying session's* expiry,
 * not a new expiry of its own — so the preview cookie cannot outlive the real
 * session it rides on, and is meaningless without a valid `demo` session
 * cookie also present alongside it.
 */
const PREVIEW_COOKIE_NAME = 'preview-role'

export async function signPreviewRole(
  secret: string,
  role: Role,
  sessionExpiresAt: number,
): Promise<string> {
  const payload = `${role}.${sessionExpiresAt}`
  return `${payload}.${await hmacHex(secret, payload)}`
}

/**
 * Returns the previewed role, or null if the cookie is missing, malformed, or
 * signed against a different session expiry than the one currently in force —
 * which is what makes it worthless once the real session it rode on expires.
 */
export async function verifyPreviewRole(
  secret: string,
  cookieHeader: string | undefined,
  sessionExpiresAt: number,
): Promise<Role | null> {
  const token = readCookie(cookieHeader, PREVIEW_COOKIE_NAME)
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [roleRaw, expRaw, signature] = parts as [string, string, string]
  if (Number.parseInt(expRaw, 10) !== sessionExpiresAt) return null
  if (!(await verifyHmac(secret, `${roleRaw}.${expRaw}`, signature))) return null
  if (!isRole(roleRaw)) return null

  return roleRaw
}

export const previewRoleCookie = (token: string, maxAgeSeconds: number) =>
  `${PREVIEW_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`

export const clearPreviewRoleCookie = () =>
  `${PREVIEW_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`

/** Rejects anything without a valid session, and records the role. */
export async function requireSession(c: Context<HonoEnv>, next: Next) {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer /, '')
  const token = bearer ?? readSessionCookie(c.req.header('Cookie'))

  if (!token) return c.json({ error: 'Sign in first' }, 401)

  const role = await verifyToken(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, token)
  if (!role) return c.json({ error: 'Session is invalid or expired' }, 401)

  // verifyToken has already checked the signature and expiry by this point, so
  // re-reading exp off the same token here is just extracting a field from
  // something already trusted, not a second trust decision.
  const [expRaw] = token.split('.')
  c.set('role', role)
  c.set('sessionExpiresAt', Number.parseInt(expRaw ?? '', 10))
  await next()
  return undefined
}

/** Role gate. Runs after `requireSession`. */
export const requireRole =
  (...allowed: Role[]) =>
  async (c: Context<HonoEnv>, next: Next) => {
    const role = c.get('role')
    if (!allowed.includes(role)) {
      return c.json({ error: `Role '${role}' may not do this` }, 403)
    }
    await next()
    return undefined
  }
