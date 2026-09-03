import { describe, expect, it, vi, afterEach } from 'vitest'
import { createToken, verifyToken, roleForPassword, readSessionCookie } from '../src/auth'
import { hmacHex } from '../src/crypto'
import { DEV_PASSWORDS } from '../src/config'
import type { Bindings, Role } from '../src/types'

const SECRET = 'test-token-secret'

afterEach(() => vi.useRealTimers())

describe('session tokens', () => {
  it.each(['dev', 'qa', 'admin'] as Role[])('round-trips a %s session', async (role) => {
    const { token } = await createToken(SECRET, role)
    expect(await verifyToken(SECRET, token)).toBe(role)
  })

  it('rejects a token signed with a different secret', async () => {
    const { token } = await createToken('other-secret', 'admin')
    expect(await verifyToken(SECRET, token)).toBeNull()
  })

  /**
   * The role is in plain text in the token, so the only thing stopping a `dev`
   * from editing it to `admin` is the signature. This is the escalation the
   * whole scheme exists to prevent.
   */
  it('rejects a dev token edited to say admin', async () => {
    const { token } = await createToken(SECRET, 'dev')
    const [exp, , signature] = token.split('.')

    expect(await verifyToken(SECRET, `${exp}.admin.${signature}`)).toBeNull()
  })

  /**
   * Signature before expiry, deliberately: an attacker who could push the
   * expiry out and have it read first would only be stopped by the signature
   * anyway, and checking in that order is harder to reason about.
   */
  it('rejects a token whose expiry was pushed into the future', async () => {
    const { token } = await createToken(SECRET, 'dev')
    const [, role, signature] = token.split('.')

    expect(await verifyToken(SECRET, `9999999999.${role}.${signature}`)).toBeNull()
  })

  it('rejects a token once it has expired', async () => {
    const { token } = await createToken(SECRET, 'qa')
    expect(await verifyToken(SECRET, token)).toBe('qa')

    // The TTL is eight hours; step past it.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000)

    expect(await verifyToken(SECRET, token)).toBeNull()
  })

  /**
   * A correctly signed token naming a role that does not exist must not be
   * let through — otherwise `c.get('role')` carries a value no policy covers,
   * and `POLICIES[role]` is undefined at the point it is trusted.
   */
  it('rejects a correctly signed token naming an unknown role', async () => {
    const payload = '9999999999.superuser'
    const token = `${payload}.${await hmacHex(SECRET, payload)}`

    expect(await verifyToken(SECRET, token)).toBeNull()
  })

  it.each([
    ['no separators', 'justastring'],
    ['two parts', 'a.b'],
    ['four parts', 'a.b.c.d'],
    ['empty', ''],
    ['non-numeric expiry', 'later.dev.abc'],
  ])('rejects a malformed token: %s', async (_label, token) => {
    expect(await verifyToken(SECRET, token)).toBeNull()
  })
})

describe('roleForPassword', () => {
  // Nothing configured, so the development defaults apply — the local case.
  const env = {} as Bindings

  it.each(Object.entries(DEV_PASSWORDS))('maps %s password to its role', async (role, password) => {
    expect(await roleForPassword(env, password)).toBe(role)
  })

  it.each([
    ['wrong', 'not-a-password'],
    ['empty', ''],
    ['a role name that is not the password', 'administrator'],
  ])('returns null for a %s password', async (_label, password) => {
    expect(await roleForPassword(env, password)).toBeNull()
  })

  it('prefers an explicitly configured password over the default', async () => {
    const configured = { ADMIN_PASSWORD: 'a-real-secret' } as unknown as Bindings

    expect(await roleForPassword(configured, 'a-real-secret')).toBe('admin')
    // The default must no longer open the admin role once one is configured.
    expect(await roleForPassword(configured, DEV_PASSWORDS.admin)).toBeNull()
  })
})

describe('readSessionCookie', () => {
  it('finds the session among other cookies', () => {
    expect(readSessionCookie('theme=dark; session=abc.def; other=1')).toBe('abc.def')
  })

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(undefined)).toBeNull()
  })

  it('returns null when no session cookie is present', () => {
    expect(readSessionCookie('theme=dark; other=1')).toBeNull()
  })

  // A cookie named `not_session` must not satisfy a prefix match.
  it('does not match a cookie whose name merely ends in session', () => {
    expect(readSessionCookie('not_session=abc')).toBeNull()
  })
})
