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

/**
 * Note on a run which commit its branch pointed at when it was dispatched.
 *
 * The workflow reports the commit it actually ran, but only when it finishes;
 * until then a queued or running row could say nothing about what it was
 * running. This asks GitHub what the branch is now and writes that down, so the
 * row is useful from the moment it exists.
 *
 * It is a guess that the callback corrects: a push to the branch while the run
 * waited in GitHub's queue means the workflow runs a newer commit, and the
 * callback's `suite_sha` replaces this one. The other way round — the callback
 * arriving first — is why this writes only where there is nothing yet.
 *
 * Never throws and never delays the response: it is run after the dispatch has
 * succeeded, and a missing sha is a row that says less, not a run that failed.
 */
export async function recordRefSha(
  env: Bindings,
  runId: string,
  suite: Suite,
  ref: string,
): Promise<void> {
  const target = resolveTarget(env, suite)
  if (!target || !env.GITHUB_TOKEN) return

  try {
    const response = await fetch(
      `https://api.github.com/repos/${target.repo}/commits/${encodeURIComponent(ref)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'User-Agent': 'run-dashboard',
        },
      },
    )
    if (!response.ok) return
    const { sha } = (await response.json()) as { sha?: unknown }
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) return

    await env.DB.prepare(`UPDATE runs SET suite_sha = COALESCE(suite_sha, ?2) WHERE id = ?1`)
      .bind(runId, sha)
      .run()
  } catch {
    // See above: not knowing is allowed.
  }
}
