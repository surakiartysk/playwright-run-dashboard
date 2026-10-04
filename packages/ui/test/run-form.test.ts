import { describe, expect, it } from 'vitest'
import {
  SUITE_SERVICES,
  SUITE_TAGS,
  afterSuiteChange,
  clampWorkers,
  defaultWorkers,
  effectiveTags,
  initialForm,
  refLocked,
  runRequest,
  scopeLocked,
  startedMessage,
  stepWorkers,
  submitRun,
  withSuite,
} from '../src/run-form'

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

describe('afterSuiteChange', () => {
  /**
   * The hazard: `reservations` carried over to the UI suite is a slice that
   * does not exist, which the server accepts and runs as a green nothing.
   */
  it('replaces a service the new suite does not have', () => {
    expect(afterSuiteChange('ui', { service: 'reservations', tags: 'all' }).service).toBe('auth')
  })

  it('replaces it with a real service, not with all', () => {
    for (const suite of ['api', 'ui'] as const) {
      expect(afterSuiteChange(suite, { service: 'nope', tags: 'all' }).service).not.toBe('all')
    }
  })

  it('keeps a service both suites share', () => {
    // `all` is the only name the two suites have in common.
    expect(afterSuiteChange('ui', { service: 'all', tags: 'smoke' }).service).toBe('all')
    expect(afterSuiteChange('api', { service: 'items', tags: 'all' }).service).toBe('items')
  })

  it('replaces a tag the new suite does not have, and keeps one it does', () => {
    expect(afterSuiteChange('ui', { service: 'all', tags: 'cross-service' }).tags).toBe('all')
    expect(afterSuiteChange('ui', { service: 'all', tags: 'smoke' }).tags).toBe('smoke')
  })

  it('only ever selects what the suite offers', () => {
    for (const suite of ['api', 'ui'] as const) {
      const next = afterSuiteChange(suite, { service: 'zzz', tags: 'zzz' })
      expect(SUITE_SERVICES[suite]).toContain(next.service)
      expect(SUITE_TAGS[suite]).toContain(next.tags)
    }
  })
})

describe('what the form locks', () => {
  it('locks scope while one service is named, and frees it for all', () => {
    expect(scopeLocked('items')).toBe(true)
    expect(scopeLocked('all')).toBe(false)
  })

  it('locks the branch when there is nothing to choose between', () => {
    expect(refLocked(['main'])).toBe(true)
    expect(refLocked([])).toBe(true)
    expect(refLocked(['main', 'develop'])).toBe(false)
  })
})

describe('workers', () => {
  it.each([
    ['inside the range', 3, 8, 3],
    ['at the ceiling', 8, 8, 8],
    ['past the ceiling', 12, 8, 8],
    ['at the floor', 1, 8, 1],
    ['below the floor', 0, 8, 1],
    ['negative', -4, 8, 1],
    ['fractional', 2.9, 8, 2],
  ])('clamps %s', (_label, value, max, expected) => {
    expect(clampWorkers(value, max)).toBe(expected)
  })

  it('treats a count that is not a number as the minimum, never NaN', () => {
    expect(clampWorkers(Number.NaN, 8)).toBe(1)
    expect(clampWorkers(Number.POSITIVE_INFINITY, 8)).toBe(1)
  })

  it('never offers fewer than one worker, even for a role whose limit is lower', () => {
    expect(clampWorkers(5, 0)).toBe(1)
  })

  it('steps by one and stops at both ends', () => {
    expect(stepWorkers(2, 1, 4)).toBe(3)
    expect(stepWorkers(2, -1, 4)).toBe(1)
    expect(stepWorkers(4, 1, 4)).toBe(4)
    expect(stepWorkers(1, -1, 4)).toBe(1)
  })

  it('starts at four, or at the role’s limit when that is lower', () => {
    expect(defaultWorkers(16)).toBe(4)
    expect(defaultWorkers(2)).toBe(2)
    expect(defaultWorkers(1)).toBe(1)
  })
})

describe('startedMessage', () => {
  it('says so when the run is simulated, before anyone opens a report that is a sample', () => {
    expect(startedMessage(true)).toContain('simulated')
    expect(startedMessage(false)).not.toContain('simulated')
  })
})

describe('initialForm', () => {
  it('opens on the API suite, items, main, with workers inside the role’s limit', () => {
    expect(initialForm(16)).toEqual({
      suite: 'api',
      service: 'items',
      tags: 'smoke',
      ref: 'main',
      workers: 4,
    })
    expect(initialForm(2).workers).toBe(2)
  })

  it('takes what it is given, but never a worker count the role may not use', () => {
    expect(initialForm(8, { service: 'all', workers: 99 })).toMatchObject({
      service: 'all',
      workers: 8,
    })
  })

  it('opens in a state the API accepts, whatever the tag selected', () => {
    // The untouched form is the first thing a demo visitor presses Run on.
    const body = runRequest(initialForm(4))
    expect(body.service === 'all' || body.tags === 'all').toBe(true)
  })
})

describe('withSuite', () => {
  const form = initialForm(4, { service: 'reservations', tags: 'all', ref: 'develop', workers: 3 })

  it('changes the suite and moves a service the new one lacks', () => {
    expect(withSuite(form, 'ui')).toMatchObject({ suite: 'ui', service: 'auth' })
  })

  it('leaves what the suite switch does not concern alone', () => {
    expect(withSuite(form, 'ui')).toMatchObject({ ref: 'develop', workers: 3 })
  })

  it('keeps a service the new suite has', () => {
    expect(withSuite({ ...form, service: 'all' }, 'ui').service).toBe('all')
  })
})

describe('submitRun', () => {
  const accepted = (simulated: boolean) => async () => ({ simulated })

  /** The untouched form: `items` with `smoke` selected, which the API refuses if sent as is. */
  it('sends the request, not the selection, so a named service goes out with tags=all', async () => {
    let sent: unknown
    await submitRun(initialForm(4), async (body) => {
      sent = body
      return { simulated: true }
    })
    expect(sent).toMatchObject({ service: 'items', tags: 'all' })
  })

  it('says whether the run it started is simulated', async () => {
    expect(await submitRun(initialForm(4), accepted(true))).toContain('simulated')
    expect(await submitRun(initialForm(4), accepted(false))).not.toContain('simulated')
  })

  it('lets a refusal through for the form to show, rather than swallowing it', async () => {
    const refuse = async () => {
      throw new Error('runs are paused')
    }
    await expect(submitRun(initialForm(4), refuse)).rejects.toThrow('runs are paused')
  })
})
