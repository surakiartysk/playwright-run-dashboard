import type { Bindings, Role } from './types'

/**
 * Dispatches a workflow run — or pretends to.
 *
 * The pretend path is the reason this repo runs on a laptop. Without it, every
 * reader needs a GitHub token with `actions:write` on a repository they can
 * afford to spam before they see anything work, and most will not bother.
 *
 * Simulation is opt-out (`SIMULATE_DISPATCH=false`) rather than opt-in, so the
 * safe behaviour is the default and a real deployment states its intent
 * explicitly. A deployment that sets a token but forgets the flag gets a loud
 * error rather than a dashboard that silently dispatches nothing.
 *
 * `demo` is the one exception to that flag, not a second flag. A deployment
 * that is real for `dev`/`qa`/`admin` still simulates for `demo` — the point
 * of that role is a link anyone can be handed, and a real GITHUB_TOKEN behind
 * a publicly-known password would mean anyone with the link can spend this
 * deployment's Actions minutes, or worse, drive `on-demand.yml` against a ref
 * they choose. See decision 12.
 */

export interface DispatchResult {
  ok: boolean
  simulated: boolean
  error?: string
}

export async function dispatchWorkflow(
  env: Bindings,
  runId: string,
  role: Role,
  inputs: { service: string; tags: string; workers?: number; ref?: string },
): Promise<DispatchResult> {
  const simulate = role === 'demo' || env.SIMULATE_DISPATCH !== 'false'

  if (simulate) {
    // The workflow would normally call back; locally nothing will, so the run
    // is advanced by the simulator in `simulate.ts` instead.
    return { ok: true, simulated: true }
  }

  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      simulated: false,
      error: 'SIMULATE_DISPATCH is false but GITHUB_TOKEN is not set',
    }
  }

  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'run-dashboard',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: inputs.ref ?? 'main',
        inputs: {
          // GitHub requires every workflow input to be a string.
          //
          // The names are the workflow's, not ours, and they do not line up
          // with this dashboard's vocabulary — its `style` picks which package
          // to run, while `scope` takes any tag, service names included.
          //
          // So a service goes to `scope`, not to `style`. Sending it as
          // `style` is what this did originally, and the workflow would have
          // rejected every dispatch: `style` accepts three package names and
          // nothing else. Neither repo could see the mismatch alone.
          run_id: runId,
          scope: inputs.service === 'all' ? inputs.tags : inputs.service,
          style: 'both',
          workers: String(inputs.workers ?? 4),
        },
      }),
    },
  )

  if (!response.ok) {
    return {
      ok: false,
      simulated: false,
      error: `GitHub returned ${response.status}: ${await response.text()}`,
    }
  }

  return { ok: true, simulated: false }
}
