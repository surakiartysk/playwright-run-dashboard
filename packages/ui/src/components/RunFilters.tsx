import type { CSSProperties } from 'react'
import { isPending, type Run } from '../api'
import { c, status as sc } from '../theme'
import { useMedia } from '../use-compact'
import { Segmented } from './Segmented'

/**
 * Narrowing the run list, client-side.
 *
 * Filtered here rather than by re-fetching with `?status=`, which the API also
 * supports. Filtering locally leaves the fetched set alone, so the summary
 * above keeps describing all the loaded runs while the list narrows to a view
 * of them: a server-side filter would change the set that was fetched, and the
 * summary — derived from exactly those rows — would quietly start describing
 * only the failures, or only the passes.
 *
 * The cost, which grew: this narrows what was loaded, not what exists. That
 * was nearly free when the list stopped at 25 rows and the two were the same
 * thing. They are not any more — "Load more" arrived later, and
 * a reader on page one filtering to Failed is shown the failures among the
 * loaded runs, not among all of them. The footer states the gap in the same
 * breath ("Showing 25 of 91"), which is the only reason this is still the
 * right trade: the reader can see there is more, and load it.
 */

export type StatusFilter = 'all' | 'passed' | 'failed' | 'running'

/** Which statuses each filter admits. */
const MATCHES: Record<StatusFilter, (run: Run) => boolean> = {
  all: () => true,
  passed: (run) => run.status === 'passed',
  // `error` and `timeout` are failures a reader is looking for when they click
  // "Failed" — a run that never produced a result is not a run that passed.
  failed: (run) => run.status === 'failed' || run.status === 'error' || run.status === 'timeout',
  running: (run) => isPending(run.status),
}

export const applyFilter = (runs: Run[], filter: StatusFilter): Run[] =>
  runs.filter(MATCHES[filter])

/** How many rows each option would show, so a count of zero is visible first. */
export function counts(runs: Run[]): Record<StatusFilter, number> {
  return {
    all: runs.length,
    passed: applyFilter(runs, 'passed').length,
    failed: applyFilter(runs, 'failed').length,
    running: applyFilter(runs, 'running').length,
  }
}

const OPTIONS: { value: StatusFilter; label: string; tone?: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'passed', label: 'Passed', tone: sc.pass },
  { value: 'failed', label: 'Failed', tone: sc.fail },
  { value: 'running', label: 'Running', tone: sc.pending },
]

export function RunFilters({
  runs,
  value,
  onChange,
}: {
  runs: Run[]
  value: StatusFilter
  onChange: (next: StatusFilter) => void
}) {
  const n = counts(runs)
  const coarse = useMedia('(pointer: coarse)')

  return (
    <Segmented
      label="Filter runs by status"
      options={OPTIONS.map((option) => {
        const active = option.value === value
        const count = n[option.value]
        // Nothing to show and nothing to learn from choosing it.
        const empty = count === 0 && !active
        return {
          value: option.value,
          disabled: empty,
          label: (
            <>
              {option.tone && (
                <span
                  style={{
                    ...s.dot,
                    background: option.tone,
                    // Dimmed rather than hidden: the row keeps its shape, so the
                    // tabs do not shift as counts change under a poll.
                    opacity: empty ? 0.35 : 1,
                  }}
                />
              )}
              {option.label}
              <span style={{ ...s.count, ...(active ? s.countActive : null) }}>{count}</span>
            </>
          ),
        }
      })}
      value={value}
      onChange={onChange}
      style={coarse ? s.wrapCoarse : undefined}
    />
  )
}

const s: Record<string, CSSProperties> = {
  /*
    On a touch screen every button answers a 44px tap (index.html), 8px past a
    28px tab above and below. When the tabs wrap, 3px between rows let the
    second row's tap areas cover the first's: a tap on the bottom of "All" hit
    "Running" instead, disabled at 0 and so doing nothing. 16px keeps them apart.
  */
  wrapCoarse: { rowGap: 16 },

  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },

  count: {
    fontSize: 12,
    color: c.t5,
    fontVariantNumeric: 'tabular-nums',
  },
  countActive: { color: c.t3 },
}
