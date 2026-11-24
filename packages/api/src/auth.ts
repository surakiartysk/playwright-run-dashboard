import type { Context, Next } from 'hono'
import type { HonoEnv, Role } from './types'
import { hmacHex, verifyHmac } from './crypto'
import { DEV_TOKEN_SECRET } from './config'
import type { RolePolicy } from './policy'
import { effectivePolicy, looksLikeKey, parseKey, verifyKey, type ApiKeyRow } from './apiKeys'
import { liveSandbox, type SandboxRow } from './sandboxes'
import { listedRole, type MemberRole } from './members'

/**
 * Sessions, and the role a request is given (decision 52).
 *
 * There are no passwords. A session says which sandbox it belongs to and which
 * of that sandbox's accounts signed in — nothing about a role. The role is read
 * from the sandbox's member list on every request, so a member removed or
 * changed by an admin is treated as removed or changed on their next click.
 *
 * Format: `<exp>.<sandbox>.<email, base64url>.<hmac>`. Deliberately not a JWT —
 * one issuer, one consumer, three fields. Signed, not encrypted: nothing in it
 * is a secret, and tampering is what needs preventing.
 *
 * A session lasts as long as its sandbox. Shorter, and a visitor signed out
 * after a few hours would sign in to a new, empty sandbox and lose what they
 * had made; longer, and it would outlive what it points at.
 */

export const ROLES = ['dev', 'qa', 'admin'] as const

export interface Session {
  sandboxId: string
  email: string
  expiresAt: number
}

const base64url = (text: string) =>
  btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

function fromBase64url(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    return decodeURIComponent(escape(atob(padded)))
  } catch {
    return null
  }
}

const SANDBOX_RE = /^[0-9a-f]{32}$/

export async function createToken(
  secret: string,
  sandbox: Pick<SandboxRow, 'id' | 'expires_at'>,
  email: string,
): Promise<Session & { token: string }> {
  const expiresAt = Math.floor(Date.parse(sandbox.expires_at) / 1000)
  const payload = `${expiresAt}.${sandbox.id}.${base64url(email)}`
  return {
    token: `${payload}.${await hmacHex(secret, payload)}`,
    sandboxId: sandbox.id,
    email,
    expiresAt,
  }
}

/** The session a token carries, or null if it is invalid or expired. */
export async function verifyToken(secret: string, token: string): Promise<Session | null> {
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [expRaw, sandboxId, encodedEmail, signature] = parts as [string, string, string, string]

  // The signature is checked before anything is trusted, including the expiry.
  if (!(await verifyHmac(secret, `${expRaw}.${sandboxId}.${encodedEmail}`, signature))) {
    return null
  }
  const exp = Number.parseInt(expRaw, 10)
  if (Number.isNaN(exp) || Date.now() / 1000 > exp) return null
  if (!SANDBOX_RE.test(sandboxId)) return null
  const email = fromBase64url(encodedEmail)
  if (!email) return null
  return { sandboxId, email, expiresAt: exp }
}

// ── Admin elevation ────────────────────────────────────────────────────────

/**
 * An hour of admin, for one account in one sandbox, after its admin key.
 *
 * A second cookie rather than a field in the session: the session lasts a day,
 * and admin should not. When this one runs out the person is still signed in,
 * as what the list says, and the admin page asks for the key again.
 *
 * Bound to the sandbox and the email, so it cannot be carried to another
 * account; and it counts only while the email is still listed as admin, so an
 * admin removed from the list loses it on their next request.
 */
export const ADMIN_ELEVATION_SECONDS = 60 * 60

export async function createAdminToken(
  secret: string,
  sandboxId: string,
  email: string,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_ELEVATION_SECONDS
  const payload = `adm.${expiresAt}.${sandboxId}.${base64url(email)}`
  return { token: `${payload}.${await hmacHex(secret, payload)}`, expiresAt }
}

/** The expiry of a valid admin token for this sandbox and email, or null. */
export async function verifyAdminToken(
  secret: string,
  token: string | null,
  sandboxId: string,
  email: string,
): Promise<number | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== 'adm') return null
  const [, expRaw, tokenSandbox, encodedEmail, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]
  if (!(await verifyHmac(secret, `adm.${expRaw}.${tokenSandbox}.${encodedEmail}`, signature))) {
    return null
  }
  const exp = Number.parseInt(expRaw, 10)
  if (Number.isNaN(exp) || Date.now() / 1000 > exp) return null
  if (tokenSandbox !== sandboxId || fromBase64url(encodedEmail) !== email) return null
  return exp
}

// ── Cookies ────────────────────────────────────────────────────────────────

const SESSION_COOKIE = 'session'
const ADMIN_COOKIE = 'admin'

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [cookieName, ...rest] = part.trim().split('=')
    if (cookieName === name) return rest.join('=')
  }
  return null
}

export const readSessionCookie = (header: string | undefined) => readCookie(header, SESSION_COOKIE)
export const readAdminCookie = (header: string | undefined) => readCookie(header, ADMIN_COOKIE)

/** Whether a request reached the Worker over HTTPS — see `cookie` for why it matters. */
export const isHttps = (url: string) => new URL(url).protocol === 'https:'

/**
 * Every cookie this Worker sets, in one shape.
 *
 * `HttpOnly` because no page script has a reason to read any of them.
 * `SameSite=Lax` rather than Strict: the report opens in a new tab from a link,
 * and Strict would drop the cookie on that navigation.
 *
 * `Secure` when the request itself came over HTTPS, and only then. Always
 * setting it would cost local development nothing in Chrome or Firefox, which
 * treat `http://localhost` as secure, and would break it in any browser that
 * does not. Never setting it was the state before: a cookie issued over HTTPS
 * that a browser would then also send over plain HTTP, to anyone on the path.
 * See decision 41.
 */
export function cookie(
  name: string,
  value: string,
  options: { path: string; maxAge: number; secure: boolean },
): string {
  const attributes = [
    'HttpOnly',
    `Path=${options.path}`,
    'SameSite=Lax',
    `Max-Age=${options.maxAge}`,
  ]
  if (options.secure) attributes.push('Secure')
  return [`${name}=${value}`, ...attributes].join('; ')
}

export const sessionCookie = (token: string, maxAgeSeconds: number, secure: boolean) =>
  cookie(SESSION_COOKIE, token, { path: '/', maxAge: maxAgeSeconds, secure })

export const clearCookie = (secure: boolean) =>
  cookie(SESSION_COOKIE, '', { path: '/', maxAge: 0, secure })

export const adminCookie = (token: string, maxAgeSeconds: number, secure: boolean) =>
  cookie(ADMIN_COOKIE, token, { path: '/', maxAge: maxAgeSeconds, secure })

export const clearAdminCookie = (secure: boolean) =>
  cookie(ADMIN_COOKIE, '', { path: '/', maxAge: 0, secure })

// ── Middleware ──────────────────────────────────────────────────────────────

declare module 'hono' {
  interface ContextVariableMap {
    role: Role
    /** The sandbox every query this request makes is scoped to. */
    sandboxId: string
    /** Whether that sandbox is locked down; set so a handler need not read it again. */
    lockdown: boolean
    /** The account that signed in. Undefined for an API key. */
    email?: string
    /** What the member list says, before the admin key is counted. Undefined for a key. */
    listedRole?: MemberRole
    /** When the admin elevation ends, in epoch seconds; undefined when there is none. */
    adminUntil?: number
    /** When the session ends, in epoch seconds. 0 for a key, which has no session. */
    sessionExpiresAt: number
    /** Set by the config check in index.ts; empty when the deployment is sound. */
    configProblems: string[]
    /**
     * The API key this request was made with, when it was made with one.
     * Handlers read it to attribute a run to the key rather than only to its
     * role. See decision 15.
     */
    apiKey?: { id: string; label: string; policy: RolePolicy }
  }
}

export const LAST_USED_GRANULARITY_MS = 60 * 60 * 1000

/** Whether `last_used_at` is old enough to be worth another write. */
export function lastUsedIsStale(lastUsedAt: string | null, now: number = Date.now()): boolean {
  if (lastUsedAt === null) return true
  const at = Date.parse(lastUsedAt)
  // A value that is not a time is as good as none; one from the future (clock
  // skew between Workers) is left alone until it is genuinely an hour old.
  return Number.isNaN(at) || now - at >= LAST_USED_GRANULARITY_MS
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value)

/**
 * Authenticates a request with an API key: the key's row, or null.
 *
 * A key belongs to a sandbox and dies with it. A key without one — issued
 * before sandboxes existed, or carrying the retired `demo` role — is refused,
 * because there is nothing left it could act on.
 *
 * `last_used_at` is written with `waitUntil` rather than awaited, and at most
 * once an hour: written on every request, it made a valid key a way to write to
 * D1 without limit.
 */
async function authenticateKey(
  c: Context<HonoEnv>,
  presented: string,
): Promise<(ApiKeyRow & { role: Role; sandbox_id: string }) | null> {
  const parsed = parseKey(presented)
  if (!parsed) return null
  const row = await c.env.DB.prepare(`SELECT * FROM api_keys WHERE id = ?1`)
    .bind(parsed.id)
    .first<ApiKeyRow>()
  if (!(await verifyKey(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, row, parsed.secret))) {
    return null
  }
  const key = row as ApiKeyRow
  if (!key.sandbox_id || !isRole(key.role)) return null
  if (lastUsedIsStale(key.last_used_at)) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1`)
        .bind(key.id, new Date().toISOString())
        .run(),
    )
  }
  return key as ApiKeyRow & { role: Role; sandbox_id: string }
}

/** The answer a locked-down sandbox gives everyone but its admin. */
const locked = (c: Context<HonoEnv>) =>
  c.json(
    {
      error: 'This sandbox is locked down. Only its admin can use it until lockdown is lifted.',
      locked: true,
    },
    403,
  )

/** Rejects anything without a valid session or key, and resolves the role. */
export async function requireSession(c: Context<HonoEnv>, next: Next) {
  const authorization = c.req.header('Authorization')
  /*
   * A header naming nothing is what a pasted command sends when the variable it
   * reads (`$RUN_KEY`) was never set. Said plainly rather than answered as a
   * login problem for someone who never logged in.
   */
  if (authorization !== undefined && /^(Bearer)?\s*$/i.test(authorization)) {
    return c.json(
      {
        error:
          'The Authorization header carries no key. If the command reads $RUN_KEY, set it first.',
      },
      401,
    )
  }
  const bearer = authorization?.replace(/^Bearer /, '')

  /*
   * A key is checked before a session token, and only when it is shaped like
   * one. A key that fails stops here rather than falling through to session
   * verification, which would answer a revoked key with "Sign in first".
   */
  if (bearer && looksLikeKey(bearer)) {
    const key = await authenticateKey(c, bearer)
    if (!key) return c.json({ error: 'API key is invalid, revoked or expired' }, 401)
    const sandbox = await liveSandbox(c.env.DB, key.sandbox_id)
    if (!sandbox) return c.json({ error: 'API key is invalid, revoked or expired' }, 401)
    if (sandbox.lockdown === 1 && key.role !== 'admin') return locked(c)
    c.set('role', key.role)
    c.set('sandboxId', sandbox.id)
    c.set('lockdown', sandbox.lockdown === 1)
    c.set('sessionExpiresAt', 0)
    c.set('apiKey', { id: key.id, label: key.label, policy: effectivePolicy(key) })
    await next()
    return undefined
  }

  const token = bearer ?? readSessionCookie(c.req.header('Cookie'))
  if (!token) return c.json({ error: 'Sign in first' }, 401)

  const secret = c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET
  const session = await verifyToken(secret, token)
  if (!session) return c.json({ error: 'Session is invalid or expired' }, 401)

  const sandbox = await liveSandbox(c.env.DB, session.sandboxId)
  if (!sandbox) {
    return c.json({ error: 'This sandbox has expired. Sign in again for a new one.' }, 401)
  }

  // Read every time, so a removal or a change of role takes effect at once.
  const listed = await listedRole(c.env.DB, sandbox.id, session.email)
  if (!listed) {
    return c.json({ error: `${session.email} is not a member of this sandbox` }, 403)
  }

  // Listed as admin is half of it. Without the key, the account works as dev.
  let role: Role = listed
  let adminUntil: number | undefined
  if (listed === 'admin') {
    const until = await verifyAdminToken(
      secret,
      readAdminCookie(c.req.header('Cookie')),
      sandbox.id,
      session.email,
    )
    if (until === null) role = 'dev'
    else adminUntil = until
  }

  if (sandbox.lockdown === 1 && role !== 'admin') return locked(c)

  c.set('role', role)
  c.set('sandboxId', sandbox.id)
  c.set('lockdown', sandbox.lockdown === 1)
  c.set('email', session.email)
  c.set('listedRole', listed)
  if (adminUntil !== undefined) c.set('adminUntil', adminUntil)
  c.set('sessionExpiresAt', session.expiresAt)
  await next()
  return undefined
}

/**
 * Refuses a request made with an API key, whatever role the key carries.
 *
 * Non-negotiable 4, as middleware. `requireRole` checks a role and a key
 * carries one, so every rule written in terms of a role silently applies to
 * keys too — which is how an admin-level key reached `DELETE /runs/:id`, and
 * how one could mint another admin key until this existed.
 *
 * @param what - Named in the refusal, so the caller is told what to do instead
 */
export const refuseKeys = (what: string) => async (c: Context<HonoEnv>, next: Next) => {
  if (c.get('apiKey')) {
    return c.json({ error: `Keys may not ${what} — sign in to do that` }, 403)
  }
  await next()
  return undefined
}

/**
 * Who made this request, in the words a history can use: the account's email,
 * or a key's label. A key gets its label, the thing it was made to be
 * identified by; inventing a person for it would be a worse answer than none.
 */
export function actorFor(c: Context<HonoEnv>): string {
  const key = c.get('apiKey')
  if (key) return `key:${key.label}`
  return c.get('email') ?? c.get('role')
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
