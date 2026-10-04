import type { Bindings, Suite } from './types'
import { resolveTarget } from './github'

/**
 * The branches that exist in a suite's repository.
 *
 * Asked of GitHub rather than assumed, and remembered for five minutes: the run
 * form reads this on every load, and the list changes when someone pushes a
 * branch, not when someone opens a page. Remembered per isolate, which is a weak
 * cache — an isolate that restarts asks again — and that is the right strength:
 * a stale entry costs a form that offers a branch gone a few minutes ago, and a
 * strong cache would be something else to invalidate.
 *
 * Returns null when it could not find out: no token, no repository configured,
 * GitHub refusing or unreachable. Callers treat null as "do not know", never as
 * "there are none" — see `refsFor`.
 */
const CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; branches: string[] | null }>()

/** For tests: a fresh isolate remembers nothing. */
export const clearBranchCache = () => cache.clear()

export async function suiteBranches(
  env: Bindings,
  suite: Suite,
  now: number = Date.now(),
): Promise<string[] | null> {
  const target = resolveTarget(env, suite)
  if (!target || !env.GITHUB_TOKEN) return null

  const hit = cache.get(target.repo)
  if (hit && now - hit.at < CACHE_MS) return hit.branches

  let branches: string[] | null = null
  try {
    const response = await fetch(
      `https://api.github.com/repos/${target.repo}/branches?per_page=100`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'User-Agent': 'run-dashboard',
        },
      },
    )
    if (response.ok) {
      const body = (await response.json()) as { name?: unknown }[]
      branches = body.map((b) => b.name).filter((n): n is string => typeof n === 'string')
    }
  } catch {
    // Unreachable is not a verdict on what exists.
  }

  // A failure is remembered too, briefly: without that, a GitHub outage makes
  // every page load wait on a request that is going to fail.
  cache.set(target.repo, { at: now, branches })
  return branches
}
