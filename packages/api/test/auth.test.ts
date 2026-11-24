import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createAdminToken,
  createToken,
  readAdminCookie,
  readSessionCookie,
  verifyAdminToken,
  verifyToken,
} from '../src/auth'
import { hmacHex } from '../src/crypto'

const SECRET = 'test-token-secret'
const SANDBOX = '0123456789abcdef0123456789abcdef'
const OTHER_SANDBOX = 'fedcba9876543210fedcba9876543210'
const inADay = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const box = (id = SANDBOX) => ({ id, expires_at: inADay() })

afterEach(() => vi.useRealTimers())

describe('session tokens', () => {
  it('round-trips the sandbox and the account', async () => {
    const { token } = await createToken(SECRET, box(), 'you@demo.testbydesign.dev')
    expect(await verifyToken(SECRET, token)).toMatchObject({
      sandboxId: SANDBOX,
      email: 'you@demo.testbydesign.dev',
    })
  })

  it('lasts as long as its sandbox', async () => {
    const sandbox = box()
    const { expiresAt } = await createToken(SECRET, sandbox, 'a@b.co')
    expect(expiresAt).toBe(Math.floor(Date.parse(sandbox.expires_at) / 1000))
  })

  it('rejects a token signed with a different secret', async () => {
    const { token } = await createToken('other-secret', box(), 'a@b.co')
    expect(await verifyToken(SECRET, token)).toBeNull()
  })

  /**
   * The sandbox is in plain text in the token, so the only thing stopping a
   * visitor from editing it to someone else's is the signature. This is the
   * crossing the whole scheme exists to prevent.
   */
  it("rejects a token edited to name another visitor's sandbox", async () => {
    const { token } = await createToken(SECRET, box(), 'a@b.co')
    const [exp, , email, signature] = token.split('.')
    expect(await verifyToken(SECRET, `${exp}.${OTHER_SANDBOX}.${email}.${signature}`)).toBeNull()
  })

  /*
   * The account is inside the signed payload, so switching it is the same class
   * of attack as switching the sandbox: an account listed as qa edited to the
   * one listed as admin.
   */
  it('rejects a token whose account was edited after signing', async () => {
    const { token } = await createToken(SECRET, box(), 'qa@b.co')
    const [exp, sandbox, , signature] = token.split('.')
    const forged = btoa('admin@b.co').replace(/=+$/, '')
    expect(await verifyToken(SECRET, `${exp}.${sandbox}.${forged}.${signature}`)).toBeNull()
  })

  it('rejects a token whose expiry was pushed into the future', async () => {
    const { token } = await createToken(SECRET, box(), 'a@b.co')
    const [, sandbox, email, signature] = token.split('.')
    expect(await verifyToken(SECRET, `9999999999.${sandbox}.${email}.${signature}`)).toBeNull()
  })

  it('rejects a token once it has expired', async () => {
    const { token } = await createToken(SECRET, box(), 'a@b.co')
    expect(await verifyToken(SECRET, token)).not.toBeNull()
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    expect(await verifyToken(SECRET, token)).toBeNull()
  })

  it('rejects a correctly signed token whose sandbox is not one of ours', async () => {
    const payload = `9999999999.not-a-sandbox.${btoa('a@b.co')}`
    expect(await verifyToken(SECRET, `${payload}.${await hmacHex(SECRET, payload)}`)).toBeNull()
  })

  /*
   * An email is free text, and the payload is dot-delimited. Encoding it is
   * what stops `j.smith@x.co` splitting the token into extra parts.
   */
  it('survives an account with dots and characters base64 would pad', async () => {
    const { token } = await createToken(SECRET, box(), 'j.smith+a@x.co')
    expect(await verifyToken(SECRET, token)).toMatchObject({ email: 'j.smith+a@x.co' })
  })

  it.each([
    ['no separators', 'justastring'],
    ['three parts', 'a.b.c'],
    ['five parts', 'a.b.c.d.e'],
    ['empty', ''],
    ['the old role token', '9999999999.admin.abc'],
  ])('rejects a malformed token: %s', async (_label, token) => {
    expect(await verifyToken(SECRET, token)).toBeNull()
  })
})

describe('admin tokens', () => {
  it('holds for the sandbox and account it was issued to', async () => {
    const { token, expiresAt } = await createAdminToken(SECRET, SANDBOX, 'you@x.co')
    expect(await verifyAdminToken(SECRET, token, SANDBOX, 'you@x.co')).toBe(expiresAt)
  })

  it('lasts an hour', async () => {
    const { token } = await createAdminToken(SECRET, SANDBOX, 'you@x.co')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    expect(await verifyAdminToken(SECRET, token, SANDBOX, 'you@x.co')).toBeNull()
  })

  it('does not carry to another sandbox', async () => {
    const { token } = await createAdminToken(SECRET, SANDBOX, 'you@x.co')
    expect(await verifyAdminToken(SECRET, token, OTHER_SANDBOX, 'you@x.co')).toBeNull()
  })

  it('does not carry to another account in the same sandbox', async () => {
    const { token } = await createAdminToken(SECRET, SANDBOX, 'you@x.co')
    expect(await verifyAdminToken(SECRET, token, SANDBOX, 'qa@x.co')).toBeNull()
  })

  it('is not a session token, and a session token is not one', async () => {
    const session = await createToken(SECRET, box(), 'you@x.co')
    const admin = await createAdminToken(SECRET, SANDBOX, 'you@x.co')
    expect(await verifyAdminToken(SECRET, session.token, SANDBOX, 'you@x.co')).toBeNull()
    expect(await verifyToken(SECRET, admin.token)).toBeNull()
  })

  it('rejects one signed with another secret', async () => {
    const { token } = await createAdminToken('other', SANDBOX, 'you@x.co')
    expect(await verifyAdminToken(SECRET, token, SANDBOX, 'you@x.co')).toBeNull()
  })
})

describe('reading the cookies', () => {
  it('finds the session among other cookies', () => {
    expect(readSessionCookie('theme=dark; session=abc.def; other=1')).toBe('abc.def')
  })

  it('finds the admin cookie apart from the session', () => {
    expect(readAdminCookie('session=s.1; admin=adm.2')).toBe('adm.2')
    expect(readSessionCookie('session=s.1; admin=adm.2')).toBe('s.1')
  })

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(undefined)).toBeNull()
  })

  // A cookie named `not_session` must not satisfy a suffix match.
  it('does not match a cookie whose name merely ends in session', () => {
    expect(readSessionCookie('not_session=abc')).toBeNull()
  })
})
