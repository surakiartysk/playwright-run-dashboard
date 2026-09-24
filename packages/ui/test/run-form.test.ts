import { describe, expect, it } from 'vitest'
import { effectiveTags, runRequest } from '../src/run-form'

/**
 * The one rule the New run form has to keep: a service or a tag, never both.
 *
 * The API refuses a request naming both, so breaking this is not a wrong run —
 * it is a Run button that answers every press with a 422. It did exactly that
 * on an untouched form, whose initial state paired `items` with `smoke`.
 */

describe('the run request', () => {
  it('sends tags=all when a single service is named, whatever tag was picked', () => {
    // The form's own initial state, which the API used to refuse.
    const body = runRequest({
      suite: 'api',
      service: 'items',
      tags: 'smoke',
      ref: 'main',
      workers: 4,
    })

    expect(body).toEqual({ suite: 'api', service: 'items', tags: 'all', ref: 'main', workers: 4 })
  })

  it('keeps the picked tag when running across every service', () => {
    expect(
      runRequest({ suite: 'ui', service: 'all', tags: 'smoke', ref: 'develop', workers: 2 }).tags,
    ).toBe('smoke')
  })
})

describe('the scope the form shows', () => {
  it('reads all while a service is picked, so the control matches what is sent', () => {
    expect(effectiveTags('reservations', 'flow')).toBe('all')
  })

  it('reads the picked tag when no service is', () => {
    expect(effectiveTags('all', 'flow')).toBe('flow')
  })
})
