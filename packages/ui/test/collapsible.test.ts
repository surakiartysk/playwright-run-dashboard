import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Collapsible } from '../src/components/Collapsible'
import { RoleSwitcher, policyLines, previewNote } from '../src/components/RoleSwitcher'
import {
  CHART_HEIGHT,
  PLOT_HEIGHT,
  RunTrend,
  STRIP_GAP,
  STRIP_HEIGHT,
  failureSummary,
  trendHint,
  trendPoints,
} from '../src/components/RunTrend'
import { RunStats, statsHint } from '../src/components/RunStats'
import type { RolePolicy } from '../src/api'
import { status as sc } from '../src/theme'
import { run } from './fixtures'

/**
 * The panels that fold on a narrow screen: what they say while shut, and that
 * shut means shut. Rendered to a string — the first render is the folded one.
 */

const policies: RolePolicy[] = (['demo', 'dev', 'qa', 'admin'] as const).map((role) => ({
  role,
  allowedRefs: ['main'],
  maxWorkers: 2,
  canDelete: role === 'admin',
  sees: 'every run',
}))

const runs = [
  run({ status: 'passed', total: 40, passed: 40 }),
  run({ status: 'failed', total: 40, passed: 36 }),
  run({ status: 'passed', total: 40, passed: 40 }),
  run({ status: 'passed', total: 40, passed: 40 }),
]

describe('Collapsible', () => {
  const html = renderToStaticMarkup(
    createElement(Collapsible, { title: 'Run by run', hint: 'Last 4 runs', children: 'INSIDE' }),
  )

  it('is a native details, so it opens from the keyboard', () => {
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
  })

  it('starts shut, with its title and hint on one line and nothing inside', () => {
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).toContain('Run by run')
    expect(html).toContain('Last 4 runs')
    expect(html).not.toContain('INSIDE')
  })
})

describe('the folded chart', () => {
  it('says how much it covers and where the newest run stands', () => {
    expect(trendHint(trendPoints(runs))).toBe('Last 4 · 1 failed')
  })

  it('says nothing when there is nothing to chart', () => {
    expect(trendHint([])).toBe('')
  })

  it('is one folded row when asked, and the whole card when not', () => {
    const folded = renderToStaticMarkup(createElement(RunTrend, { runs, collapsible: true }))
    expect(folded).toContain('<details')
    // The chevron is an svg too; the chart is the one that stretches.
    expect(folded).not.toContain('preserveAspectRatio')

    const open = renderToStaticMarkup(createElement(RunTrend, { runs }))
    expect(open).not.toContain('<details')
    expect(open).toContain('preserveAspectRatio')
    expect(open).toContain('Run by run')
  })

  it('does not draw a row for a chart that would be hidden anyway', () => {
    const html = renderToStaticMarkup(
      createElement(RunTrend, { runs: runs.slice(0, 2), collapsible: true }),
    )
    expect(html).toBe('')
  })
})

describe('the folded summary', () => {
  /**
   * The card was 307px of a 667px phone screen and put the Run button below the
   * fold. Shut, it has to keep answering "is the suite healthy" in one line.
   */
  it('says the pass rate, the verdict and what is still running', () => {
    expect(statsHint({ finished: 6, inFlight: 0, failing: 0, rate: 100 })).toBe(
      '100% of 6 · all green',
    )
    expect(statsHint({ finished: 12, inFlight: 0, failing: 2, rate: 83 })).toBe(
      '83% of 12 · 2 failing',
    )
    expect(statsHint({ finished: 6, inFlight: 1, failing: 0, rate: 100 })).toBe(
      '100% of 6 · all green · 1 in flight',
    )
  })

  /** No rate to give is not 0%, which would read as "everything failed". */
  it('says so when nothing has finished, rather than a percentage', () => {
    expect(statsHint({ finished: 0, inFlight: 2, failing: 0, rate: null })).toBe(
      'none finished yet · 2 in flight',
    )
    expect(statsHint({ finished: 0, inFlight: 0, failing: 0, rate: null })).toBe(
      'none finished yet',
    )
  })

  it('is one folded row when asked, and the whole card when not', () => {
    const folded = renderToStaticMarkup(
      createElement(RunStats, { runs, total: runs.length, collapsible: true }),
    )
    expect(folded).toContain('<details')
    expect(folded).toContain('Pass rate')
    expect(folded).toContain('75% of 4 · 1 failing')
    // The ring and the tiles are inside, so they are not drawn while shut.
    expect(folded).not.toContain('conic-gradient')
    expect(folded).not.toContain('Counts runs, not tests')

    const open = renderToStaticMarkup(createElement(RunStats, { runs, total: runs.length }))
    expect(open).not.toContain('<details')
    expect(open).toContain('conic-gradient')
    expect(open).toContain('Counts runs, not tests')
  })

  it('does not draw a row for a summary of nothing', () => {
    expect(
      renderToStaticMarkup(createElement(RunStats, { runs: [], total: 0, collapsible: true })),
    ).toBe('')
  })
})

/**
 * Whether a panel folds is decided where it is placed, not inside it, and `App`
 * cannot be rendered here: its first render is "Checking whether you are signed
 * in". So the wiring is read from the source. A summary that stopped folding
 * would pass every test above and put the Run button back below the fold on a
 * phone, which is the thing the folding is for.
 */
describe('which panels the stacked layout folds', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

  it.each(['RoleSwitcher', 'RunStats', 'RunTrend'])(
    'folds %s when the layout is not wide',
    (name) => {
      const tag = new RegExp(`<${name}\\b[^>]*>`, 's').exec(app)?.[0]
      expect(tag, `<${name} …> in App.tsx`).toBeDefined()
      expect(tag).toContain('collapsible={!wide}')
    },
  )
})

describe('the folded role switcher', () => {
  const render = (collapsible: boolean) =>
    renderToStaticMarkup(
      createElement(RoleSwitcher, {
        role: 'qa',
        realRole: 'qa',
        policies,
        onSwitched: () => undefined,
        collapsible,
      }),
    )

  it('names the role in force while shut, and hides the buttons', () => {
    const html = render(true)
    expect(html).toContain('View as another role')
    expect(html).toContain('Now: qa')
    expect(html).not.toContain('>admin</button>')
  })

  it('shows the buttons straight away in the side column', () => {
    const html = render(false)
    expect(html).not.toContain('<details')
    expect(html).toContain('>admin</button>')
  })
})

describe('failureSummary', () => {
  const points = (...statuses: ('passed' | 'failed' | 'error' | 'timeout')[]) =>
    trendPoints(
      statuses.map((status) => run({ status, total: 40, passed: status === 'passed' ? 40 : 30 })),
    )

  it('says outright that everything passed', () => {
    expect(failureSummary(points('passed', 'passed', 'passed'))).toEqual({
      failed: 0,
      text: 'All 3 runs passed',
    })
  })

  it('says how many did not, out of how many are charted', () => {
    expect(failureSummary(points('passed', 'failed', 'passed', 'failed', 'passed'))).toEqual({
      failed: 2,
      text: '2 of the last 5 runs did not pass',
    })
  })

  /** A run that errored or timed out is not a run that passed. */
  it('counts error and timeout as not passing', () => {
    expect(failureSummary(points('passed', 'error', 'timeout')).failed).toBe(2)
  })

  /**
   * Decided by the run's status, not by whether it reported failing tests: a
   * run that timed out reported nothing failed, and was still not a pass.
   */
  it('counts a run that did not pass even when it reported no failed tests', () => {
    const silent = trendPoints([
      run({ status: 'timeout', total: 40, passed: 40 }),
      run({ status: 'passed', total: 40, passed: 40 }),
    ])
    expect(silent.map((p) => p.failed)).toEqual([0, 0])
    expect(failureSummary(silent).failed).toBe(1)
  })

  it('reads sensibly for one run, and for none', () => {
    expect(failureSummary(points('passed')).text).toBe('The run passed')
    expect(failureSummary([])).toEqual({ failed: 0, text: '' })
  })

  it('feeds the folded row, so it says what went wrong and not only how many', () => {
    expect(trendHint(points('passed', 'passed', 'passed'))).toBe('Last 3 · all passed')
    expect(trendHint(points('passed', 'failed', 'passed'))).toBe('Last 3 · 1 failed')
  })

  it('puts the line on the open card, in the danger colour only when something failed', () => {
    const red = renderToStaticMarkup(createElement(RunTrend, { runs }))
    expect(red).toContain('1 of the last 4 runs did not pass')
    expect(red).toContain('color:var(--c-danger)">1 of the last 4')
    const green = renderToStaticMarkup(
      createElement(RunTrend, { runs: [runs[0]!, runs[2]!, runs[3]!] }),
    )
    expect(green).toContain('All 3 runs passed')
    expect(green).not.toContain('color:var(--c-danger)">All')
  })
})

describe('the status strip', () => {
  it('sits below the plot and is part of what the chart draws', () => {
    expect(CHART_HEIGHT).toBe(PLOT_HEIGHT + STRIP_GAP + STRIP_HEIGHT)
    expect(renderToStaticMarkup(createElement(RunTrend, { runs }))).toContain(
      `viewBox="0 0 320 ${CHART_HEIGHT}"`,
    )
  })

  it('has one square per charted run, the same height for all of them', () => {
    const html = renderToStaticMarkup(createElement(RunTrend, { runs }))
    const squares = html.match(new RegExp(`height="${STRIP_HEIGHT}"`, 'g')) ?? []
    expect(squares).toHaveLength(runs.length)
  })

  it('colours a square by whether its run passed', () => {
    const html = renderToStaticMarkup(createElement(RunTrend, { runs }))
    const squares = html.match(new RegExp(`height="${STRIP_HEIGHT}"[^>]*fill="[^"]+"`, 'g')) ?? []
    expect(squares.filter((s) => s.includes(sc.fail))).toHaveLength(1)
    expect(squares.filter((s) => s.includes(sc.pass))).toHaveLength(runs.length - 1)
  })

  it('is taller than the plot used to be, so a failing bar is not a sliver', () => {
    expect(PLOT_HEIGHT).toBeGreaterThanOrEqual(96)
  })
})

describe('policyLines', () => {
  const [demo, , , admin] = policies

  it('has the same four lines in the same order for every role', () => {
    for (const policy of policies) {
      expect(policyLines(policy).map((l) => l.label)).toEqual([
        'Sees',
        'Suite branches',
        'Workers',
        'Delete runs',
      ])
    }
  })

  it('states the role’s own limits', () => {
    expect(policyLines({ ...demo!, maxWorkers: 16, canDelete: true })).toEqual([
      { label: 'Sees', value: 'every run' },
      { label: 'Suite branches', value: 'main' },
      { label: 'Workers', value: 'up to 16' },
      { label: 'Delete runs', value: 'yes' },
    ])
    expect(policyLines(admin!).find((l) => l.label === 'Delete runs')?.value).toBe('yes')
    expect(policyLines(demo!).find((l) => l.label === 'Delete runs')?.value).toBe('no')
  })

  it('says "any" for a role that may use any branch, and lists the rest', () => {
    expect(policyLines({ ...demo!, allowedRefs: ['*'] })[1]?.value).toBe('any')
    expect(policyLines({ ...demo!, allowedRefs: ['main', 'develop'] })[1]?.value).toBe(
      'main, develop',
    )
  })
})

describe('previewNote', () => {
  it('names both roles when what is viewed is not what is signed in', () => {
    const note = previewNote('admin', 'demo')
    expect(note).toContain('signed in as demo')
    expect(note).toContain('Viewing as admin')
    expect(note).toContain('still uses demo')
  })

  it('is the general reminder when they are the same', () => {
    expect(previewNote('demo', 'demo')).not.toContain('signed in as')
    expect(previewNote('demo', 'demo')).toContain('not what you may do')
  })

  it('shows on the open panel and in the folded row when viewing another role', () => {
    const html = renderToStaticMarkup(
      createElement(RoleSwitcher, {
        role: 'admin',
        realRole: 'demo',
        policies,
        onSwitched: () => undefined,
      }),
    )
    expect(html).toContain('You are signed in as demo')
    const folded = renderToStaticMarkup(
      createElement(RoleSwitcher, {
        role: 'admin',
        realRole: 'demo',
        policies,
        onSwitched: () => undefined,
        collapsible: true,
      }),
    )
    expect(folded).toContain('Now: admin · you are demo')
  })
})
