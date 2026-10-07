import { REPORT_MIN_AGE_MS, REPORTS_KEPT, REPORTS_REMOVED_PER_SWEEP } from './config'

/**
 * How long a stored report is kept.
 *
 * A run's row is the record that it happened. Its report is the detail behind it
 * (every request and response, several megabytes) and the only thing here that
 * grows without bound. Nothing removed reports but an admin deleting a whole
 * run, so a bucket would fill at the rate runs were made.
 *
 * The rule is the one for a log someone may need to look back through: remove
 * the oldest, only when there are too many, and never the recent. A report goes
 * when it is outside the newest {@link REPORTS_KEPT} that still have one *and*
 * older than {@link REPORT_MIN_AGE_MS}. Either alone is wrong. A count alone
 * lets a busy day push out last week; an age alone deletes a quiet month's
 * history for no reason, since a bucket holding twenty reports costs nothing.
 *
 * Only the report goes. The row stays, with `report_removed_at` saying so, so
 * "this passed on that day" outlives the evidence behind it.
 */

export interface RetentionOptions {
  keep?: number
  minAgeMs?: number
  batch?: number
}

/**
 * Delete every object a run stored.
 *
 * Keyed on `runs/{id}/` — this run's own prefix — and never on the directory of
 * its `report_path`. The two are the same for a real run and are not for a
 * simulated one, which points `report_path` at the shared demo report that
 * dozens of other rows also point at. Deleting "the report this row names"
 * reads like the more correct rule and would wipe that shared report the first
 * time a run was tidied away, surfacing later and elsewhere as a report that
 * 404s for every other simulated run.
 *
 * Walked with a cursor rather than listed once, and the reason is narrower than
 * it looks. Every report this system stores today is a *single* object: both
 * suites build Allure with `--single-file`, and their workflows upload exactly
 * `runs/{runId}/index.html`. One `list` would be enough, and it was.
 *
 * What it would not be is enough *by construction*. R2 returns at most 1000 keys
 * per call, so a single `list` is correct only while something outside this
 * repository keeps choosing to inline the report — a flag in the suites
 * (`SINGLE_FILE`), not a property of this code. The multi-file form is ~450
 * objects, and nothing here would notice the day it arrived: the delete would
 * silently keep whatever it did not see, and answer with a count that was
 * really the page size.
 *
 * So this is not a fix for a leak that was happening. It is refusing to hold a
 * correctness argument that depends on another repository's build flag.
 *
 * Deleted page by page rather than collecting every key first: if a report ever
 * is large, accumulating its whole key list in memory to save a few round trips
 * trades one unbounded thing for another.
 *
 * @returns how many objects were deleted
 */
export async function deleteRunReport(bucket: R2Bucket, runId: string): Promise<number> {
  let deleted = 0
  let cursor: string | undefined

  for (;;) {
    const listed = await bucket.list({ prefix: `runs/${runId}/`, cursor })
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map((object) => bucket.delete(object.key)))
      deleted += listed.objects.length
    }
    if (!listed.truncated) break
    cursor = listed.cursor
  }

  return deleted
}

/**
 * Remove the reports that are both beyond the newest `keep` and older than
 * `minAgeMs`, oldest first, at most `batch` of them.
 *
 * Only a report stored under `runs/` is a candidate, in the ranking as well as in
 * the removal. A simulated run points at the shared sample, which no run owns
 * and none may delete, and counting those would let a day of demo clicks push
 * a real report out of the newest `keep`.
 *
 * The objects go first and the row is updated after. A failure between them
 * leaves a row that still names a report that is gone, which the next sweep
 * finds again and finishes (listing nothing is not an error), where the other
 * order would leave a stored report nothing points at, forever.
 *
 * @returns how many reports were removed
 */
export async function pruneReports(
  db: D1Database,
  bucket: R2Bucket,
  now: number = Date.now(),
  {
    keep = REPORTS_KEPT,
    minAgeMs = REPORT_MIN_AGE_MS,
    batch = REPORTS_REMOVED_PER_SWEEP,
  }: RetentionOptions = {},
): Promise<number> {
  const cutoff = new Date(now - minAgeMs).toISOString()

  const { results } = await db
    .prepare(
      `SELECT id FROM runs
        WHERE report_path LIKE 'runs/%'
          AND started_at < ?1
          AND id NOT IN (
            SELECT id FROM runs
             WHERE report_path LIKE 'runs/%'
             ORDER BY started_at DESC
             LIMIT ?2
          )
        ORDER BY started_at ASC
        LIMIT ?3`,
    )
    .bind(cutoff, keep, batch)
    .all<{ id: string }>()

  const removedAt = new Date(now).toISOString()
  for (const { id } of results) {
    await deleteRunReport(bucket, id)
    await db
      .prepare(`UPDATE runs SET report_path = NULL, report_removed_at = ?2 WHERE id = ?1`)
      .bind(id, removedAt)
      .run()
  }

  return results.length
}
