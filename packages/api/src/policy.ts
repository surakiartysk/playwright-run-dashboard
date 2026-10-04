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

/**
 * What a previewing demo session is not shown of another role's runs.
 *
 * Previewing is deliberately wider than demo's own scope (decision 22): the
 * point is to show what dev, qa and admin see, and on this deployment the runs
 * are of public suites against public targets. But a run carries one thing a
 * person typed — the name they gave when they signed in — and that is not
 * public: it reached the page because a real colleague said who they were, not
 * because anyone chose to publish it. A visitor with the one-click demo button
 * could read every name anyone had ever signed in with.
 *
 * So the name is withheld unless the run is the demo's own. The role stays:
 * `triggeredBy` is a role, and showing that is the point of the preview.
 *
 * @param real - the authenticated role (never the previewed one)
 * @param viewing - the role whose view is being shown
 */
export function redactForPreview<T extends { triggeredBy: string; startedBy: string | null }>(
  real: Role,
  viewing: Role,
  view: T,
): T {
  if (real !== 'demo' || viewing === 'demo') return view
  if (view.triggeredBy === 'demo') return view
  return view.startedBy === null ? view : { ...view, startedBy: null }
}
