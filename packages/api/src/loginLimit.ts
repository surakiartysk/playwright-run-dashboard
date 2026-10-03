/**
 * How many wrong passwords one address may try in a window before sign-in
 * stops checking them. See decision 28.
 *
 * Ten in fifteen minutes is generous to a person and slow for a script: a
 * mistyped password is a handful of tries, while a guesser held to this rate
 * gets forty an hour from any one address — a speed bump in front of a long
 * password, not a substitute for one.
 */
export const LOGIN_ATTEMPTS_ALLOWED = 10
export const LOGIN_WINDOW_MINUTES = 15

/**
 * The address a sign-in is counted against.
 *
 * A request that did not come through Cloudflare's edge has no such header,
 * and every one of those shares a single bucket — the safe direction to be
 * wrong in.
 */
export function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

/**
 * Charges one attempt and says whether the address is still within its limit.
 *
 * Charged *before* the password is checked, in one statement that increments
 * and reads back. The obvious order — check the count, compare the password,
 * record a failure — reads the count before any of the failures it is about to
 * cause, so a script sending its guesses in parallel would have every one of
 * them checked against a count of zero. Here each request sees its own place
 * in the queue.
 */
export async function chargeAttempt(db: D1Database, client: string): Promise<boolean> {
  const now = new Date()
  const windowOpenedAfter = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60 * 1000)

  // In an upsert's SET, unqualified columns are the existing row's values,
  // and every expression sees them as they were before this update.
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (client, attempts, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT (client) DO UPDATE SET
         attempts     = CASE WHEN window_start > ?3 THEN attempts + 1 ELSE 1 END,
         window_start = CASE WHEN window_start > ?3 THEN window_start ELSE ?2 END
       RETURNING attempts`,
    )
    .bind(client, now.toISOString(), windowOpenedAfter.toISOString())
    .first<{ attempts: number }>()

  return (row?.attempts ?? 0) <= LOGIN_ATTEMPTS_ALLOWED
}

/**
 * Gives back the attempt a correct password was charged.
 *
 * Takes back one, never the whole count. `demo`'s password is published, so a
 * success that reset the counter would let anyone clear it between guesses by
 * signing in as `demo` — the limit would hold for exactly as long as nobody
 * read the sign-in screen.
 */
export async function refundAttempt(db: D1Database, client: string): Promise<void> {
  await db
    .prepare(`UPDATE login_attempts SET attempts = attempts - 1 WHERE client = ?1 AND attempts > 0`)
    .bind(client)
    .run()
}
