import type { CSSProperties } from 'react'
import { isPending, type Run } from '../api'
import { c, mono, status as sc } from '../theme'

/**
 * What the run list adds up to, above the list itself.
 *
 * The list answers "what happened to this run"; a reader scanning it for
 * "is the suite healthy" has to do the arithmetic themselves. These four
 * numbers are that arithmetic.
 *
 * Derived from the runs already on screen rather than fetched separately, so
 * the figures cannot disagree with the rows beneath them — a summary that
 * says 80% while the visible list shows two of three failing is worse than no
 * summary. It also means the scoping comes free: a `dev` sees stats for the
 * runs a `dev` may see, because those are the only rows there are.
 */
export interface RunSummary {
  total: number
  finished: number
  inFlight: number
  failing: number
  /** Percentage of finished runs that passed, or null when none have. */
  rate: number | null
  /** Median duration in ms, or null when nothing has timed yet. */
  median: number | null
}

/**
 * The arithmetic, separated from the markup so it can be tested.
 *
 * Pass rate counts **runs, not tests**. Averaging each run's own pass rate
 * would let a 500-test run and a 3-test one weigh the same; summing tests
 * across runs would let one big green run bury a small red one. "How many
 * runs came back green" is the question the list already answers, so the
 * summary answers the same one.
 */
export function summarise(runs: Run[]): RunSummary {
  const finished = runs.filter((run) => !isPending(run.status))
  const passed = finished.filter((run) => run.status === 'passed').length
  const durations = finished.map((run) => run.durationMs).filter((ms): ms is number => ms !== null)

  return {
    total: runs.length,
    finished: finished.length,
    inFlight: runs.length - finished.length,
    failing: finished.length - passed,
    rate: finished.length > 0 ? Math.round((passed / finished.length) * 100) : null,
    median: durations.length > 0 ? medianOf(durations) : null,
  }
}

export function RunStats({ runs }: { runs: Run[] }) {
  // Nothing to summarise, and an empty bar of zeroes reads as a broken widget.
  if (runs.length === 0) return null

  const { total, finished, inFlight, failing, rate, median } = summarise(runs)

  return (
    <div style={s.wrap}>
      <Stat
        label="Runs"
        value={String(total)}
        note={inFlight > 0 ? `${inFlight} in flight` : null}
      />
      <Stat
        label="Pass rate"
        value={rate === null ? '—' : `${rate}%`}
        tone={rate === null ? undefined : rate === 100 ? sc.pass : rate >= 80 ? undefined : sc.fail}
        note={finished > 0 ? `of ${finished} finished` : 'none finished yet'}
      />
      <Stat
        label="Failing"
        value={String(failing)}
        tone={failing > 0 ? sc.fail : undefined}
        note={failing === 0 && finished > 0 ? 'all green' : null}
      />
      <Stat
        label="Median run"
        value={median === null ? '—' : `${(median / 1000).toFixed(1)}s`}
        note={median === null ? 'no timings yet' : null}
      />
    </div>
  )
}

/**
 * Median rather than mean: one run that timed out at thirty seconds should not
 * move the number a reader uses to answer "how long will mine take".
 */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string | null
  tone?: string
}) {
  return (
    <div style={s.stat}>
      <div style={s.label}>{label}</div>
      <div style={{ ...s.value, ...(tone ? { color: tone } : null) }}>{value}</div>
      {note && <div style={s.note}>{note}</div>}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  /*
   * The summary reads as the page's masthead, not as another widget.
   *
   * It used to be a bordered, rounded card — the same treatment as the trigger
   * form, the gate and every run below it. When each block is boxed identically
   * nothing is louder than anything else, and the figures that answer "is
   * everything all right?" had to compete with a form. Border, radius and fill
   * each say "separate object"; spending them on all five blocks spends them on
   * none. Here they are dropped entirely and a single rule separates the
   * summary from the detail.
   */
  wrap: {
    display: 'grid',
    // Wraps to two columns on a narrow screen rather than scrolling sideways.
    gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))',
    gap: '4px 32px',
    padding: '0 2px 20px',
    borderBottom: `1px solid ${c.border}`,
    marginBottom: 22,
  },
  stat: {},
  label: {
    fontSize: 10.5,
    color: c.t5,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    fontWeight: 500,
  },
  value: {
    ...mono,
    fontSize: 27,
    fontWeight: 600,
    color: c.t1,
    letterSpacing: '-0.03em',
    margin: '4px 0 0',
    lineHeight: 1.05,
  },
  note: { fontSize: 11.5, color: c.t5, marginTop: 4 },
}
