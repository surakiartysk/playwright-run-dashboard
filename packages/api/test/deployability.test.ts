import { describe, expect, it } from 'vitest'
import { assertDeployable, isLocalHost } from '../src/config'
import type { Bindings } from '../src/types'

/**
 * The development defaults exist so a clone runs with no configuration, which
 * is also the most likely way this ships broken: a real deployment quietly
 * running on `dev-token-secret-not-for-deployment`.
 *
 * `assertDeployable` is the fence, and it decides by the host the request was
 * sent to (decision 52) — a deploy cannot forget a host the way it could
 * forget a variable.
 */
describe('assertDeployable', () => {
  const DEPLOYED = 'https://runs.example.com/runs'
  const deployed = (overrides: Partial<Bindings> = {}) =>
    assertDeployable({ ...overrides } as Bindings, DEPLOYED)

  it.each([
    'http://localhost:8787/runs',
    'http://127.0.0.1:8787/runs',
    'http://[::1]:8787/runs',
    'http://api.test/runs',
    'http://app.localhost/runs',
  ])('says nothing on a local host — the defaults are the point there: %s', (url) => {
    expect(assertDeployable({} as Bindings, url)).toEqual([])
  })

  it.each([
    'https://runs.testbydesign.dev/runs',
    'https://run-dashboard-api.example.workers.dev/runs',
    'https://localhost.example.com/runs',
    'https://test.example.com/runs',
  ])('treats any other host as a deployment: %s', (url) => {
    expect(assertDeployable({} as Bindings, url)).not.toEqual([])
    expect(isLocalHost(url)).toBe(false)
  })

  it.each([
    ['WEBHOOK_SECRET', 'the webhook would be forgeable'],
    ['TOKEN_SECRET', 'sessions, admin keys and report links would be forgeable'],
  ])('complains when %s is unset in a deployment', (name, why) => {
    const problems = deployed().join('\n')
    expect(problems).toContain(name)
    expect(problems).toContain(why)
  })

  it('is satisfied once every secret is set', () => {
    expect(deployed({ WEBHOOK_SECRET: 'w', TOKEN_SECRET: 't' })).toEqual([])
  })
})
