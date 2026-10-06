import type { CSSProperties } from 'react'
import { isPending, type Run } from '../api'
import { c, mono, status as sc } from '../theme'
import { Collapsible } from './Collapsible'

/**
 * What the run list adds up to, above the list itself.
 *
 * The list answers "what happened to this run"; a reader scanning it for
 * "is the suite healthy" has to do the arithmetic themselves. These four
 * numbers are that arithmetic.
 *
 * Derived from the loaded runs rather than fetched separately, so the figures
 * describe the same rows the list draws from — a summary that says 80% while
 * the unfiltered list shows two of three failing is worse than no summary. A
 * status filter narrows the list, not these. It also means the scoping comes free: a `dev` sees stats for the
 * runs a `dev` may see, because those are the only rows there are.
 */
export interface RunSummary {
  /** Every run the caller may see — what "Runs" means to a reader. */
  available: number
  /** The runs loaded, which every other figure here is computed from. */
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
export function summarise(runs: Run[], available: number = runs.length): RunSummary {
  const finished = runs.filter((run) => !isPending(run.status))
  const passed = finished.filter((run) => run.status === 'passed').length
  const durations = finished.map((run) => run.durationMs).filter((ms): ms is number => ms !== null)

  return {
    available: Math.max(available, runs.length),
    total: runs.length,
    finished: finished.length,
    inFlight: runs.length - finished.length,
    failing: finished.length - passed,
    rate: finished.length > 0 ? Math.round((passed / finished.length) * 100) : null,
    median: durations.length > 0 ? medianOf(durations) : null,
  }
}

/**
 * What the footnote under the figures says when they do not cover every run.
 *
 * The list pages and the figures are computed from what is loaded, so after
 * "Showing 25 of 140" a reader would otherwise take "Failing 3" for a fact
 * about 140. Said only when it is not true of all of them: a footnote on every
 * dashboard would be one nobody read on the day it mattered.
 */
export function coverage(summary: Pick<RunSummary, 'available' | 'total'>): string | null {
  return summary.available > summary.total
    ? `Figures cover the newest ${summary.total} of ${summary.available} runs.`
    : null
}

/**
 * The ring's fill, as a CSS background.
 *
 * Share passed in green, the rest in red, starting at twelve o'clock. With
 * nothing finished there is no share to draw, so it is an empty track rather
 * than a ring at 0%, which would read as "everything failed". The percentage is
 * in the middle as text, so the ring is never the only way to read it.
 */
export function ringBackground(rate: number | null): string {
  if (rate === null) return c.divider
  const share = Math.min(100, Math.max(0, rate))
  return `conic-gradient(${sc.pass} 0 ${share}%, ${sc.fail} ${share}% 100%)`
}

/**
 * What the folded summary says about itself, on the one line it costs.
 *
 * On a phone the card was 307px of a 667px screen and put the Run button below
 * the fold, so the stacked layout folds it like the chart and the role panel
 * beside it. Shut, it still has to answer the question the card answers —
 * is the suite healthy — so the figure and the verdict are here, and an
 * unfinished run is said too: a green ring while something is running is not
 * the whole picture.
 */
export function statsHint(
  summary: Pick<RunSummary, 'finished' | 'inFlight' | 'failing' | 'rate'>,
): string {
  const { finished, inFlight, failing, rate } = summary
  const parts =
    rate === null
      ? ['none finished yet']
      : [`${rate}% of ${finished}`, failing === 0 ? 'all green' : `${failing} failing`]
  if (inFlight > 0) parts.push(`${inFlight} in flight`)
  return parts.join(' · ')
}

/**
 * `total` is every run the caller may see. "Runs" shows it, because the list
 * beside it says "Showing 25 of 140" and a tile reading 25 contradicts that;
 * the other figures are computed from the loaded runs, and the footnote says
 * so whenever that is fewer.
 */
export function RunStats({
  runs,
  total: available,
  collapsible = false,
}: {
  runs: Run[]
  total: number
  collapsible?: boolean
}) {
  // Nothing to summarise, and a panel of zeroes reads as a broken widget.
  if (runs.length === 0) return null

  const summary = summarise(runs, available)
  const { available: all, finished, inFlight, failing, rate, median } = summary
  const footnote = coverage(summary)

  const card = (
    <section style={collapsible ? { ...s.wrap, marginBottom: 0 } : s.wrap} aria-label="Summary">
      <div style={s.ringRow}>
        <div
          style={{ ...s.ring, background: ringBackground(rate) }}
          role="img"
          aria-label={
            rate === null ? 'No finished runs yet' : `${rate} percent of finished runs passed`
          }
        >
          <div style={s.ringInner}>{rate === null ? '—' : `${rate}%`}</div>
        </div>
        <div>
          <div style={s.ringTitle}>Pass rate</div>
          <div style={s.note}>
            {finished > 0
              ? `of ${finished} finished run${finished > 1 ? 's' : ''}. Counts runs, not tests.`
              : 'none finished yet'}
          </div>
        </div>
      </div>

      <div style={s.tiles}>
        <Stat label="Runs" value={String(all)} />
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
        <Stat label="In flight" value={String(inFlight)} tone={inFlight > 0 ? c.warn : undefined} />
      </div>

      {footnote && <p style={s.footnote}>{footnote}</p>}
    </section>
  )

  return collapsible ? (
    <Collapsible title="Pass rate" hint={statsHint(summary)}>
      {card}
    </Collapsible>
  ) : (
    card
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

/**
 * What the summary column says before there is anything to sum.
 *
 * With no runs both the stats and the chart draw nothing, which left a 320px
 * column beside the list empty — a visitor on a fresh deploy saw a blank half
 * of the page and no reason for it. Shown only where the column is.
 */
export function EmptySummary() {
  return (
    <section style={{ ...s.wrap, ...s.empty }}>
      The pass rate and the run-by-run chart appear here once there are runs to count.
    </section>
  )
}

const s: Record<string, CSSProperties> = {
  empty: { color: c.t4, fontSize: 13, lineHeight: 1.5 },
  wrap: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: 18,
    marginBottom: 18,
  },
  ringRow: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 },
  ring: {
    width: 96,
    height: 96,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
  },
  ringInner: {
    ...mono,
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: c.card,
    display: 'grid',
    placeItems: 'center',
    fontSize: 20,
    fontWeight: 700,
    color: c.t1,
  },
  ringTitle: { fontSize: 15, fontWeight: 600, color: c.t1, marginBottom: 4 },
  tiles: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  stat: {
    padding: '10px 12px',
    borderRadius: 10,
    background: c.bg,
    border: `1px solid ${c.divider}`,
  },
  label: {
    fontSize: 10.5,
    color: c.t5,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    fontWeight: 500,
  },
  value: {
    ...mono,
    fontSize: 22,
    fontWeight: 600,
    color: c.t1,
    letterSpacing: '-0.03em',
    margin: '3px 0 0',
    lineHeight: 1.1,
  },
  note: { fontSize: 12, color: c.t5, marginTop: 3, lineHeight: 1.45 },
  footnote: { fontSize: 12, color: c.t5, margin: '12px 0 0', lineHeight: 1.45 },
}
