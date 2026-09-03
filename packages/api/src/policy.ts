import type { Role } from './types'

/**
 * What each role may do, in one place.
 *
 * Kept out of the route handlers deliberately. Scattering `if (role === 'dev')`
 * through them is how an authorisation rule ends up enforced in four places and
 * three of them drift — the read path forgets what the write path enforces, and
 * a developer sees a run they were never allowed to start.
 *
 * The rules answer three separate questions, and conflating them is the usual
 * mistake:
 *
 *   1. may this role start a run at all?
 *   2. against which git refs?
 *   3. which runs may it then see?
 *
 * (3) is the one most often missed. A dashboard that hides the button but
 * returns every row has not restricted anything.
 */

export interface RolePolicy {
  /** Refs this role may target. */
  allowedRefs: readonly string[]
  /** Ceiling on parallel workers — a courtesy limit, not a security boundary. */
  maxWorkers: number
  /** May delete runs from the history. */
  canDelete: boolean
}

export const POLICIES: Record<Role, RolePolicy> = {
  // The public-facing tier. Its safety does not come from allowedRefs or
  // maxWorkers here — those are the same courtesy limits every role gets. It
  // comes from dispatchWorkflow refusing this role a real dispatch regardless
  // of SIMULATE_DISPATCH, and from visibilityClause below scoping it to only
  // the runs it started itself. See decision 12.
  demo: { allowedRefs: ['main'], maxWorkers: 2, canDelete: false },

  // Pinned to main: a developer verifying that their merge is healthy does not
  // need to point the suite at arbitrary branches, and allowing it turns the
  // dashboard into a way to run untrusted code on the runner.
  dev: { allowedRefs: ['main'], maxWorkers: 4, canDelete: false },

  // QA drives release verification, so they need branches.
  qa: { allowedRefs: ['main', 'develop', 'release'], maxWorkers: 8, canDelete: false },

  admin: { allowedRefs: ['*'], maxWorkers: 16, canDelete: true },
}

export const policyFor = (role: Role): RolePolicy => POLICIES[role]

export function mayUseRef(role: Role, ref: string): boolean {
  const { allowedRefs } = policyFor(role)
  return allowedRefs.includes('*') || allowedRefs.includes(ref)
}

/**
 * The SQL fragment restricting which runs a role may read, plus enough of the
 * decision to re-check a single already-fetched row without a second query.
 *
 * Returned as a fragment rather than applied by filtering in JavaScript: the
 * database must not hand over rows the caller may not see, because the moment
 * that filtering moves into the handler someone adds an endpoint that forgets
 * it. An empty `sql` means no restriction.
 *
 * `column` and `value` name what the fragment actually checks, so a caller
 * holding one row already (`GET /runs/:id`) can repeat the same test in
 * JavaScript instead of assuming — as an earlier version of this function
 * did — that visibility is always about `ref`. `demo` broke that assumption
 * on purpose: it is scoped by who triggered the run, not which branch.
 */
export function visibilityClause(
  role: Role,
): { sql: string; params: string[] } & (
  { column: null; value: null } | { column: string; value: string }
) {
  if (role === 'dev') return { sql: 'ref = ?', params: ['main'], column: 'ref', value: 'main' }
  if (role === 'demo') {
    return { sql: 'triggered_by = ?', params: ['demo'], column: 'triggered_by', value: 'demo' }
  }
  return { sql: '', params: [], column: null, value: null }
}
