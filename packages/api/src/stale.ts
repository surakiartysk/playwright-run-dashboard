/**
 * Runs that nobody is going to finish.
 *
 * A run reaches a final state because something tells the dashboard: the
 * workflow's signed callback for a real one, the simulator for a simulated one.
 * Either can fail to arrive — a runner lost mid-job, a workflow cancelled from
 * the Actions tab, an isolate that died with a simulation half-run — and then
 * nothing ever changes the row. It stays `queued` or `running` for good, the
 * history shows an amber spinner on a run from last week, and the page polls
 * every two seconds for as long as it is open, because it polls while anything
 * is in flight.
 *
 * `timeout` exists as a status and had no producer: the column accepted it and
 * nothing wrote it. This is the producer.
 */

/**
 * How long a run may stay unfinished before it is called a timeout.
 *
 * The suites' workflows are given 20 minutes (`timeout-minutes: 20`), so a run
 * that is still unfinished after thirty has outlived the job that would have
 * reported it, with ten minutes for GitHub to queue it. Longer would leave a
 * dead run looking alive for no reason; shorter would call a slow run dead.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000

/**
 * Mark every run that has been in flight longer than {@link STALE_AFTER_MS}
 * as a timeout.
 *
 * Compared as ISO strings, which sort the same as the instants they name
 * because every `started_at` is written by `toISOString()`. Strictly older than
 * the cutoff: a run exactly at the limit still has its full time.
 *
 * Only `queued` and `running` are touched. A run that has a result keeps it,
 * and a run the dispatch already failed (`error`) keeps that.
 *
 * It does not forbid the real result arriving later. The webhook updates by id
 * with no condition on the current status, so a callback that turns up after
 * the sweep replaces `timeout` with what actually happened — which is better
 * information than the guess this wrote.
 *
 * @returns how many runs were marked
 */
export async function sweepStaleRuns(db: D1Database, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - STALE_AFTER_MS).toISOString()
  const result = await db
    .prepare(
      `UPDATE runs
          SET status = 'timeout', finished_at = ?1
        WHERE status IN ('queued', 'running') AND started_at < ?2`,
    )
    .bind(new Date(now).toISOString(), cutoff)
    .run()
  return result.meta.changes
}
