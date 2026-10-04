import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  NO_FILTERS,
  activeCount,
  canFilterByStarter,
  chips,
  facets,
  fromSearch,
  narrow,
  toQuery,
  toSearch,
} from '../src/run-query'
import { AdvancedFilters } from '../src/components/AdvancedFilters'
import { runOptions } from './fixtures'

/**
 * Narrowing the history by what a run was.
 *
 * The filters live in the address bar and are read back from whatever a person
 * pasted, so most of what matters is what is refused: anything the form could
 * not have produced is dropped, never sent.
 */

const options = runOptions()

describe('what an address names', () => {
  it('reads every filter it knows', () => {
    expect(
      fromSearch(
        '?suite=ui&service=auth&tag=smoke&ref=release/1.4&since=7d&triggeredBy=qa&simulated=real',
      ),
    ).toEqual({
      suite: 'ui',
      service: 'auth',
      tag: 'smoke',
      ref: 'release/1.4',
      since: '7d',
      triggeredBy: 'qa',
      simulated: 'real',
    })
  })

  it('is empty for an address with none', () => {
    expect(fromSearch('')).toEqual(NO_FILTERS)
    expect(fromSearch('?other=1')).toEqual(NO_FILTERS)
  })

  /** A pasted link that arrives as a 422 is a worse welcome than one that arrives unfiltered. */
  it.each([
    ['suite', 'mobile'],
    ['service', 'Has Space'],
    ['service', "x'; DROP TABLE runs;--"],
    ['tag', '1abc'],
    ['ref', 'a b'],
    ['since', '7days'],
    ['triggeredBy', 'root'],
    ['simulated', 'maybe'],
  ])('drops %s=%j rather than sending it', (name, value) => {
    expect(fromSearch(`?${name}=${encodeURIComponent(value)}`)).toEqual({})
  })

  it('keeps the valid filters when others in the same address are not', () => {
    expect(fromSearch('?suite=api&since=forever&tag=smoke')).toEqual({ suite: 'api', tag: 'smoke' })
  })
})

describe('writing filters back', () => {
  it('gives the API only what is set', () => {
    expect(toQuery({ suite: 'api', tag: 'flow' })).toEqual({ suite: 'api', tag: 'flow' })
    expect(toQuery({})).toEqual({})
  })

  it('ignores a filter that is present but unset', () => {
    expect(toQuery({ suite: undefined, tag: 'smoke' })).toEqual({ tag: 'smoke' })
  })

  it('gives the address a leading ? when there is something to say, and nothing when not', () => {
    expect(toSearch({ suite: 'ui', since: '24h' })).toBe('?suite=ui&since=24h')
    expect(toSearch({})).toBe('')
  })

  it('reads back what it wrote', () => {
    const f = {
      suite: 'api',
      service: 'items',
      ref: 'release/1.4',
      simulated: 'simulated',
    } as const
    expect(fromSearch(toSearch(f))).toEqual(f)
  })

  it('counts what is narrowing the list', () => {
    expect(activeCount({})).toBe(0)
    expect(activeCount({ suite: 'api', tag: 'smoke', since: '7d' })).toBe(3)
  })
})

describe('narrow', () => {
  it('sets a filter', () => {
    expect(narrow({}, { tag: 'smoke' }, options)).toEqual({ tag: 'smoke' })
  })

  it('clears one with undefined or an empty choice', () => {
    expect(narrow({ tag: 'smoke', suite: 'api' }, { tag: undefined }, options)).toEqual({
      suite: 'api',
    })
    expect(narrow({ tag: 'smoke' }, { tag: '' }, options)).toEqual({})
  })

  /** `reservations` is not a UI journey: that list would be empty for a reason nobody can see. */
  it('drops a service the newly chosen suite does not have', () => {
    expect(narrow({ service: 'reservations' }, { suite: 'ui' }, options)).toEqual({ suite: 'ui' })
  })

  it('keeps a service the suite does have, and one shared by both', () => {
    expect(narrow({ service: 'auth' }, { suite: 'ui' }, options)).toEqual({
      suite: 'ui',
      service: 'auth',
    })
    expect(narrow({ service: 'all' }, { suite: 'ui' }, options)).toEqual({
      suite: 'ui',
      service: 'all',
    })
  })

  it('does not touch the service when something else changes', () => {
    expect(narrow({ service: 'reservations' }, { tag: 'smoke' }, options)).toEqual({
      service: 'reservations',
      tag: 'smoke',
    })
  })

  it('only reconsiders the service when the suite is what changed', () => {
    // A stale pair from an old link: not for this call to tidy up.
    expect(narrow({ suite: 'ui', service: 'reservations' }, { tag: 'smoke' }, options)).toEqual({
      suite: 'ui',
      service: 'reservations',
      tag: 'smoke',
    })
  })

  it('does not mutate what it was given', () => {
    const before = { suite: 'api', tag: 'smoke' } as const
    narrow(before, { tag: undefined }, options)
    expect(before).toEqual({ suite: 'api', tag: 'smoke' })
  })
})

describe('who may be filtered by', () => {
  it('is offered only to the roles that see every run', () => {
    expect(canFilterByStarter('qa')).toBe(true)
    expect(canFilterByStarter('admin')).toBe(true)
    expect(canFilterByStarter('dev')).toBe(false)
    expect(canFilterByStarter('demo')).toBe(false)
  })
})

describe('what each filter offers', () => {
  it('offers a suite’s own services and tags when a suite is chosen', () => {
    const f = facets(options, { suite: 'ui' })
    expect(f.services.map((c) => c.value)).toEqual(options.suites.ui.services)
    expect(f.tags.map((c) => c.value)).toEqual(options.suites.ui.tags)
    expect(f.services.map((c) => c.value)).not.toContain('reservations')
  })

  it('offers names from either suite, each once, when none is chosen', () => {
    const values = facets(options, {}).services.map((c) => c.value)
    expect(values).toContain('reservations')
    expect(values).toContain('auth')
    expect(values.filter((v) => v === 'all')).toHaveLength(1)
  })

  it('words a name in its own suite’s terms', () => {
    const services = facets(options, {}).services
    expect(services.find((c) => c.value === 'maintenance-logs')?.label).toBe('Maintenance logs')
    expect(services.find((c) => c.value === 'all')?.label).toBe('All services')
    expect(facets(options, { suite: 'ui' }).services.find((c) => c.value === 'all')?.label).toBe(
      'All journeys',
    )
  })

  /** The branches are the caller's own: the filter cannot offer one they could not have run. */
  it('offers only the branches the caller may use', () => {
    const narrowed = runOptions()
    narrowed.suites.api.refs = ['main']
    narrowed.suites.ui.refs = ['main']
    expect(facets(narrowed, {}).refs.map((c) => c.value)).toEqual(['main'])
  })
})

describe('chips', () => {
  it('has none when nothing is narrowing', () => {
    expect(chips({})).toEqual([])
  })

  it('says each active filter in a word or two', () => {
    expect(
      chips({
        suite: 'api',
        service: 'maintenance-logs',
        tag: 'smoke',
        ref: 'develop',
        since: '7d',
        triggeredBy: 'qa',
        simulated: 'real',
      }).map((c) => c.label),
    ).toEqual([
      'API suite',
      'Maintenance logs',
      '@smoke',
      'branch develop',
      'Last 7 days',
      'started by qa',
      'real',
    ])
  })

  it('names a journey in the UI suite’s words even before a suite is chosen', () => {
    expect(chips({ service: 'auth' })[0]!.label).toBe('Auth')
    expect(chips({ service: 'all', suite: 'ui' })[1]!.label).toBe('All journeys')
  })

  it('words each suite', () => {
    expect(chips({ suite: 'ui' })[0]!.label).toBe('UI suite')
    expect(chips({ suite: 'api' })[0]!.label).toBe('API suite')
  })

  it('carries the key it removes', () => {
    expect(chips({ tag: 'smoke' })[0]!.key).toBe('tag')
  })
})

describe('AdvancedFilters', () => {
  const html = (filters = {}, viewing: 'demo' | 'qa' = 'qa') =>
    renderToStaticMarkup(
      createElement(AdvancedFilters, { options, filters, viewing, onChange: () => undefined }),
    )

  it('starts shut, with a button and no panel', () => {
    const out = html()
    expect(out).toContain('Filters')
    expect(out).toContain('aria-expanded="false"')
    expect(out).not.toContain('Both suites')
  })

  it('counts the active filters on the button and shows each as a chip that can be removed', () => {
    const out = html({ suite: 'api', tag: 'smoke' })
    expect(out).toContain('Filters · 2')
    expect(out).toContain('Remove filter: API suite')
    expect(out).toContain('Remove filter: @smoke')
    expect(out).toContain('Clear filters')
  })

  it('has no Clear while nothing is narrowing', () => {
    expect(html()).not.toContain('Clear filters')
    expect(html()).not.toContain('Remove filter')
  })
})
