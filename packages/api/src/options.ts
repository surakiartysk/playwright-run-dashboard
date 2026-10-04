import { matchesRef } from './policy'
import type { Suite } from './types'

/**
 * What can be asked of each suite — the one place the dashboard names it.
 *
 * Two suites, two vocabularies: the API suite is sliced by service, the UI suite
 * by journey group. Offering one suite the other's names would send a slice
 * that matches nothing.
 *
 * These are copies of what each suite's `on-demand.yml` accepts, kept here
 * rather than fetched from the suites: they change when a suite gains a service,
 * which is rare and always comes with a deploy. They used to be written out
 * twice more — once in the UI's form and once in the contract test — and the
 * form is now served these through `GET /options`, so the one copy a person can
 * edit is this. `integration-contract.test.ts` still holds a hand-copied
 * snapshot, because a test that imports what it checks agrees by construction;
 * `check:claims` compares that snapshot with this file.
 *
 * `all` comes first and is not padding: it is how "no narrowing on this side"
 * is said, and what the form opens a slice on.
 */
export const SUITE_OPTIONS: Record<Suite, { services: string[]; tags: string[] }> = {
  api: {
    services: ['all', 'items', 'reservations', 'maintenance-logs', 'core'],
    tags: ['all', 'smoke', 'isolated', 'flow', 'cross-service'],
  },
  ui: {
    services: ['all', 'auth', 'catalogue', 'cart', 'checkout', 'defects'],
    tags: ['all', 'smoke'],
  },
}

/** What a suite's branches are offered as when the real list cannot be read. */
const FALLBACK_REFS = ['main', 'develop']

/**
 * How many branches a pattern may put in the form.
 *
 * `release/*` grows by one branch a release for as long as the project lives,
 * and a dropdown of forty old versions is a dropdown nobody can use. This is
 * what the form offers, newest first, and nothing more: the policy still lets a
 * caller start a run on any branch the pattern covers, so an older release is
 * reached by naming it to the API, not by scrolling.
 */
export const MAX_PATTERN_REFS = 10

/** Version-aware, so `release/1.10.0` sorts above `release/1.9.0`. */
const newestFirst = (a: string, b: string) => b.localeCompare(a, 'en', { numeric: true })

/**
 * The branches a caller may pick for a suite: what their role allows, and what
 * exists.
 *
 * Both halves matter. The policy alone offered `develop` to QA and
 * `feature/example` to an admin on a deployment whose suites had one branch
 * each; picking either made GitHub refuse the dispatch, and the run was
 * recorded as an error for choosing something the form had offered.
 *
 * `existing` is null when the branches could not be read (no token, GitHub
 * unreachable, a simulated deployment). Then the policy's own list stands — and
 * for a role that may use any branch, which a list cannot enumerate, the common
 * ones. A pattern cannot be enumerated either, so with nothing to read it
 * contributes nothing rather than offering `release/*` as if it were a branch.
 *
 * Order: `main`, then the other named branches, then the ones a pattern
 * admitted, newest first and at most `MAX_PATTERN_REFS`.
 */
export function refsFor(allowed: readonly string[], existing: readonly string[] | null): string[] {
  const any = allowed.includes('*')
  const named = allowed.filter((entry) => entry !== '*' && !entry.endsWith('/*'))
  const candidates = existing === null ? (any ? FALLBACK_REFS : named) : [...existing]
  const unique = [
    ...new Set(any ? candidates : candidates.filter((ref) => matchesRef(allowed, ref))),
  ]

  const byName = (a: string, b: string) =>
    a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)
  if (any) return unique.sort(byName)

  const fromPattern = unique.filter((ref) => !named.includes(ref)).sort(newestFirst)
  return [
    ...unique.filter((ref) => named.includes(ref)).sort(byName),
    ...fromPattern.slice(0, MAX_PATTERN_REFS),
  ]
}
