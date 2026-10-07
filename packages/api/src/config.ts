import type { Bindings } from './types'

/**
 * Development defaults for the secrets.
 *
 * These exist so `pnpm dev` works on a clean clone. They are obviously fake,
 * and `assertDeployable` refuses to let them reach a real deployment — a
 * default that silently ships is worse than no default at all.
 */

export const DEV_WEBHOOK_SECRET = 'dev-webhook-secret-not-for-deployment'
export const DEV_TOKEN_SECRET = 'dev-token-secret-not-for-deployment'
/**
 * One password per role, so the role model is exercisable locally.
 *
 * Listed in the README for local use — hiding credentials that are public in
 * the source helps nobody and just makes the demo harder to try.
 *
 * `demo` is not "another one of these" — see the note on `DEMO_PASSWORD`
 * below and decision 12.
 */
export const DEV_PASSWORDS = {
  demo: 'demo',
  dev: 'dev',
  qa: 'qa',
  admin: 'admin',
} as const

/**
 * `demo`'s default, kept separate from `DEV_PASSWORDS` even though it lands
 * in the same object below — this constant is the one that stays true after
 * `assertDeployable` no longer accepts the others.
 *
 * A real deployment is expected to change `dev`/`qa`/`admin` to something not
 * printed in this file. `demo` is expected to stay `"demo"`, or something
 * equally guessable, and to be handed out or written on a README on purpose —
 * its safety is `dispatchWorkflow` refusing it a real dispatch, never the
 * password's secrecy. Requiring a strong DEMO_PASSWORD would suggest the
 * opposite and be a promise this role does not need to keep.
 */
export const DEMO_PASSWORD_DEFAULT = DEV_PASSWORDS.demo

/**
 * Where the shared Allure report for simulated runs lives in R2.
 *
 * One report, uploaded once by `scripts/upload-demo-report.mjs`, served for
 * every simulated run — it is the same bytes every time, so a copy per run
 * would be storage spent on duplicates. Simulated runs record this prefix in
 * `report_path`; real runs record their own, so a real run whose upload never
 * arrived still 404s rather than quietly serving someone else's results.
 */
export const DEMO_REPORT_PREFIX = 'demo-report'

/**
 * How many real runs keep their report, before the oldest may be removed.
 *
 * A report is 3.6 to 9.3 MB measured (a run of both styles is the large end), so
 * this is about 4.5 GB at the large end, under the 10 GB R2 includes free. It is a
 * count and not a number of days because what fills the bucket is runs, and
 * a quiet month should not cost anything its history.
 */
export const REPORTS_KEPT = 500

/**
 * A report is never removed before it is this old, whatever the count.
 *
 * The count alone would let a busy day push out a report from last week. Both
 * have to hold: outside the newest {@link REPORTS_KEPT} *and* older than this.
 */
export const REPORT_MIN_AGE_MS = 180 * 24 * 60 * 60 * 1000

/** Reports removed per sweep, so a first run over a long backlog stays short. */
export const REPORTS_REMOVED_PER_SWEEP = 25

/**
 * Fails fast when a deployment is running for real on development secrets.
 *
 * Evaluated on every request (and logged once, in index.ts) rather than cached:
 * this is a configuration error, and it should stop the service answering at
 * all rather than produce an intermittently insecure one.
 */
export function assertDeployable(env: Bindings): string[] {
  // Simulation implies local, where the defaults are the point.
  if (env.SIMULATE_DISPATCH !== 'false') return []

  const problems: string[] = []
  if (!env.WEBHOOK_SECRET) problems.push('WEBHOOK_SECRET is unset — the webhook would be forgeable')
  if (!env.TOKEN_SECRET) problems.push('TOKEN_SECRET is unset — report links would be forgeable')
  if (!env.ADMIN_PASSWORD) problems.push('ADMIN_PASSWORD is unset')
  if (!env.QA_PASSWORD) problems.push('QA_PASSWORD is unset')
  if (!env.DEV_PASSWORD) problems.push('DEV_PASSWORD is unset')
  // DEMO_PASSWORD is deliberately absent from this list. Falling back to
  // DEV_PASSWORDS.demo on a real deployment is the intended behaviour, not a
  // gap — see DEMO_PASSWORD_DEFAULT.
  return problems
}
