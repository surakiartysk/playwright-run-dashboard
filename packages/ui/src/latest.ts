/**
 * A request whose answer is used only if nothing newer was asked since.
 *
 * The run list is asked for on a poll, on focus, when a filter changes, when
 * "Load more" is pressed, and again by the next person to sign in on the same
 * tab. Each of those used to apply its answer whenever it arrived — so a list
 * asked for by an admin, answering after the admin had signed out, filled the
 * next `dev`'s screen with runs from branches the server never sends a `dev`.
 * Visibility is enforced in the query; a page that applies a stale answer to a
 * different session walks around it.
 *
 * `null` is the superseded answer, and the type is the point: a caller cannot
 * read a page without first deciding what to do when there is none. An error
 * from a superseded request is swallowed the same way — a stale 401 or 500 is
 * no more about the current list than a stale page is.
 */
export function latestOnly<Args extends unknown[], T>(ask: (...args: Args) => Promise<T>) {
  let asked = 0

  return {
    async ask(...args: Args): Promise<T | null> {
      const mine = ++asked
      try {
        const value = await ask(...args)
        return mine === asked ? value : null
      } catch (error) {
        if (mine !== asked) return null
        throw error
      }
    },

    /** Makes every request already in flight superseded, as a sign-out must. */
    forget() {
      asked++
    },
  }
}
