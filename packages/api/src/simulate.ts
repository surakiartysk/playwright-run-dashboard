import type { Bindings, RunStatus } from './types'
import { DEMO_REPORT_PREFIX } from './config'

/**
 * Walks a simulated run through the states a real one would pass through.
 *
 * Runs for any caller whose dispatch was simulated — `SIMULATE_DISPATCH` being
 * on, or the `demo` role, which always simulates (decision 12). It exists so
 * the dashboard can be *used* — queued, then running, then a result and a
 * report — rather than demonstrated with a screenshot.
 *
 * It writes no report of its own: it points `report_path` at one real Allure
 * report stored under `DEMO_REPORT_PREFIX`, because "the link works" is the
 * part most likely to be broken and least likely to be checked, and a genuine
 * report shows that better than a stand-in page could.
 *
 * Deliberately not a background queue: Workers give us `waitUntil`, and a run
 * that takes a few seconds is enough to see the UI poll and update.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface SimulatedOutcome {
  status: RunStatus
  total: number
  passed: number
  failed: number
}

/**
 * Most runs pass. A failure appears roughly one time in five so the red path
 * is reachable without editing code — the state nobody remembers to design for
 * until it happens in front of someone.
 */
function outcome(service: string): SimulatedOutcome {
  const total = service === 'all' ? 83 : 20 + Math.floor(Math.random() * 30)
  const shouldFail = Math.random() < 0.2

  if (!shouldFail) return { status: 'passed', total, passed: total, failed: 0 }

  const failed = 1 + Math.floor(Math.random() * 3)
  return { status: 'failed', total, passed: total - failed, failed }
}

export async function simulateRun(env: Bindings, runId: string, service: string): Promise<void> {
  // Queued → running, fast enough that a user watching sees the transition.
  await sleep(1500)
  await env.DB.prepare(`UPDATE runs SET status = 'running' WHERE id = ?1 AND status = 'queued'`)
    .bind(runId)
    .run()

  await sleep(2500 + Math.random() * 2000)

  const result = outcome(service)

  /**
   * Points at the shared Allure report rather than writing one.
   *
   * A copy per simulated run would be several megabytes of duplicate stored
   * every time, all identical. `scripts/upload-demo-report.mjs` puts one
   * there, `routes/reports.ts` serves whatever prefix this row names, and a
   * simulated run gets a genuine report instead of a stand-in page.
   *
   * The numbers above it are still this run's own — only the report body is
   * shared, and it is honest about being a sample rather than these results.
   */
  const reportPath = `${DEMO_REPORT_PREFIX}/index.html`

  // Only finishes a run still in flight.
  //
  // Without this the simulator races a real webhook: both write the same row,
  // and whichever lands second wins. Locally that is reachable — post a signed
  // webhook for a simulated run and the simulator overwrites the result a
  // second later, which looks like the webhook silently failing. Found by
  // testing a correctly-signed callback rather than only the rejected ones.
  await env.DB.prepare(
    `UPDATE runs
        SET status = ?2, total = ?3, passed = ?4, failed = ?5,
            finished_at = ?6, duration_ms = ?7, report_path = ?8
      WHERE id = ?1
        AND status IN ('queued', 'running')`,
  )
    .bind(
      runId,
      result.status,
      result.total,
      result.passed,
      result.failed,
      new Date().toISOString(),
      3000 + Math.floor(Math.random() * 3000),
      reportPath,
    )
    .run()
}
