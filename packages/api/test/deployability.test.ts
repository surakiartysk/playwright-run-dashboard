import { describe, expect, it } from 'vitest'
import { assertDeployable } from '../src/config'
import type { Bindings } from '../src/types'

/**
 * The development defaults exist so a clone runs with no configuration, which
 * is also the most likely way this ships broken: a real deployment quietly
 * running on `dev-token-secret-not-for-deployment`.
 *
 * `assertDeployable` is the fence. These tests are here rather than as a grep
 * in CI because a grep passes on a commented-out line.
 */
describe('assertDeployable', () => {
  const deployed = (overrides: Partial<Bindings> = {}) =>
    assertDeployable({ SIMULATE_DISPATCH: 'false', ...overrides } as Bindings)

  it('says nothing while simulating — the defaults are the point locally', () => {
    expect(assertDeployable({ SIMULATE_DISPATCH: 'true' } as Bindings)).toEqual([])
    // Unset means simulating too: the safe behaviour is the default.
    expect(assertDeployable({} as Bindings)).toEqual([])
  })

  it.each([
    ['WEBHOOK_SECRET', 'the webhook would be forgeable'],
    ['TOKEN_SECRET', 'report links would be forgeable'],
    ['ADMIN_PASSWORD', ''],
    ['QA_PASSWORD', ''],
    ['DEV_PASSWORD', ''],
  ])('complains when %s is unset in a real deployment', (name) => {
    expect(deployed().join('\n')).toContain(name)
  })

  it('is satisfied once every secret is set', () => {
    expect(
      deployed({
        WEBHOOK_SECRET: 'w',
        TOKEN_SECRET: 't',
        ADMIN_PASSWORD: 'a',
        QA_PASSWORD: 'q',
        DEV_PASSWORD: 'd',
      }),
    ).toEqual([])
  })

  it('explains why, not just what — the message has to be actionable at 3am', () => {
    expect(deployed().some((problem) => problem.includes('forgeable'))).toBe(true)
  })
})
