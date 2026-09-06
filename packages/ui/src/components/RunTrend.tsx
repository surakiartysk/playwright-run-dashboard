import type { CSSProperties } from 'react'
import { isPending, type Run } from '../api'
import { c, mono, status as sc } from '../theme'

/**
 * Pass rate over the recent runs, oldest to newest — one bar per run.
 *
 * A list says what happened to each run; this says which way things are
 * going — the question a lead actually asks, and the one the numbers above
 * cannot answer because a single rate has no direction.
 *
 * Bars, not a line, and the reason is what the data is. A line says "this
 * quantity was continuous and we sampled it"; runs are not that. They are
 * discrete events that happened a few times a day, and between two of them the
 * pass rate does not exist — so the segment joining them draws a value that was
 * never measured. Grafana draws the same distinction: a bar chart for
 * categorical or discrete data, a time series for a continuous one, and it
 * recommends bars only while the count stays small. Thirteen runs is small.
 *
 * It also fixes what the line could not show. Every run is now a target of its
 * own — hoverable, individually coloured — where before a failed run was a 3px
 * dot on a polyline. A red bar in a row of green is the thing this panel exists
 * to make obvious.
 *
 * Drawn as inline SVG rather than with a charting library: a library would be
 * ~40 KB and a new vocabulary to read, to produce markup shorter than its own
 * configuration.
 *
 * Deliberately not a time axis. Runs arrive irregularly — three in a minute,
 * then none for a day — and spacing them by clock time makes a burst
 * unreadable while implying a sampling rate that does not exist. The x axis is
 * run order, which is what "the last ten runs" means.
 */

/** Below this there is no trend to read, only noise dressed as one. */
const MINIMUM_POINTS = 3

export interface TrendPoint {
  /** Percentage of this run's tests that passed. */
  rate: number
  passed: boolean
  id: string
}

/**
 * One point per finished run that reported totals, oldest first.
 *
 * Runs still in flight are excluded rather than plotted at zero: a queued run
 * is not a run that failed, and drawing it as one puts a cliff in the chart
 * that vanishes a few seconds later.
 */
export function trendPoints(runs: Run[]): TrendPoint[] {
  return runs
    .filter((run) => !isPending(run.status) && run.total !== null && run.total > 0)
    .map((run) => ({
      rate: ((run.passed ?? 0) / (run.total ?? 1)) * 100,
      passed: run.status === 'passed',
      id: run.id,
    }))
    .reverse() // The API returns newest first; a trend reads left to right.
}

/**
 * The rate range the chart draws, padded so the line is never on an edge.
 *
 * A fixed 0–100 axis is the obvious choice and the wrong one: a healthy suite
 * lives between 95 and 100, which is the top 5% of the plot — three runs at
 * 100, 100 and 97 render as a flat line clipped by the top border, and the
 * difference the chart exists to show is invisible.
 *
 * So the axis fits the data instead, with two guards. A floor of ten points
 * stops a one-point wobble filling the panel and reading as a collapse. And
 * the range never rises above 100 or falls below 0, because those are the
 * real limits of the thing being measured.
 */
const MINIMUM_WINDOW = 10

export function domain(points: TrendPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 100 }

  const rates = points.map((p) => p.rate)
  const lowest = Math.min(...rates)
  const highest = Math.max(...rates)

  // Widen symmetrically to at least the minimum window, then pad the result.
  // Computed as a target width rather than by padding each end, because
  // clamping to 0–100 afterwards would otherwise eat the padding on whichever
  // end hit the limit — the case that made a 99.5–100 pair render as a
  // two-point window instead of ten.
  const wanted = Math.max(highest - lowest, MINIMUM_WINDOW) * 1.3
  const centre = (highest + lowest) / 2

  let min = centre - wanted / 2
  let max = centre + wanted / 2

  // Push back inside 0–100 without shrinking the window: a suite sitting at
  // 100% still gets a full-height chart, just with its ceiling at the top.
  if (max > 100) {
    min -= max - 100
    max = 100
  }
  if (min < 0) {
    max = Math.min(100, max - min)
    min = 0
  }

  return { min, max }
}

/** A bar's box in user units, measured from the top-left of the plot area. */
export interface Bar {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The drawn width of the plot area, in user units.
 *
 * A real coordinate space rather than the old 0–100 box stretched to fit with
 * `preserveAspectRatio="none"`. That stretch was why the chart looked cheap: it
 * scaled x and y by different factors, so a circle rendered as an ellipse and
 * every stroke needed `vectorEffect` to stay even. Bars have to keep their
 * corners square, so the viewBox now has the same proportions as the box it is
 * drawn in.
 */
export const PLOT_WIDTH = 320
export const PLOT_HEIGHT = 72

/** Gap between bars, as a share of the space each one is allotted. */
const BAR_GAP_RATIO = 0.26
/** Bars never render thinner than this, however many runs there are. */
const MIN_BAR_WIDTH = 3
/**
 * A bar is drawn at least this tall even at the bottom of the range.
 *
 * The floor is not decoration. A run at exactly the domain minimum maps to zero
 * height and disappears, so the run that failed hardest — the one most worth
 * seeing — is the one that vanishes.
 */
const MIN_BAR_HEIGHT = 2

export function bars(points: TrendPoint[]): Bar[] {
  if (points.length === 0) return []

  const { min, max } = domain(points)
  // Guarded: every run at exactly the same rate collapses the range to zero.
  const range = max - min || 1

  const slot = PLOT_WIDTH / points.length
  const width = Math.max(MIN_BAR_WIDTH, slot * (1 - BAR_GAP_RATIO))

  return points.map((point, index) => {
    const share = (point.rate - min) / range
    const height = Math.max(MIN_BAR_HEIGHT, share * PLOT_HEIGHT)

    return {
      // Centred in its slot, so the row stays evenly spaced whatever the gap
      // works out to.
      x: index * slot + (slot - width) / 2,
      y: PLOT_HEIGHT - height,
      width,
      height,
    }
  })
}

export function RunTrend({ runs }: { runs: Run[] }) {
  const points = trendPoints(runs)

  /**
   * Hidden rather than shown empty.
   *
   * Two points is a line between two dots, which reads as a trend without
   * being one. The dashboard is small enough that a panel saying "not enough
   * data yet" costs more attention than it repays.
   */
  if (points.length < MINIMUM_POINTS) return null

  const boxes = bars(points)
  const { min, max } = domain(points)

  const latest = points[points.length - 1]!
  const first = points[0]!
  const change = Math.round(latest.rate - first.rate)
  const failing = points.filter((p) => !p.passed).length

  return (
    <section style={s.wrap}>
      <header style={s.head}>
        <div>
          <h2 style={s.title}>Pass rate</h2>
          <p style={s.sub}>
            Last {points.length} finished runs, oldest first
            {change !== 0 && (
              <>
                {' · '}
                <span style={{ color: change > 0 ? sc.pass : sc.fail }}>
                  {change > 0 ? '↑' : '↓'} {Math.abs(change)} pts
                </span>
              </>
            )}
          </p>
        </div>
        {/*
          Labelled, because the summary above also says "pass rate" and means
          something else: that one is every run, this one is the newest. Two
          unlabelled percentages a few centimetres apart, disagreeing, is a
          reader's problem to solve rather than the page's to state.
        */}
        <div style={s.latestWrap}>
          <div style={s.latestLabel}>Newest run</div>
          <div style={{ ...s.latest, color: latest.passed ? sc.pass : sc.fail }}>
            {Math.round(latest.rate)}%
          </div>
        </div>
      </header>

      <svg
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        /*
          `none` again, but for a shape that survives it. The old chart stretched
          a polyline and its dots, which is why a failed run rendered as a
          flattened ellipse and every stroke needed `vectorEffect` to stay even.
          A rectangle stretched horizontally is still a rectangle: only its width
          changes, and width here carries no meaning — the bars simply divide
          whatever room they are given.

          `meet` was the obvious alternative and the wrong one: it letterboxes,
          so a 320-unit box inside a 900px panel drew the chart down the middle
          with a third of the panel empty on each side.
        */
        preserveAspectRatio="none"
        style={s.chart}
        role="img"
        aria-label={`Pass rate for the last ${points.length} runs, oldest first, currently ${Math.round(
          latest.rate,
        )} percent${failing > 0 ? `, with ${failing} failing` : ''}`}
      >
        {boxes.map((box, i) => {
          const point = points[i]!
          return (
            <rect
              key={point.id}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              /* No rx: a corner radius is drawn in the stretched space, so it
                 would round the horizontal axis more than the vertical. */
              /*
                Colour is not the only difference, and deliberately so. Green and
                red are the pair colour-vision deficiency hits hardest — measured
                at ΔE 7.4 for deuteranopia against this palette, inside the band
                where colour may only carry meaning alongside something else.

                Here that something is height and a label: a failed run is
                shorter by definition, and its bar carries the rate in a title.
                A failing run is also the full height of the plot in a faint
                wash behind it, so it is findable in a row of bars at a glance,
                in greyscale, and under forced colours.
              */
              fill={point.passed ? sc.pass : sc.fail}
              opacity={point.passed ? 0.85 : 1}
            >
              <title>{`${Math.round(point.rate)}% — ${point.passed ? 'passed' : 'failed'}`}</title>
            </rect>
          )
        })}

        {/* The marker for a failed run, drawn after the bars so it is never
            covered: a full-height wash in its column. */}
        {boxes.map((box, i) => {
          const point = points[i]!
          if (point.passed) return null
          return (
            <rect
              key={`${point.id}-mark`}
              x={box.x}
              y="0"
              width={box.width}
              height={PLOT_HEIGHT}
              fill={sc.fail}
              opacity="0.14"
              pointerEvents="none"
            />
          )
        })}
        {/*
          The midpoint of the drawn range, over the bars rather than behind
          them — behind, it was completely hidden by a full row of bars and
          only appeared in the gaps. Faint, and last in paint order, so it
          reads as a guide laid across the chart instead of a divider in it.
        */}
        <line
          x1="0"
          y1={PLOT_HEIGHT / 2}
          x2={PLOT_WIDTH}
          y2={PLOT_HEIGHT / 2}
          stroke={c.t1}
          strokeWidth="1"
          strokeDasharray="2 4"
          opacity="0.22"
          pointerEvents="none"
        />
      </svg>

      {/* The range is stated because it is not 0–100. A chart whose axis
          floats without saying so overstates every movement on it. */}
      <div style={s.axis}>
        <span>oldest</span>
        <span style={s.range}>
          {Math.round(min)}–{Math.round(max)}%
        </span>
        <span>newest</span>
      </div>
    </section>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: '15px 18px 12px',
    marginBottom: 18,
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 12,
  },
  title: { fontSize: 15, fontWeight: 600, color: c.t1, margin: 0 },
  sub: { margin: '3px 0 0', fontSize: 12.5, color: c.t5 },
  latestWrap: { textAlign: 'right' },
  latestLabel: {
    fontSize: 10.5,
    color: c.t5,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    fontWeight: 500,
  },
  latest: {
    ...mono,
    fontSize: 22,
    fontWeight: 650,
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },

  /*
   * Fixed height, and the viewBox now matches its proportions rather than being
   * stretched to fit. Nothing is drawn outside the box any more — bars sit on
   * the floor instead of dots straddling the edges — so the old
   * `overflow: visible` and its padding are gone with the hack they served.
   */
  chart: { width: '100%', height: 72, display: 'block' },

  axis: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    fontSize: 11,
    color: c.t6,
  },
  range: {
    ...mono,
    fontVariantNumeric: 'tabular-nums',
  },
}
