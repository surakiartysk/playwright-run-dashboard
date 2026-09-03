import { describe, expect, it } from 'vitest'
import { POLICIES, mayUseRef, policyFor, visibilityClause } from '../src/policy'
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
  demo: { refs: ['main'], maxWorkers: 2, canDelete: false },
  dev: { refs: ['main'], maxWorkers: 4, canDelete: false },
  qa: { refs: ['main', 'develop', 'release'], maxWorkers: 8, canDelete: false },
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
    expect(mayUseRef('qa', 'release')).toBe(true)
    expect(mayUseRef('qa', 'feature/anything')).toBe(false)
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
    expect(mayUseRef('qa', 'release/1.0')).toBe(false)
  })
})

describe('visibilityClause', () => {
  it('restricts dev to main-branch runs', () => {
    expect(visibilityClause('dev')).toMatchObject({ sql: 'ref = ?', params: ['main'] })
  })

  /**
   * demo is scoped by who triggered the run, not by ref — a different column
   * from dev's. That is exactly the assumption GET /runs/:id used to hardcode
   * (`row.ref !== visibility.params[0]`), so this pins the column explicitly
   * rather than only the SQL string.
   */
  it('restricts demo to runs it triggered itself', () => {
    expect(visibilityClause('demo')).toMatchObject({
      sql: 'triggered_by = ?',
      params: ['demo'],
      column: 'triggered_by',
      value: 'demo',
    })
  })

  it.each(['qa', 'admin'] as Role[])('does not restrict %s', (role) => {
    expect(visibilityClause(role)).toMatchObject({ sql: '', params: [], column: null })
  })

  // The clause is interpolated into SQL, so it must never carry a value.
  it.each(['dev', 'demo'] as Role[])('parameterises %s rather than inlining the value', (role) => {
    const clause = visibilityClause(role)
    expect(clause.sql).not.toContain(clause.value)
    expect(clause.sql.match(/\?/g)).toHaveLength(clause.params.length)
  })
})
