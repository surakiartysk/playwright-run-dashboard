import { useSyncExternalStore } from 'react'

/** The table's `minWidth`: below it the columns stop being readable. */
export const TABLE_NEEDS = 620
/** The page's padding and the table's border either side, around the table. */
export const PAGE_GUTTER = 50

/**
 * Below this width the run list stops being a table.
 *
 * Under it the list scrolled sideways and the result — the one thing a row is
 * for — was the column that left the screen. It was 640, compared with the
 * table's 620 as if the table had the whole viewport; it has the viewport less
 * the gutter, so between 640 and 669 the table was still 30px wider than its
 * box. The breakpoint is shared by name so a test can hold it to the sum.
 */
export const COMPACT_BELOW = 680
export const COMPACT_QUERY = `(max-width: ${COMPACT_BELOW - 1}px)`

/** The summary column beside the list, and the gap between them. */
export const ASIDE_WIDTH = 320
export const COLUMN_GAP = 24

/**
 * Above this width the summary moves into a column beside the run list.
 *
 * Below it the two would squeeze each other, so the column folds back into one
 * stack, summary first. It was 1000, which left the table 606px of the 620 it
 * needs between 1000 and 1013 wide — the sum is what decides it now.
 */
export const WIDE_FROM = 1020
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
