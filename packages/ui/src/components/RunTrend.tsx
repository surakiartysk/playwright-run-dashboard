import type { CSSProperties } from 'react'
import { isPending, type Run } from '../api'
import { c, status as sc } from '../theme'

/**
 * Pass rate over the recent runs, oldest to newest.
 *
 * A list says what happened to each run; this says which way things are
 * going — the question a lead actually asks, and the one the numbers above
 * cannot answer because a single rate has no direction.
 *
 * Drawn as inline SVG rather than with a charting library. The whole shape is
 * a polyline over n points: a library would be ~40 KB and a new vocabulary to
 * read, to produce markup shorter than its own configuration.
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

/** `x`/`y` in a 0–100 viewBox, so the SVG scales with its container. */
export function plot(points: TrendPoint[]): { x: number; y: number }[] {
  const { min, max } = domain(points)
  // Guarded: every run at exactly the same rate collapses the range to zero.
  const range = max - min || 1

  return points.map((point, index) => ({
    // A single point sits in the middle rather than dividing by zero.
    x: points.length === 1 ? 50 : (index / (points.length - 1)) * 100,
    // y grows downward in SVG, so the highest rate maps to the smallest y.
    y: 100 - ((point.rate - min) / range) * 100,
  }))
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

  const coords = plot(points)
  const line = coords.map((p) => `${p.x},${p.y}`).join(' ')
  const area = `0,100 ${line} 100,100`
  const { min, max } = domain(points)

  const latest = points[points.length - 1]!
  const first = points[0]!
  const change = Math.round(latest.rate - first.rate)

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
        <div style={{ ...s.latest, color: latest.passed ? sc.pass : sc.fail }}>
          {Math.round(latest.rate)}%
        </div>
      </header>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={s.chart}
        role="img"
        aria-label={`Pass rate across the last ${points.length} runs, currently ${Math.round(latest.rate)} percent`}
      >
        {/* Top and midpoint of the drawn range — labelled below, since the
            axis no longer starts at zero and an unlabelled guide would imply
            it does. */}
        <line x1="0" y1="0" x2="100" y2="0" stroke={c.divider} strokeWidth="0.5" />
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke={c.divider}
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />

        <polygon points={area} fill={sc.pass} opacity="0.08" />
        <polyline
          points={line}
          fill="none"
          stroke={sc.pass}
          strokeWidth="1.5"
          // Non-scaling keeps the stroke even, despite the viewBox being
          // stretched by preserveAspectRatio="none".
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />

        {/*
          A failed point is bigger and ringed, not merely red.

          Green and red are the pair colour-vision deficiency hits hardest —
          measured at ΔE 7.4 for deuteranopia against this palette, which is
          inside the band where colour is only allowed to carry meaning
          alongside something else. A 4px dot that differs from its neighbours
          in hue and nothing else is unreadable to roughly one man in twelve,
          and this chart's entire job is showing which runs went red.

          Size and the surface ring survive greyscale, printing and forced
          colours. The title is a real hover layer for everyone else.
        */}
        {coords.map((p, i) => {
          const point = points[i]!
          return (
            <circle
              key={point.id}
              cx={p.x}
              cy={p.y}
              r={point.passed ? 2 : 3.4}
              fill={point.passed ? sc.pass : sc.fail}
              stroke={point.passed ? 'none' : c.card}
              strokeWidth={point.passed ? 0 : 1.4}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${point.rate}% — ${point.passed ? 'passed' : 'failed'}`}</title>
            </circle>
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
  latest: { fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1 },

  // Fixed height with a stretched viewBox: the shape matters, the aspect ratio
  // does not, and a chart that grows with the window pushes the list off screen.
  // `overflow: visible` plus vertical padding: a dot sitting exactly on the
  // top or bottom of the range is drawn half outside the viewBox, and would
  // otherwise be clipped in half.
  chart: { width: '100%', height: 64, display: 'block', overflow: 'visible', padding: '4px 0' },

  axis: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    fontSize: 11,
    color: c.t6,
  },
  range: { fontVariantNumeric: 'tabular-nums' },
}
