import { describe, expect, it } from 'vitest'
import {
  SUITE_SERVICES,
  SUITE_TAGS,
  afterSuiteChange,
  clampWorkers,
  defaultWorkers,
  describeSelection,
  initialForm,
  refLocked,
  runTag,
  scopeChoices,
  scopeLabel,
  serviceChoices,
  serviceFieldLabel,
  serviceLabel,
  startedMessage,
  stepWorkers,
  submitRun,
  withSuite,
} from '../src/run-form'

/**
 * The New run form's rules, apart from drawing it.
 *
 * The service and the tag are two choices that combine, which the suites' own
 * workflows could not take until they gained a second input. These tests hold
 * what the form does with the pair: it sends both, untouched, and says in a
 * sentence which tests that is.
 */

describe('what the form sends', () => {
  it('sends the service and the tag as two separate fields, as selected', async () => {
    let sent: unknown
    await submitRun(
      { suite: 'api', service: 'items', tags: 'smoke', ref: 'main', workers: 4 },
      async (body) => {
        sent = body
        return { simulated: true }
      },
    )
    expect(sent).toEqual({ suite: 'api', service: 'items', tags: 'smoke', ref: 'main', workers: 4 })
  })

  it('does not hand over its own state: a later change cannot alter what was sent', async () => {
    const form = initialForm(4, { tags: 'smoke' })
    let sent: { tags: string } | undefined
    await submitRun(form, async (body) => {
      sent = body
      return { simulated: true }
    })
    form.tags = 'flow'
    expect(sent?.tags).toBe('smoke')
  })
})

describe('describeSelection', () => {
  const d = (service: string, tags: string, suite: 'api' | 'ui' = 'api') =>
    describeSelection({ suite, service, tags })

  it('says everything when nothing narrows', () => {
    expect(d('all', 'all')).toBe('Runs every test in the suite.')
  })

  it('names the service alone', () => {
    expect(d('maintenance-logs', 'all')).toBe('Runs the Maintenance logs tests.')
  })

  it('names the tag alone, across every service', () => {
    expect(d('all', 'smoke')).toBe('Runs every test tagged @smoke.')
  })

  /** "items" and "@smoke" could be read as either; the sentence says which. */
  it('says "that are also", so two choices read as an intersection and not a union', () => {
    const text = d('items', 'smoke')
    expect(text).toContain('Runs the Items tests that are also tagged @smoke.')
  })

  it('warns, before Run is pressed, that a pair nothing carries fails', () => {
    expect(d('items', 'flow')).toContain('No tests found')
    expect(d('items', 'all')).not.toContain('No tests found')
    expect(d('all', 'smoke')).not.toContain('No tests found')
  })

  it('uses the UI suite’s own words for its slices', () => {
    expect(d('auth', 'smoke', 'ui')).toContain('Runs the Auth tests that are also tagged @smoke.')
    expect(d('all', 'smoke', 'ui')).toBe('Runs every test tagged @smoke.')
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
      tags: 'all',
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

  it('opens on the whole of a service, which is what the form always opened on', () => {
    expect(initialForm(4)).toMatchObject({ service: 'items', tags: 'all' })
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

describe('what the form calls things', () => {
  it('rewrites a machine name as a sentence', () => {
    expect(serviceLabel('api', 'maintenance-logs')).toBe('Maintenance logs')
    expect(serviceLabel('api', 'items')).toBe('Items')
    expect(serviceLabel('ui', 'checkout')).toBe('Checkout')
  })

  it('says "all" in the suite’s own terms: services in one, journeys in the other', () => {
    expect(serviceLabel('api', 'all')).toBe('All services')
    expect(serviceLabel('ui', 'all')).toBe('All journeys')
  })

  it('calls the field a journey where the suite has journeys', () => {
    expect(serviceFieldLabel('api')).toBe('Service')
    expect(serviceFieldLabel('ui')).toBe('Journey')
  })

  it('writes a tag as it is written in a spec, and "all" as every test', () => {
    expect(scopeLabel('smoke')).toBe('@smoke')
    expect(scopeLabel('cross-service')).toBe('@cross-service')
    expect(scopeLabel('all')).toBe('All tests')
  })

  /** Only the words change: what is sent has to be the suite's own name. */
  it('keeps every value exactly as the suite names it, in the same order', () => {
    for (const suite of ['api', 'ui'] as const) {
      expect(serviceChoices(suite).map((c) => c.value)).toEqual(SUITE_SERVICES[suite])
      expect(scopeChoices(suite).map((c) => c.value)).toEqual(SUITE_TAGS[suite])
    }
  })

  it('gives every choice a label that is not the raw identifier', () => {
    for (const suite of ['api', 'ui'] as const) {
      for (const choice of [...serviceChoices(suite), ...scopeChoices(suite)]) {
        expect(choice.label.length, choice.value).toBeGreaterThan(0)
        expect(choice.label, choice.value).not.toBe(choice.value)
      }
    }
  })
})

describe('runTag', () => {
  it('writes a tag as it is written in a spec', () => {
    expect(runTag('smoke')).toBe('@smoke')
    expect(runTag('cross-service')).toBe('@cross-service')
  })

  /** `all` is the absence of a tag; `items @all` named one nobody wrote. */
  it('says nothing for a run that was not narrowed by a tag', () => {
    expect(runTag('all')).toBeNull()
  })
})
