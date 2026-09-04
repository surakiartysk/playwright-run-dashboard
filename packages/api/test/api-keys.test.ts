import { describe, expect, it } from 'vitest'
import {
  effectivePolicy,
  looksLikeKey,
  mintKey,
  parseKey,
  verifyKey,
  type ApiKeyRow,
} from '../src/apiKeys'
import { policyFor } from '../src/policy'

const SECRET = 'test-secret'

/** A verified key row, overridable per test. */
const row = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: 'abc123',
  hash: 'unused',
  label: 'a pipeline',
  role: 'dev',
  allowed_refs: null,
  max_workers: null,
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00.000Z',
  last_used_at: null,
  revoked_at: null,
  ...over,
})

describe('minting a key', () => {
  it('returns a plaintext that parses back to the stored id', async () => {
    const { row: stored, plaintext } = await mintKey(SECRET, {
      label: 'deploy pipeline',
      role: 'qa',
      createdBy: 'admin',
    })

    expect(parseKey(plaintext)?.id).toBe(stored.id)
  })

  /**
   * The secret must not be recoverable from anything kept. If the row ever
   * carried the plaintext — or a reversible encoding of it — a leaked database
   * would hand over working credentials, which is the whole reason for hashing.
   */
  it('stores no copy of the secret', async () => {
    const { row: stored, plaintext } = await mintKey(SECRET, {
      label: 'x',
      role: 'dev',
      createdBy: 'admin',
    })

    const secretPart = plaintext.split('_')[2] as string

    expect(stored.hash).not.toBe(secretPart)
    expect(JSON.stringify(stored)).not.toContain(secretPart)
  })

  it('does not repeat itself', async () => {
    const made = await Promise.all(
      Array.from({ length: 50 }, () =>
        mintKey(SECRET, { label: 'x', role: 'dev', createdBy: 'admin' }),
      ),
    )

    expect(new Set(made.map((m) => m.plaintext)).size).toBe(50)
    expect(new Set(made.map((m) => m.row.id)).size).toBe(50)
  })

  it('avoids characters that are misread when a key is copied by hand', async () => {
    const { plaintext } = await mintKey(SECRET, { label: 'x', role: 'dev', createdBy: 'admin' })

    expect(plaintext.replace(/^rdk_/, '')).not.toMatch(/[ilou]/)
  })
})

describe('parsing a presented credential', () => {
  it('reads a well-formed key', () => {
    expect(parseKey('rdk_abc_def')).toEqual({ id: 'abc', secret: 'def' })
  })

  /**
   * A session token must never be read as a malformed key. Both arrive in the
   * same header, and mistaking one for the other would turn a valid session
   * into "API key is invalid".
   */
  it('rejects a session token rather than mis-parsing it', () => {
    expect(parseKey('1700000000.dev.abcdef')).toBeNull()
    expect(looksLikeKey('1700000000.dev.abcdef')).toBe(false)
  })

  it('rejects a key with an empty half', () => {
    expect(parseKey('rdk__def')).toBeNull()
    expect(parseKey('rdk_abc_')).toBeNull()
  })

  it('rejects another system’s prefix', () => {
    expect(parseKey('ghp_abc_def')).toBeNull()
    expect(looksLikeKey('ghp_abcdef')).toBe(false)
  })
})

describe('verifying a key', () => {
  it('accepts the secret it was minted with', async () => {
    const { row: stored, plaintext } = await mintKey(SECRET, {
      label: 'x',
      role: 'dev',
      createdBy: 'admin',
    })
    const parsed = parseKey(plaintext)!

    expect(await verifyKey(SECRET, stored, parsed.secret)).toBe(true)
  })

  it('rejects a secret signed under a different secret', async () => {
    const { row: stored, plaintext } = await mintKey(SECRET, {
      label: 'x',
      role: 'dev',
      createdBy: 'admin',
    })
    const parsed = parseKey(plaintext)!

    expect(await verifyKey('another-secret', stored, parsed.secret)).toBe(false)
  })

  /**
   * Revocation is checked on the same path as the signature so it cannot be
   * skipped by a caller that loads the row some other way. A revoked key that
   * still verifies is the failure this whole feature would be judged on.
   */
  it('rejects a revoked key even with the right secret', async () => {
    const { row: stored, plaintext } = await mintKey(SECRET, {
      label: 'x',
      role: 'dev',
      createdBy: 'admin',
    })
    const parsed = parseKey(plaintext)!

    const revoked = { ...stored, revoked_at: '2026-01-02T00:00:00.000Z' }

    expect(await verifyKey(SECRET, revoked, parsed.secret)).toBe(false)
  })

  it('rejects an id that matched nothing', async () => {
    expect(await verifyKey(SECRET, null, 'anything')).toBe(false)
  })
})

describe('the policy a key actually gets', () => {
  it('inherits its role when it names no limits of its own', () => {
    expect(effectivePolicy(row({ role: 'qa' }))).toMatchObject({
      allowedRefs: policyFor('qa').allowedRefs,
      maxWorkers: policyFor('qa').maxWorkers,
    })
  })

  it('narrows the refs to those the key names', () => {
    expect(effectivePolicy(row({ role: 'qa', allowed_refs: 'develop' })).allowedRefs).toEqual([
      'develop',
    ])
  })

  /**
   * The rule the whole design rests on: a key may narrow its role, never widen
   * it. A key naming a ref its role cannot use gets the intersection — if that
   * were the union, `policy.ts` would stop being the truth and this table would
   * become a second permission system.
   */
  it('cannot grant a ref its role may not use', () => {
    // dev is pinned to main; the key asks for develop as well.
    const policy = effectivePolicy(row({ role: 'dev', allowed_refs: 'main,develop' }))

    expect(policy.allowedRefs).toEqual(['main'])
    expect(policy.allowedRefs).not.toContain('develop')
  })

  it('returns nothing when the key and its role share no ref', () => {
    // Deliberately empty rather than falling back to the role's list: a key
    // configured to reach nothing should reach nothing.
    expect(effectivePolicy(row({ role: 'dev', allowed_refs: 'release' })).allowedRefs).toEqual([])
  })

  it("lets a key narrow admin's wildcard to specific refs", () => {
    expect(effectivePolicy(row({ role: 'admin', allowed_refs: 'main' })).allowedRefs).toEqual([
      'main',
    ])
  })

  it('cannot raise the worker ceiling above its role', () => {
    // dev allows 4; the key asks for 64.
    expect(effectivePolicy(row({ role: 'dev', max_workers: 64 })).maxWorkers).toBe(
      policyFor('dev').maxWorkers,
    )
  })

  it('lowers the worker ceiling when the key asks for less', () => {
    expect(effectivePolicy(row({ role: 'qa', max_workers: 2 })).maxWorkers).toBe(2)
  })

  /**
   * Deleting is destructive, irreversible, and has no automated use case. A
   * pipeline that needs it is doing something a person should be doing.
   */
  it('never grants deletion, not even to an admin-role key', () => {
    expect(effectivePolicy(row({ role: 'admin' })).canDelete).toBe(false)
    expect(policyFor('admin').canDelete).toBe(true)
  })
})
