import { describe, expect, it, beforeAll } from 'vitest'
import { migrate, as, seedRun, uniqueService } from './helpers'
import type { RunView } from '../src/types'

beforeAll(migrate)

/**
 * What a stranger holding the published `demo` password can reach.
 *
 * `demo-role-safety.test.ts` covers the dispatch half — that a demo run never
 * touches a real workflow whatever the deployment's flags say. This covers the
 * other half, which had no test: the blast radius of a role whose password is
 * printed in the README and on the landing page.
 *
 * The answer these pin down is that demo may write, but only ever to its own
 * corner: it starts simulated runs, sees nothing but the runs it started
 * itself, and is refused by every route that changes something shared.
 */

describe('what one demo visitor can reach', () => {
  it('cannot see runs another role started', async () => {
    const service = uniqueService()
    await seedRun({ service, triggeredBy: 'qa', ref: 'main', status: 'passed' })
    await seedRun({ service, triggeredBy: 'admin', ref: 'main', status: 'passed' })

    const response = await as('demo', '/runs?limit=100')
    const { runs } = (await response.json()) as { runs: RunView[] }
    expect(runs.filter((r) => r.service === service)).toHaveLength(0)
  })

  it('cannot delete a run', async () => {
    const id = await seedRun({ service: uniqueService(), triggeredBy: 'demo' })
    const response = await as('demo', `/runs/${id}`, { method: 'DELETE' })
    expect(response.status).toBe(403)
  })

  it('cannot reach the admin key routes', async () => {
    expect((await as('demo', '/keys')).status).toBe(403)
  })

  it('cannot change the run gate', async () => {
    const response = await as('demo', '/gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' }),
    })
    expect(response.status).toBe(403)
  })
})
