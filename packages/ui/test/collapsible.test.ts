import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Collapsible } from '../src/components/Collapsible'
import { RoleSwitcher } from '../src/components/RoleSwitcher'
import { RunTrend, trendHint, trendPoints } from '../src/components/RunTrend'
import type { RolePolicy } from '../src/api'
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
    expect(trendHint(trendPoints(runs))).toBe('Last 4 · newest 100%')
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

describe('the folded role switcher', () => {
  const render = (collapsible: boolean) =>
    renderToStaticMarkup(
      createElement(RoleSwitcher, {
        role: 'qa',
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
