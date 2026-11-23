import { describe, expect, it } from 'vitest'
import { POLICIES, matchesRef, mayUseRef, policyFor, visibilityClause } from '../src/policy'
import { ROLES } from '../src/auth'
import type { Role } from '../src/types'

/**
 * The policy table, asserted against expectations written out by hand.
 *
 * Deriving the expectations from `POLICIES` would make this file a tautology:
 * it would agree with whatever the table says, including after someone widens
 * `dev` to every branch by accident. The duplication is the test.
 */
const EXPECTED: Record<Role, { refs: string[]; maxWorkers: number; canDelete: boolean }> = {
  dev: { refs: ['main'], maxWorkers: 4, canDelete: false },
  qa: { refs: ['main', 'develop', 'release/*'], maxWorkers: 8, canDelete: false },
  admin: { refs: ['*'], maxWorkers: 16, canDelete: true },
}

describe('the policy table', () => {
  it('covers every role, with no extras', () => {
    expect(Object.keys(POLICIES).sort()).toEqual([...ROLES].sort())
  })

  it.each(ROLES)('matches what is documented for %s', (role) => {
    const expected = EXPECTED[role]
    expect(policyFor(role).allowedRefs).toEqual(expected.refs)
    expect(policyFor(role).maxWorkers).toBe(expected.maxWorkers)
    expect(policyFor(role).canDelete).toBe(expected.canDelete)
  })

  it('lets only admin delete', () => {
    expect(ROLES.filter((role) => POLICIES[role].canDelete)).toEqual(['admin'])
  })
})

describe('mayUseRef', () => {
  it('pins dev to main', () => {
    expect(mayUseRef('dev', 'main')).toBe(true)
    expect(mayUseRef('dev', 'develop')).toBe(false)
    expect(mayUseRef('dev', 'feature/anything')).toBe(false)
  })

  it('gives qa the release branches but not arbitrary ones', () => {
    expect(mayUseRef('qa', 'develop')).toBe(true)
    expect(mayUseRef('qa', 'release/1.0.0')).toBe(true)
    expect(mayUseRef('qa', 'release/2.1')).toBe(true)
    expect(mayUseRef('qa', 'feature/anything')).toBe(false)
  })

  it('does not give dev a release branch', () => {
    expect(mayUseRef('dev', 'release/1.0.0')).toBe(false)
  })

  it('lets admin use any ref, via the wildcard', () => {
    expect(mayUseRef('admin', 'feature/anything')).toBe(true)
  })

  // `*` is a wildcard in the policy, not a ref anybody may name.
  it('does not treat a literal asterisk as a ref dev may use', () => {
    expect(mayUseRef('dev', '*')).toBe(false)
  })

  it('does not match a ref by prefix', () => {
    expect(mayUseRef('dev', 'main-experiment')).toBe(false)
    expect(mayUseRef('qa', 'releasefoo')).toBe(false)
  })
})

describe('matchesRef', () => {
  const qa = ['main', 'develop', 'release/*']

  it('matches a name exactly, and a pattern by one segment under its prefix', () => {
    expect(matchesRef(qa, 'main')).toBe(true)
    expect(matchesRef(qa, 'release/1.0.0')).toBe(true)
    expect(matchesRef(qa, 'release/v2_rc-1')).toBe(true)
  })

  /**
   * Each of these is a branch nobody listed. A pattern that was a loose prefix
   * test would let all of them through.
   */
  it.each([
    'release',
    'release/',
    'releasefoo',
    'release-1.0',
    'release/1.0.0/hotfix',
    'release/../main',
    'release/./x',
    'release//x',
    'release/ 1',
    'release/.hidden',
    'release/-flag',
    'Release/1.0.0',
    'prerelease/1.0.0',
    'x/release/1.0.0',
  ])('does not match %j', (ref) => {
    expect(matchesRef(qa, ref)).toBe(false)
  })

  it('treats a pattern in the list as text when the ref is that text', () => {
    // A key narrowed to `release/*` is compared as written against its role's list.
    expect(matchesRef(['release/*'], 'release/*')).toBe(true)
  })

  /** Only `prefix/*` is a pattern; a star anywhere else is just a character in a name. */
  it('does not read a star without a slash as a pattern', () => {
    expect(matchesRef(['release*'], 'releasefoo')).toBe(false)
    expect(matchesRef(['release*'], 'release/1.0.0')).toBe(false)
    expect(matchesRef(['*release'], 'prerelease')).toBe(false)
  })

  it('matches any ref for *, and nothing for an empty list', () => {
    expect(matchesRef(['*'], 'anything/at/all')).toBe(true)
    expect(matchesRef([], 'main')).toBe(false)
  })

  it('works with the pattern anywhere in the list, and with several', () => {
    expect(matchesRef(['release/*', 'hotfix/*'], 'hotfix/9')).toBe(true)
    expect(matchesRef(['release/*', 'hotfix/*'], 'feature/9')).toBe(false)
  })
})

/**
 * Unit checks on the fragment's shape. What it lets through is checked against
 * D1 in sandboxes.test.ts, where rows of two sandboxes and the real ones meet.
 */
describe('visibilityClause', () => {
  const SANDBOX = '0123456789abcdef0123456789abcdef'
  const WHOSE = '((sandbox_id IS NULL AND simulated = 0) OR sandbox_id = ?)'

  it('restricts dev to main-branch runs, of the real ones and its own sandbox', () => {
    expect(visibilityClause('dev', SANDBOX)).toEqual({
      sql: `${WHOSE} AND ref = ?`,
      params: [SANDBOX, 'main'],
    })
  })

  it.each(['qa', 'admin'] as Role[])('gives %s every branch, of the same runs', (role) => {
    expect(visibilityClause(role, SANDBOX)).toEqual({ sql: WHOSE, params: [SANDBOX] })
  })

  // The clause is interpolated into SQL, so it must never carry a value.
  it.each(['dev', 'qa', 'admin'] as Role[])('parameterises %s rather than inlining', (role) => {
    const clause = visibilityClause(role, SANDBOX)
    expect(clause.sql).not.toContain(SANDBOX)
    expect(clause.sql.match(/\?/g)).toHaveLength(clause.params.length)
  })
})
