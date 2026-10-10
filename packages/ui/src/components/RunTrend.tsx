import type { CSSProperties } from 'react'
import { SUITE_LABELS, isPending, type Run, type Suite } from '../api'
import { c, mono, status as sc } from '../theme'
import { relative } from './RunHistory'
import { Collapsible } from './Collapsible'
import { runTag } from '../run-form'

/**
 * Pass rate over the recent runs, oldest to newest — one bar per run.
 *
 * A list says what happened to each run; this says which way things are
 * going — the question someone watching the suite asks, and the one the numbers above
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

/**
 * One bar, in words.
 *
 * Exported for its own test: it is the only place the chart says what a run
 * *was*, and a hover layer is the easiest thing in a UI to break without
 * noticing — nothing renders differently when it goes wrong.
 *
 * Deliberately the same facts the table row shows, in the same order, so the
 * two never tell different stories about the same run.
 *
 * Which is a claim, not a property — and it was false. The failure count was
 * derived here as `total - passed`, while the row prints the count the suite
 * actually reported. Those differ by every test that neither passed nor
 * failed: a run of ten with seven passing, one failing and two skipped drew a
 * row reading `1 failed` beside a bar whose tooltip read `3 failed`. The row
 * already knew better — `resultShares` gives skipped tests a bucket of their
 * own precisely because they are not failures. So the count is carried now
 * rather than inferred, and the wording follows the row: no failures reported,
 * nothing claimed about them.
 */
export function describe(point: TrendPoint): string {
  const ratio = `${point.passedCount}/${point.total}`
  const result = point.passed
    ? `${ratio} passed`
    : point.failed > 0
      ? `${ratio} — ${point.failed} failed`
      : ratio

  return [
    [SUITE_LABELS[point.suite], '·', point.service, runTag(point.tags), '·', point.ref]
      .filter(Boolean)
      .join(' '),
    result,
    `by ${point.startedBy ?? point.triggeredBy} · ${relative(point.startedAt)}`,
  ].join('\n')
}

/** Below this there is no trend to read, only noise dressed as one. */
const MINIMUM_POINTS = 3

export interface TrendPoint {
  /** Percentage of this run's tests that passed. */
  rate: number
  passed: boolean
  id: string
  /*
   * Carried so a bar can say what it is.
   *
   * A bar chart of anonymous bars answers "is it getting worse" and nothing
   * else: a reader who spots the red one still has to go hunting through the
   * table below to find out which run it was. These are what the table's own
   * row shows, so hovering a bar and reading a row tell the same story.
   */
  /*
   * The suite, because the table row shows it.
   *
   * Added when the dashboard learned to dispatch two suites and this chart did
   * not: a red bar could belong to either, and the row it was supposed to
   * agree with had a badge the bar did not. Without it the chart cannot answer
   * "is the UI red, or is it just the API?" — which is the question the suite
   * column exists to make answerable.
   */
  suite: Suite
  service: string
  tags: string
  ref: string
  triggeredBy: string
  startedBy: string | null
  passedCount: number
  /*
   * The failures the suite reported, not the tests that did not pass.
   *
   * Carried rather than derived because `total - passedCount` counts skipped
   * tests as failures, and the table row does not — see `describe`.
   */
  failed: number
  total: number
  startedAt: string
}

/**
 * The most runs the chart draws.
 *
 * The case for bars at the top of this file rests on the count staying small,
 * and nothing kept it small: the chart was fed every run the list had loaded,
 * and "Load more" grows that by a page at a time. Past about a hundred the
 * three-unit minimum width no longer fits in each slot, and bars overlap. So
 * the chart takes the newest thirty — and "Last N finished runs" above it says
 * how many that is.
 */
/**
 * How far the pass rate moved across the window, in words.
 *
 * Neutral, not green for up and red for down: a drop is not a failure, and the
 * colours are kept for results (decision 10). Coloured by direction it showed a
 * green "↑" while the newest run had failed. "1 pt", not "1 pts".
 *
 * Says what it is measured against. "↓ 4 pts" alone, beside "Last 11 finished
 * runs", left a reader to guess between the newest run and the pass rate, and
 * between the oldest run and the one before; the review of the live site found
 * it unexplained. It is the newest run's pass percentage against the oldest
 * run's in the window, so it says that.
 */
export function changeLabel(change: number): string {
  const size = Math.abs(change)
  return `${change > 0 ? '↑' : '↓'} ${size} ${size === 1 ? 'pt' : 'pts'} on the oldest run`
}

export const MAX_TREND_POINTS = 30

/**
 * One point per finished run that reported totals, oldest first — at most
 * MAX_TREND_POINTS, and always the newest ones.
 *
 * Runs still in flight are excluded rather than plotted at zero: a queued run
 * is not a run that failed, and drawing it as one puts a cliff in the chart
 * that vanishes a few seconds later.
 */
export function trendPoints(runs: Run[]): TrendPoint[] {
  return (
    runs
      .filter((run) => !isPending(run.status) && run.total !== null && run.total > 0)
      // Before the reverse: the API is newest first, so these are the newest.
      .slice(0, MAX_TREND_POINTS)
      .map((run) => ({
        rate: ((run.passed ?? 0) / (run.total ?? 1)) * 100,
        passed: run.status === 'passed',
        id: run.id,
        suite: run.suite,
        service: run.service,
        tags: run.tags,
        ref: run.ref,
        triggeredBy: run.triggeredBy,
        startedBy: run.startedBy,
        passedCount: run.passed ?? 0,
        failed: run.failed ?? 0,
        total: run.total ?? 0,
        startedAt: run.startedAt,
      }))
      .reverse()
  ) // The API returns newest first; a trend reads left to right.
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
 * every stroke needed `vectorEffect` to stay even. The chart is still stretched
 * to fit its panel — see the note on `preserveAspectRatio` below — which bars
 * survive where dots did not: a stretched rectangle only changes width.
 */
export const PLOT_WIDTH = 320
export const PLOT_HEIGHT = 104

/**
 * A row of squares under the bars, one per run, all the same height: green for
 * a run that passed, red for one that did not.
 *
 * The bars say how much passed and the strip says whether the run did. They are
 * different questions: a run that failed one test of forty is a nearly full bar
 * with a sliver of red, and "which of these runs went red" should not depend on
 * reading a bar's height or seeing a pale wash behind it.
 */
export const STRIP_HEIGHT = 7
export const STRIP_GAP = 6
/** The drawn height of the whole chart: the plot, the gap, and the strip. */
export const CHART_HEIGHT = PLOT_HEIGHT + STRIP_GAP + STRIP_HEIGHT

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

/**
 * Finished runs inside the chart's window that it does not draw, because they
 * reported no totals — a run that errored before a test ran, or failed with
 * none counted. The pass-rate card counts them and the chart cannot, so beside
 * each other they read as two answers to one question ("25 finished" above,
 * "Last 23" below) unless the chart says what it left out.
 */
export function unchartedRuns(runs: Run[]): number {
  let drawn = 0
  let left = 0
  for (const run of runs) {
    if (isPending(run.status)) continue
    if (run.total !== null && run.total > 0) {
      drawn += 1
      if (drawn >= MAX_TREND_POINTS) break
    } else {
      left += 1
    }
  }
  return left
}

/**
 * How many of the charted runs did not pass, in words.
 *
 * The one thing someone looking at a run history wants, said outright rather
 * than left to be counted off the bars: "which way is it going" is the chart's
 * job, "is anything red" is this line's. A run counts as failed when its status
 * was not `passed` — a run that errored or timed out is not a run that passed.
 */
export function failureSummary(points: TrendPoint[]): { failed: number; text: string } {
  const failed = points.filter((p) => !p.passed).length
  const n = points.length
  if (n === 0) return { failed: 0, text: '' }
  if (failed === 0) return { failed, text: n === 1 ? 'The run passed' : `All ${n} runs passed` }
  return { failed, text: `${failed} of the last ${n} runs did not pass` }
}

/** What the collapsed chart says about itself: how much it covers, and what went wrong. */
export function trendHint(points: TrendPoint[]): string {
  const { failed } = failureSummary(points)
  if (points.length === 0) return ''
  return `Last ${points.length} · ${failed === 0 ? 'all passed' : `${failed} failed`}`
}

export function RunTrend({ runs, collapsible = false }: { runs: Run[]; collapsible?: boolean }) {
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
  const uncharted = unchartedRuns(runs)

  const card = (
    <section style={s.wrap}>
      <header style={s.head}>
        <div>
          {!collapsible && <h2 style={s.title}>Run by run</h2>}
          <p style={s.sub}>
            Last {points.length} finished runs, oldest first
            {uncharted > 0 && ` · ${uncharted} with no results not drawn`}
            {change !== 0 && (
              <>
                {' · '}
                <span style={{ color: c.t3 }}>{changeLabel(change)}</span>
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
          {/*
            Themed text colours rather than the status literals: this is a figure
            to read, 22px and not bold, and the literals are marks. #22c55e on
            white was 2.27:1 and #ef4444 3.76:1, both short of 4.5.
          */}
          <div style={{ ...s.latest, color: latest.passed ? c.pass : c.danger }}>
            {Math.round(latest.rate)}%
          </div>
        </div>
      </header>

      <p style={{ ...s.failureLine, color: failing > 0 ? c.danger : c.t3 }}>
        {failureSummary(points).text}
      </p>

      <svg
        viewBox={`0 0 ${PLOT_WIDTH} ${CHART_HEIGHT}`}
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

                Here that something is a wash and a label. A failing run is
                the full height of the plot in a faint wash behind its bar, so
                it is findable in a row of bars at a glance, in greyscale, and
                under forced colours; and its bar carries the result in a title.
                It is usually shorter as well, but not by definition: a run that
                passed with skipped tests can sit below one that failed a single
                test, so height is not a signal to rely on.
              */
              fill={point.passed ? sc.pass : sc.fail}
              opacity={point.passed ? 0.85 : 1}
            >
              <title>{describe(point)}</title>
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
        {/* The strip: one square per run under its bar, the same height for all. */}
        {boxes.map((box, i) => {
          const point = points[i]!
          return (
            <rect
              key={`${point.id}-status`}
              x={box.x}
              y={PLOT_HEIGHT + STRIP_GAP}
              width={box.width}
              height={STRIP_HEIGHT}
              fill={point.passed ? sc.pass : sc.fail}
              opacity={point.passed ? 0.85 : 1}
            />
          )
        })}
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

      {/*
        What the rightmost bar is, in words.

        The per-bar detail is a `title`, which is a hover layer — and hover does
        not exist on a phone. Naming the newest run here means the chart says
        something concrete on every device, and it is the bar a reader looks at
        first anyway.
      */}
      <p style={s.latestLine}>
        Newest: {SUITE_LABELS[latest.suite]} · {latest.service}{' '}
        {runTag(latest.tags) && `${runTag(latest.tags)} `}· {latest.ref} · {latest.passedCount}/
        {latest.total} by {latest.startedBy ?? latest.triggeredBy}
      </p>
    </section>
  )

  return collapsible ? (
    <Collapsible title="Run by run" hint={trendHint(points)}>
      {card}
    </Collapsible>
  ) : (
    card
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
  failureLine: { margin: '0 0 10px', fontSize: 13, fontWeight: 600 },
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
   * Fixed height, equal to CHART_HEIGHT (the viewBox), so the stretch is horizontal only.
   * Nothing is drawn outside the box any more — bars sit on
   * the floor instead of dots straddling the edges — so the old
   * `overflow: visible` and its padding are gone with the hack they served.
   */
  chart: { width: '100%', height: CHART_HEIGHT, display: 'block' },

  axis: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    fontSize: 11,
    // t5, not t6: the range label here ("85–100%") is information, and t6
    // measured 1.6:1 — decoration contrast on text someone needs to read.
    color: c.t5,
  },
  range: {
    ...mono,
    fontVariantNumeric: 'tabular-nums',
  },
  /* A footnote, not a heading: it repeats what the last bar already shows,
     for readers who cannot hover it. */
  latestLine: {
    ...mono,
    margin: '8px 0 0',
    fontSize: 11.5,
    color: c.t5,
    lineHeight: 1.5,
  },
}
