/**
 * How often the run list asks for itself again.
 *
 * It used to ask only while a run it knew about was in flight. A run started
 * somewhere else — a script holding an API key, a colleague on another machine —
 * is not in the list, so nothing was in flight and nothing ever asked: the page
 * sat still until someone reloaded it. So an idle list asks too, slowly.
 */

/** A run is running and someone is watching it finish. */
export const IN_FLIGHT_MS = 2000
/** Nothing is running, so this only has to notice a run that began elsewhere. */
export const IDLE_MS = 15000

/**
 * The wait between asks, or null for none.
 *
 * Asking replaces the list with its first page, which is the right thing for a
 * run in flight — the top is what the reader is watching — and the wrong thing
 * for someone who has scrolled and loaded more: every fifteen seconds the rows
 * under their eyes would be swapped for the first page. An idle list therefore
 * stops asking once more than the first page is on screen; coming back to the
 * tab (see `refreshOnReturn`) still reloads it.
 */
export function pollDelay({
  pending,
  loadedMore,
}: {
  pending: boolean
  loadedMore: boolean
}): number | null {
  if (pending) return IN_FLIGHT_MS
  return loadedMore ? null : IDLE_MS
}

/**
 * Whether coming back to the page should reload it now.
 *
 * Switching to a terminal, running a curl and switching back is the case this is
 * for: waiting out an interval to see the run you just made is a page that looks
 * like it did nothing. The second argument keeps the two events a tab switch
 * raises — focus and visibility — from asking twice.
 */
export const REFRESH_DEBOUNCE_MS = 1000
export function refreshOnReturn(now: number, lastRefreshAt: number): boolean {
  return now - lastRefreshAt >= REFRESH_DEBOUNCE_MS
}
