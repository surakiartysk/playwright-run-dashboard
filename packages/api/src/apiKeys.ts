import type { Role } from './types'
import { hmacHex, verifyHmac } from './crypto'
import { policyFor, type RolePolicy } from './policy'

/**
 * Credentials for machines — see decision 15 for why they are issued here
 * rather than handing a pipeline a GitHub token.
 *
 * A key is `rdk_<id>_<secret>`. The id is public and travels so a lookup is one
 * indexed read; the secret is HMAC'd and only the digest is stored, so a leaked
 * database does not hand over working credentials. The whole key is shown once,
 * at creation, and cannot be recovered afterwards.
 *
 * Everything below runs *before* a handler, and its job is to make an
 * authenticated request look exactly like a person's. Once the role and limits
 * are resolved, `mayUseRef`, `maxWorkers` and the gate apply unchanged — which
 * is the point: a second authorisation path is a second thing to get wrong.
 */

/** Distinguishes a key from a session token at a glance, in logs and in a .env. */
const PREFIX = 'rdk'

export interface ApiKeyRow {
  id: string
  hash: string
  label: string
  role: Role
  allowed_refs: string | null
  max_workers: number | null
  created_by: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/**
 * Crockford's alphabet — no I, L, O or U.
 *
 * A key gets copied out of a terminal into a secret store by hand at least
 * once, and those four are the characters that get transcribed wrong. Same
 * reasoning as the run id in routes/runs.ts.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  // 32 symbols is exactly five bits, so the modulo introduces no bias.
  return Array.from(bytes, (byte) => ALPHABET[byte % 32]).join('')
}

/**
 * Mint a key. The plaintext is returned once and never stored.
 *
 * The secret is 26 characters over a 32-symbol alphabet — about 130 bits.
 * Unlike the run id, this one *is* a secret, so it is sized to be
 * unguessable rather than merely unique.
 *
 * @param secret - `TOKEN_SECRET`, the HMAC key the digest is computed under
 * @returns the row to insert, and the plaintext to show the admin once
 */
export async function mintKey(
  secret: string,
  input: {
    label: string
    role: Role
    allowedRefs?: string[]
    maxWorkers?: number
    createdBy: string
  },
): Promise<{ row: ApiKeyRow; plaintext: string }> {
  const id = randomString(12)
  const secretPart = randomString(26)

  return {
    plaintext: `${PREFIX}_${id}_${secretPart}`,
    row: {
      id,
      hash: await hmacHex(secret, secretPart),
      label: input.label,
      role: input.role,
      allowed_refs: input.allowedRefs?.length ? input.allowedRefs.join(',') : null,
      max_workers: input.maxWorkers ?? null,
      created_by: input.createdBy,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    },
  }
}

/**
 * Split a presented key into its two halves.
 *
 * Returns null for anything that is not shaped like one of ours, so a session
 * token in the same header is not mistaken for a malformed key — the caller
 * falls through to session verification instead of rejecting outright.
 *
 * @param presented - the raw value of the Authorization header, sans `Bearer `
 */
export function parseKey(presented: string): { id: string; secret: string } | null {
  const parts = presented.split('_')
  if (parts.length !== 3) return null

  const [prefix, id, secret] = parts as [string, string, string]
  if (prefix !== PREFIX || id === '' || secret === '') return null

  return { id, secret }
}

/** Cheap check for "is this even a key?", used to pick a verification path. */
export const looksLikeKey = (presented: string) => presented.startsWith(`${PREFIX}_`)

/**
 * Verify a presented secret against a stored row.
 *
 * A revoked key fails here rather than at the lookup, so revocation is checked
 * on the same path as the signature and cannot be forgotten by a caller that
 * loads the row some other way.
 *
 * @param secret - `TOKEN_SECRET`
 * @param row - the row whose id matched, or null when nothing matched
 * @param presentedSecret - the secret half the caller sent
 */
export async function verifyKey(
  secret: string,
  row: ApiKeyRow | null,
  presentedSecret: string,
): Promise<boolean> {
  if (!row || row.revoked_at !== null) return false
  return verifyHmac(secret, presentedSecret, row.hash)
}

/**
 * What a key may actually do — its role's policy, narrowed by its own limits.
 *
 * **Narrowing only.** A key naming refs its role cannot use gets the
 * intersection, not the union; a key asking for more workers than its role
 * allows gets the role's ceiling. A key that could widen its role would be a
 * second permission system, and `policy.ts` would stop being the truth.
 *
 * An empty intersection is returned as an empty list rather than falling back
 * to the role's — a key configured to reach nothing should reach nothing, and
 * silently restoring the role's refs would be the failure this rule exists to
 * prevent.
 *
 * @param row - the verified key
 * @returns the effective policy for requests made with it
 */
export function effectivePolicy(row: ApiKeyRow): RolePolicy {
  const base = policyFor(row.role)

  const keyRefs =
    row.allowed_refs
      ?.split(',')
      .map((r) => r.trim())
      .filter(Boolean) ?? null

  const allowedRefs = !keyRefs
    ? base.allowedRefs
    : base.allowedRefs.includes('*')
      ? // The role may use any ref, so the key's list is already the narrower
        // of the two and stands on its own.
        keyRefs
      : keyRefs.filter((ref) => base.allowedRefs.includes(ref))

  return {
    allowedRefs,
    maxWorkers: Math.min(row.max_workers ?? base.maxWorkers, base.maxWorkers),
    // Never delegated to a machine. Deletion is destructive, irreversible and
    // has no automated use case; a pipeline that needs it is a pipeline doing
    // something a person should be doing.
    canDelete: false,
  }
}
