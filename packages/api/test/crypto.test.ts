import { describe, expect, it, vi, afterEach } from 'vitest'
import { hmacHex, verifyHmac, signReportToken, verifyReportToken } from '../src/crypto'

const SECRET = 'test-secret'

afterEach(() => vi.useRealTimers())

describe('verifyHmac', () => {
  it('accepts a signature it produced', async () => {
    const signature = await hmacHex(SECRET, 'the message')
    expect(await verifyHmac(SECRET, 'the message', signature)).toBe(true)
  })

  it('rejects a signature made with a different secret', async () => {
    const signature = await hmacHex('other-secret', 'the message')
    expect(await verifyHmac(SECRET, 'the message', signature)).toBe(false)
  })

  it('rejects a signature for a different message', async () => {
    const signature = await hmacHex(SECRET, 'the message')
    expect(await verifyHmac(SECRET, 'the message.', signature)).toBe(false)
  })

  // The regex guard exists so malformed input is refused before it reaches
  // `parseInt`, where 'zz' would silently become NaN and then byte 0.
  it.each([
    ['empty', ''],
    ['too short', 'abc123'],
    ['non-hex characters', 'z'.repeat(64)],
    ['65 characters', `${'a'.repeat(64)}a`],
    ['hex with a space', `${'a'.repeat(63)} `],
  ])('rejects a malformed signature: %s', async (_label, signature) => {
    expect(await verifyHmac(SECRET, 'the message', signature)).toBe(false)
  })

  it('is case-insensitive about hex, since encoders differ', async () => {
    const signature = await hmacHex(SECRET, 'the message')
    expect(await verifyHmac(SECRET, 'the message', signature.toUpperCase())).toBe(true)
  })
})

describe('report tokens', () => {
  it('round-trips the run it was minted for', async () => {
    const token = await signReportToken(SECRET, 'run-a')
    expect(await verifyReportToken(SECRET, token)).toBe('run-a')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signReportToken('other-secret', 'run-a')
    expect(await verifyReportToken(SECRET, token)).toBeNull()
  })

  /**
   * The payload is base64url of JSON, so it is readable and editable by anyone
   * holding the link. Re-pointing it at another run must fail on the signature.
   */
  it('rejects a token whose payload was re-pointed at another run', async () => {
    const token = await signReportToken(SECRET, 'run-a')
    const [, signature] = token.split('.')

    const forged = btoa(JSON.stringify({ runId: 'run-b', exp: 9_999_999_999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(await verifyReportToken(SECRET, `${forged}.${signature}`)).toBeNull()
  })

  it('rejects a token once it has expired', async () => {
    const token = await signReportToken(SECRET, 'run-a', 60)
    expect(await verifyReportToken(SECRET, token)).toBe('run-a')

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 61_000)

    expect(await verifyReportToken(SECRET, token)).toBeNull()
  })

  it.each([
    ['no separator', 'nodot'],
    ['empty', ''],
    ['signature only', '.abc'],
    ['payload only', 'abc.'],
    ['payload that is not base64', '!!!.abc'],
  ])('rejects a malformed token: %s', async (_label, token) => {
    expect(await verifyReportToken(SECRET, token)).toBeNull()
  })

  it('rejects a correctly signed payload that is not a token', async () => {
    const body = btoa(JSON.stringify({ hello: 'world' })).replace(/=+$/, '')
    const signature = await hmacHex(SECRET, body)
    expect(await verifyReportToken(SECRET, `${body}.${signature}`)).toBeNull()
  })
})
