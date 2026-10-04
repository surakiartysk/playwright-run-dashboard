import { useSyncExternalStore } from 'react'

/**
 * Below this width the run list stops being a table.
 *
 * Six columns need about 620px; under 640 the list scrolled sideways and the
 * result — the one thing a row is for — was the column that left the screen.
 * The breakpoint is shared by name so a test can see that the query and the
 * number in the comment agree.
 */
export const COMPACT_BELOW = 640
export const COMPACT_QUERY = `(max-width: ${COMPACT_BELOW - 1}px)`

/**
 * Whether the viewport is narrow, kept current as it changes.
 *
 * Layout that inline styles cannot express (they have no media queries) is
 * decided here rather than by moving the run list's styles into a stylesheet,
 * which would split one component's look across two files.
 */
export function useCompact(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
      const query = window.matchMedia(COMPACT_QUERY)
      query.addEventListener('change', notify)
      return () => query.removeEventListener('change', notify)
    },
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}
