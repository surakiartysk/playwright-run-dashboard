import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Collapsible } from '../src/components/Collapsible'
import { RoleSwitcher, policyLines, previewNote } from '../src/components/RoleSwitcher'
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
