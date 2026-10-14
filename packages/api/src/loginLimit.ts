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
 * The address a sign-in is counted against: an IPv4 address as it is, an IPv6
 * one by its /64.
 *
 * Counting each IPv6 address separately made the limit per address in a range
 * the client chooses from. A home line or a cloud VM is routinely handed a
 * whole /64, 2^64 addresses, so one machine could give every guess a fresh
 * bucket. The /64 is the smallest block an ISP assigns, so it is the nearest
 * thing to "one client" an IPv6 address says.
 *
 * A request that did not come through Cloudflare's edge has no such header,
 * and every one of those shares a single bucket — the safe direction to be
 * wrong in. So does a header that is not an address.
 */
export function clientAddress(request: Request): string {
  const address = request.headers.get('CF-Connecting-IP')
  if (!address) return 'unknown'
  if (!address.includes(':')) return address
  const prefix = ipv6Prefix64(address)
  return prefix ? `${prefix}::/64` : 'unknown'
}

/**
 * The first four groups of an IPv6 address, written out in full, or null when
 * the text is not one.
 *
 * Written out because `2001:db8::1` and `2001:0db8:0:0::2` are the same /64,
 * and a prefix taken from the text as written would count them apart.
 */
export function ipv6Prefix64(address: string): string | null {
  const text = address.toLowerCase().split('%')[0]!
  const halves = text.split('::')
  if (halves.length > 2) return null
  const groupsOf = (part: string) => (part === '' ? [] : part.split(':'))
  const head = groupsOf(halves[0]!)
  const tail = halves.length === 2 ? groupsOf(halves[1]!) : []
  // A trailing dotted quad (`::ffff:192.0.2.1`) is two groups; only the first
  // four matter here, so it is counted and not decoded.
  const last = tail.length ? tail : head
  const width = last.length && last[last.length - 1]!.includes('.') ? 1 : 0
  const missing = 8 - head.length - tail.length - width
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const prefix = groups.slice(0, 4)
  if (!prefix.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  return prefix.map((g) => g.padStart(4, '0')).join(':')
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
