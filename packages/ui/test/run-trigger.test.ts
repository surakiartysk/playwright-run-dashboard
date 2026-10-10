import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunTrigger } from '../src/components/RunTrigger'
import type { Role, RunOptions } from '../src/api'
import { runOptions } from './fixtures'
import type { RunForm } from '../src/run-form'

/**
 * What the command bar shows before anything is pressed.
 *
 * Rendered to a string: the first render is the one that decides what is locked
 * and what the reader is told, and it needs no browser. What a press *does* is
 * in run-form.test.ts, where the rules live.
 */

/**
 * A caller, as the form is told about them: who, which branches they may use
 * (`*` standing for the three a role with any branch is offered), how many
 * workers. Turned into the `GET /runs/options` answer the form actually takes.
 */
interface Caller {
  role: Role
  allowedRefs: string[]
  maxWorkers: number
}

const policy = (over: Partial<Caller> = {}): Caller => ({
  role: 'demo',
  allowedRefs: ['main'],
  maxWorkers: 2,
  ...over,
})

const optionsFor = (caller: Caller, simulated: boolean): RunOptions => {
  const refs = caller.allowedRefs.includes('*')
    ? ['main', 'develop', 'release']
    : caller.allowedRefs
  const base = runOptions()
  return {
    role: caller.role,
    simulated,
    maxWorkers: caller.maxWorkers,
    suites: {
      api: { ...base.suites.api, refs },
      ui: { ...base.suites.ui, refs },
    },
  }
}

const render = (p: Caller, simulates = true, initial?: Partial<RunForm>) =>
  renderToStaticMarkup(
    createElement(RunTrigger, {
      options: optionsFor(p, simulates),
      role: p.role,
      initial,
      onStarted: () => undefined,
    }),
  )

/** What a reader sees: the text between tags, with attributes (a tooltip, a label) left out. */
const renderedText = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')

describe('the first render of the command bar', () => {
  it('starts on the API suite, with API chosen and UI not', () => {
    const html = render(policy())
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>(?:<svg.*?<\/svg>)API/)
    expect(html).toMatch(/aria-checked="false"[^>]*>(?:<svg.*?<\/svg>)UI/)
  })

  it('leaves the tag free while a service is picked: the two combine', () => {
    const html = render(policy())
    expect(html).toContain('aria-label="Tag"')
    expect(html).not.toMatch(/aria-label="Tag[^"]*"[^>]*disabled/)
    expect(html).not.toContain('(locked). Scope')
  })

  it('says in words what Run will run, before anything is pressed', () => {
    expect(render(policy())).toContain('Runs the Items tests.')
    expect(render(policy(), true, { service: 'items', tags: 'smoke' })).toContain(
      'Runs the Items tests that are also tagged @smoke.',
    )
    expect(render(policy(), true, { service: 'all', tags: 'all' })).toContain(
      'Runs every test in the suite.',
    )
  })

  it('locks the branch for a role that may use only one, and names the role', () => {
    const html = render(policy({ role: 'dev', allowedRefs: ['main'] }))
    expect(html).toMatch(
      /aria-label="Suite branch: main \(locked\)[^"]*Only main is available to dev here/,
    )
  })

  it('says why the branch is locked under the row, not only in a tooltip a phone never shows', () => {
    const text = renderedText(render(policy({ role: 'demo', allowedRefs: ['main'] })))
    expect(text).toContain(
      'Suite branch: the branch of the test code, not of the app under test. Only main is available to demo here.',
    )
  })

  it('leaves the branch open for a role with a choice', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['*'] }))
    expect(renderedText(html)).not.toContain('branch of the test code')
    expect(html).not.toContain('Suite branch: main (locked)')
    expect(html).toContain('<option value="develop">develop</option>')
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

  /**
   * The failure a visitor can ask for exists only where runs are simulated.
   * A real run takes no outcome and the API refuses one, so offering the choice
   * there would promise a failure the pipeline cannot be told to produce.
   */
  it('offers the simulated result only where the run is simulated', () => {
    const simulated = render(policy(), true)
    expect(simulated).toContain('aria-label="Simulated result"')
    expect(simulated).toContain('<option value="fail">Simulate 1–3 failures</option>')
    expect(simulated).toContain('<option value="pass" selected="">Simulate a pass</option>')
    // Two choices: nobody asks to be told that a run is a coin toss.
    expect(simulated).not.toContain('value="random"')

    // What the form holds is what the dropdown shows.
    expect(render(policy(), true, { outcome: 'fail' })).toContain(
      '<option value="fail" selected="">',
    )

    const real = render(policy({ role: 'qa', allowedRefs: ['*'] }), false)
    expect(real).not.toContain('Simulated result')
    expect(real).not.toContain('Simulate 1–3 failures')
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
    expect(html).toMatch(/<option value="cart" selected="">Cart<\/option>/)
  })

  it('shows readable names while the options carry the suites’ own', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['*'] }))
    expect(html).toContain('<option value="maintenance-logs">Maintenance logs</option>')
    expect(html).toContain('<option value="all">All services</option>')
    expect(html).not.toContain('>maintenance-logs<')
  })

  it('calls the second field Journey on the UI suite, where nothing is a service', () => {
    const ui = render(policy(), true, { suite: 'ui', service: 'all' })
    expect(ui).toContain('aria-label="Journey"')
    expect(ui).toMatch(/<option value="all"[^>]*>All journeys<\/option>/)
    expect(ui).not.toContain('aria-label="Service"')
    expect(render(policy())).toContain('aria-label="Service"')
  })

  it('shows the tag it was opened on', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['*'] }), true, {
      service: 'items',
      tags: 'flow',
    })
    expect(html).toMatch(/<option value="flow" selected="">@flow<\/option>/)
  })

  it('writes a tag the way the specs do', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['*'] }), true, { service: 'all' })
    expect(html).toContain('<option value="cross-service">@cross-service</option>')
    expect(html).toMatch(/<option value="all"[^>]*>All tests<\/option>/)
  })

  it('offers the branches of the suite it is on, not of the other', () => {
    const base = optionsFor(policy({ role: 'qa', allowedRefs: ['*'] }), true)
    base.suites.api.refs = ['main', 'develop']
    base.suites.ui.refs = ['main']
    const html = (initial?: Partial<RunForm>) =>
      renderToStaticMarkup(
        createElement(RunTrigger, {
          options: base,
          role: 'qa',
          initial,
          onStarted: () => undefined,
        }),
      )
    expect(html()).toContain('<option value="develop"')
    expect(html({ suite: 'ui', service: 'auth', ref: 'main' })).not.toContain(
      '<option value="develop"',
    )
  })

  it('says what is the same however the branch came to be alone', () => {
    const html = render(policy({ role: 'qa', allowedRefs: ['main'] }))
    expect(html).toContain('Only main is available to qa here.')
  })
})

/*
 * Apart, the six controls needed 903px of a 794px row at every desktop width,
 * and Run wrapped onto a row of its own with nothing beside it. Found by the
 * design review; the pair now wraps together, at the end of the row.
 */
describe('the end of the command bar', () => {
  it('keeps the worker count and Run together, Run last', () => {
    const html = render(policy())
    expect(html).toMatch(
      /role="group" aria-label="Workers and run"[^>]*>.*aria-label="Workers, .*Run<\/button><\/div>/s,
    )
  })
})
