import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunTrigger } from '../src/components/RunTrigger'
import type { Role, RolePolicy } from '../src/api'
import type { RunForm } from '../src/run-form'

/**
 * What the command bar shows before anything is pressed.
 *
 * Rendered to a string: the first render is the one that decides what is locked
 * and what the reader is told, and it needs no browser. What a press *does* is
 * in run-form.test.ts, where the rules live.
 */

const policy = (over: Partial<RolePolicy> = {}): RolePolicy => ({
  role: 'demo',
  allowedRefs: ['main'],
  maxWorkers: 2,
  canDelete: false,
  sees: 'only the runs it started itself',
  ...over,
})

const render = (p: RolePolicy, simulates = true, initial?: Partial<RunForm>) =>
  renderToStaticMarkup(
    createElement(RunTrigger, {
      policy: p,
      role: p.role as Role,
      simulates,
      initial,
      onStarted: () => undefined,
    }),
  )

describe('the first render of the command bar', () => {
  it('starts on the API suite, with API chosen and UI not', () => {
    const html = render(policy())
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>(?:<svg.*?<\/svg>)API/)
    expect(html).toMatch(/aria-checked="false"[^>]*>(?:<svg.*?<\/svg>)UI/)
  })

  it('locks the scope while a service is picked, and says why in words on the page', () => {
    const html = render(policy())
    expect(html).toMatch(/aria-label="Scope: all \(locked\)[^"]*"[^>]*disabled/)
    expect(html).toContain('Scope is <span')
  })

  it('locks the branch for a role that may use only one, and names the role', () => {
    const html = render(policy({ role: 'dev', allowedRefs: ['main'] }))
    expect(html).toMatch(/aria-label="Suite branch: main \(locked\)[^"]*dev may only use main/)
  })

  it('leaves the branch open for a role with a choice', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['*'] }))
    expect(html).not.toContain('Suite branch: main (locked)')
    expect(html).toContain('<option>develop</option>')
  })

  it('shows the worker count against the role’s ceiling, never above it', () => {
    expect(render(policy({ maxWorkers: 2 }))).toContain('Workers, 2 of at most 2')
    expect(render(policy({ maxWorkers: 16 }))).toContain('Workers, 4 of at most 16')
  })

  it('disables the button that cannot go further', () => {
    const atCeiling = render(policy({ maxWorkers: 2 }))
    expect(atCeiling).toMatch(/aria-label="More workers"[^>]*disabled/)
    expect(atCeiling).not.toMatch(/aria-label="Fewer workers"[^>]*disabled/)
  })

  it('says before Run whether the run will be simulated', () => {
    expect(render(policy(), true)).toContain('Simulated here')
    expect(render(policy(), false)).toContain('Runs the published suites on GitHub Actions')
  })

  it('has no banner yet: nothing has happened', () => {
    const html = render(policy())
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('role="status"')
  })

  it('frees the scope and drops the note when every service is selected', () => {
    const html = render(policy(), true, { service: 'all' })
    expect(html).not.toMatch(/aria-label="Scope: [^"]*\(locked\)/)
    expect(html).not.toContain('Scope is <span')
  })

  it('disables both steppers for a role limited to one worker', () => {
    const html = render(policy({ maxWorkers: 1 }))
    expect(html).toMatch(/aria-label="Fewer workers"[^>]*disabled/)
    expect(html).toMatch(/aria-label="More workers"[^>]*disabled/)
  })

  it('opens on the selection it is given', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['*'] }), true, {
      suite: 'ui',
      service: 'cart',
    })
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:<svg.*?<\/svg>)UI/)
    expect(html).toMatch(/<option selected="">cart<\/option>/)
  })
})
