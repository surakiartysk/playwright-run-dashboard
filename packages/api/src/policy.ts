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
  // `ref` is a branch of the TEST SUITE, not of the product under test.
  //
  // That distinction is the whole reason these two rows differ, and reading it
  // the other way makes both look arbitrary. `main` is the suite that has been
  // reviewed and merged — the tests QA stands behind. `develop` is the suite
  // QA is still writing.
  //
  // A developer gets `main` only: they want to know whether their change broke
  // anything, and the answer has to come from tests that are themselves stable.
  // A half-written spec failing tells them nothing about their code, and costs
  // an afternoon before anyone works out the test was the problem.
  dev: { allowedRefs: ['main'], maxWorkers: 4, canDelete: false },

  // QA also runs the suite they are writing, which is what `develop` is — the
  // branch where a new spec lives until it is trusted enough to merge. Running
  // it against a real environment is how it gets that trust.
  //
  // And the suite as it stood at a release: `release/1.0.0` freezes the tests
  // that went with that version of the product, so an old version can be
  // re-tested without today's `main` in the way. One branch per version, which
  // is why this is a pattern — see `matchesRef`, and decision 37 for why the
  // name carries the version rather than being a single moving `release`.
  qa: { allowedRefs: ['main', 'develop', 'release/*'], maxWorkers: 8, canDelete: false },

  admin: { allowedRefs: ['*'], maxWorkers: 16, canDelete: true },
}

export const policyFor = (role: Role): RolePolicy => POLICIES[role]

/**
 * Whether a ref is covered by a list of allowed refs.
 *
 * An entry is a branch name, `*` for any, or `prefix/*` for the branches one
 * level under a prefix: `release/*` covers `release/1.0.0`.
 *
 * A pattern is deliberately narrow. It covers exactly one path segment, of
 * ordinary branch-name characters, so `release/*` does not cover `release`,
 * `releasefoo`, `release/1.0/x` or `release/../main`: a pattern that is also a
 * loose prefix match is a way of allowing a branch nobody listed. A list that
 * contains the pattern itself as text — a key narrowed to `release/*` — matches
 * it by the exact comparison, never by treating the ref as a pattern.
 */
export function matchesRef(allowed: readonly string[], ref: string): boolean {
  if (allowed.includes('*') || allowed.includes(ref)) return true
  return allowed.some((entry) => {
    if (!entry.endsWith('/*')) return false
    const prefix = entry.slice(0, -1)
    if (!ref.startsWith(prefix)) return false
    return PATTERN_SEGMENT.test(ref.slice(prefix.length))
  })
}

const PATTERN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function mayUseRef(role: Role, ref: string): boolean {
  return matchesRef(policyFor(role).allowedRefs, ref)
}

/**
 * The SQL fragment restricting which runs a caller may read (decision 52).
 *
 * Two questions, both answered in the query rather than by filtering in
 * JavaScript, so a handler that forgets to filter still cannot be handed a row
 * it should not see:
 *
 * 1. Whose runs: the real ones, reported by the suites' own CI (no sandbox,
 *    not simulated), and this caller's sandbox's. Never another sandbox's.
 *    Simulated rows from before sandboxes existed have no sandbox either;
 *    `simulated = 0` is what keeps them from passing as real.
 * 2. Which of those the role may see: `dev` sees `main` only. The suites a
 *    developer is told about are the ones that are themselves stable.
 *
 * Returned as a fragment with its parameters, applied with AND to whatever
 * else a query asks.
 */
export function visibilityClause(role: Role, sandboxId: string): { sql: string; params: string[] } {
  const whose = '((sandbox_id IS NULL AND simulated = 0) OR sandbox_id = ?)'
  if (role === 'dev') return { sql: `${whose} AND ref = ?`, params: [sandboxId, 'main'] }
  return { sql: whose, params: [sandboxId] }
}
