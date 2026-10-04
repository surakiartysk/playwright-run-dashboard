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
 * Above this width the summary moves into a column beside the run list.
 *
 * The list wants about 620px and the column 320, with the gap and the page's
 * padding around them; below that the two would squeeze each other, so the
 * column folds back into one stack, summary first.
 */
export const WIDE_FROM = 1000
export const WIDE_QUERY = `(min-width: ${WIDE_FROM}px)`

/**
 * Whether a media query matches, kept current as it changes.
 *
 * Layout that inline styles cannot express (they have no media queries) is
 * decided here rather than by moving a component's styles into a stylesheet,
 * which would split one component's look across two files.
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  )
}

export const useCompact = () => useMedia(COMPACT_QUERY)
export const useWide = () => useMedia(WIDE_QUERY)
