/**
 * How long until a limit that counts a sliding window has room again.
 *
 * A limit like "ten runs an hour" is a count of rows newer than an hour, so it
 * does not reset on the hour: it opens when the oldest counted row ages out. A
 * script that is told only "within the hour" has to guess, and guesses either
 * way — retrying every second, or sleeping a full hour for a wait of a minute.
 * This gives the exact wait for `Retry-After`.
 *
 * Asked only after a refusal, so the extra query costs nothing on the path that
 * is not being limited.
 *
 * `from`, `where` and `column` are written by the caller as constants, never
 * taken from a request; the values go through `params`.
 */
export async function secondsUntilRoom(
  db: D1Database,
  query: {
    from: string
    where: string
    column: string
    params: unknown[]
    /** What the limit counts now. */
    count: number
    limit: number
    /** How long a counted row stays counted: an hour, or 0 when `column` is when it stops counting. */
    holdMs: number
    /**
     * The longest this wait can honestly be: the window for a sliding count, a
     * key's lifetime for a cap that opens when one expires. Also what is
     * answered when there is no row to work it out from.
     */
    atMostMs: number
  },
  now: number = Date.now(),
): Promise<number> {
  const { from, where, column, params, count, limit, holdMs, atMostMs } = query
  // Room opens when the count falls below the limit: that many of the oldest
  // rows have to stop counting, and the last of them is the one that matters.
  const skip = Math.max(0, count - limit)
  const row = await db
    .prepare(
      `SELECT ${column} AS at FROM ${from} WHERE ${where}
        ORDER BY ${column} ASC LIMIT 1 OFFSET ?${params.length + 1}`,
    )
    .bind(...params, skip)
    .first<{ at: string }>()

  const opens = row ? Date.parse(row.at) + holdMs : NaN
  if (Number.isNaN(opens)) return Math.ceil(atMostMs / 1000)
  // At least a second: zero would invite an immediate retry into the same wall.
  // At most `atMostMs`, since nothing counted stays longer than that.
  const seconds = Math.ceil((opens - now) / 1000)
  return Math.min(Math.max(seconds, 1), Math.ceil(atMostMs / 1000))
}
