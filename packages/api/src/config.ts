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
 * Printed by the login screen in simulation mode — hiding credentials that are
 * public in the source helps nobody and just makes the demo harder to try.
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
 * Fails fast when a deployment is running for real on development secrets.
 *
 * Called once at startup rather than per request: this is a configuration
 * error, and a configuration error should stop the thing starting rather than
 * produce an intermittently insecure service.
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
