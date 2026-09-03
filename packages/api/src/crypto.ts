/**
 * Signing and verification, on WebCrypto only.
 *
 * Workers have no Node `crypto`, so everything here goes through SubtleCrypto.
 * Two things are signed, for different reasons:
 *
 *   - the webhook, so a stranger cannot post "your run passed"
 *   - report links, so a URL can be shared without opening the bucket
 */

const encoder = new TextEncoder()

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

export async function hmacHex(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message))
  return toHex(signature)
}

/**
 * Constant-time comparison.
 *
 * Uses `crypto.subtle.verify` rather than comparing hex by hand: the runtime's
 * own comparison is constant-time, and it removes the chance of a hand-rolled
 * loop leaking length through an early return.
 */
export async function verifyHmac(
  secret: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false

  const bytes = new Uint8Array(
    signatureHex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  )

  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, encoder.encode(message))
}

// ── Report access tokens ────────────────────────────────────────────────────

interface TokenPayload {
  /** Run this token grants access to. */
  runId: string
  /** Expiry, epoch seconds. */
  exp: number
}

const base64url = {
  encode: (input: string) => btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (input: string) => atob(input.replace(/-/g, '+').replace(/_/g, '/')),
}

/**
 * Mints a link token for one run.
 *
 * Scoped to a single run rather than granting the whole bucket, and short-lived,
 * so a link pasted into a chat expires on its own. Not a JWT — there is one
 * issuer and one consumer, and a library would be more surface than the three
 * lines it replaces.
 */
export async function signReportToken(
  secret: string,
  runId: string,
  ttlSeconds = 3600,
): Promise<string> {
  const payload: TokenPayload = { runId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const body = base64url.encode(JSON.stringify(payload))
  const signature = await hmacHex(secret, body)
  return `${body}.${signature}`
}

/** Returns the run id a token is valid for, or null. */
export async function verifyReportToken(secret: string, token: string): Promise<string | null> {
  return (await verifiedPayload(secret, token))?.runId ?? null
}

/**
 * The expiry a valid token carries, or null.
 *
 * Used to give the report's asset cookie the same lifetime as the token that
 * minted it — a cookie outliving its token would quietly extend access past
 * the hour the link was scoped to.
 */
export async function reportTokenExpiry(secret: string, token: string): Promise<number | null> {
  return (await verifiedPayload(secret, token))?.exp ?? null
}

async function verifiedPayload(secret: string, token: string): Promise<TokenPayload | null> {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  if (!(await verifyHmac(secret, body, signature))) return null

  try {
    const payload = JSON.parse(base64url.decode(body)) as TokenPayload
    if (typeof payload.runId !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
