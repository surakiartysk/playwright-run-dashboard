/**
 * How many wrong admin keys one account may try in a window before the key
 * stops being checked. See decision 28, which set the numbers for passwords,
 * and decision 52, which moved them to the admin key.
 *
 * Ten in fifteen minutes is generous to a person and slow for a script. Counted
 * per account in a sandbox, not per address: the account is who is asking, and
 * an address is shared by a NAT and changed at will over IPv6.
 */
export const LOGIN_ATTEMPTS_ALLOWED = 10
export const LOGIN_WINDOW_MINUTES = 15

/**
 * Charges one attempt and says whether the caller is still within its limit.
 *
 * Charged *before* the key is checked, in one statement that increments
 * and reads back. The obvious order — check the count, compare the key,
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
 * Gives back the attempt a correct key was charged.
 *
 * Takes back one, never the whole count: a success that reset the counter would
 * let whoever holds the key clear it between someone else's guesses.
 */
export async function refundAttempt(db: D1Database, client: string): Promise<void> {
  await db
    .prepare(`UPDATE login_attempts SET attempts = attempts - 1 WHERE client = ?1 AND attempts > 0`)
    .bind(client)
    .run()
}
