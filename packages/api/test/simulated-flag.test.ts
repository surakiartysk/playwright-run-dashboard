import { describe, expect, it, beforeAll } from 'vitest'
import { as, migrate, seedRun } from './helpers'
import type { RunView } from '../src/types'

beforeAll(migrate)

/**
 * A simulated run says so, wherever it is shown — and a real one says it is
 * real.
 *
 * Every run started from the dashboard is simulated (decision 52), and the
 * real runs from the suites' CI sit beside them in the same list. A flag that
 * is always true passes the first case below and fails the second; one that is
 * always false fails the first.
 */

describe('a run records whether it was simulated', () => {
  it.each(['dev', 'qa', 'admin'] as const)('marks a run %s starts simulated', async (role) => {
    const created = await as(role, '/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'items', tags: 'all' }),
    })
    const { runId } = (await created.json()) as { runId: string }
    const read = (await (await as('admin', `/runs/${runId}`)).json()) as RunView
    expect(read.simulated).toBe(true)
  })

  it('marks a run reported by a suite’s CI as not simulated', async () => {
    const id = await seedRun()
    const read = (await (await as('qa', `/runs/${id}`)).json()) as RunView
    expect(read.simulated).toBe(false)
  })
})

describe('the run form is told before Run is pressed', () => {
  it.each(['dev', 'qa', 'admin'] as const)('says a run %s starts is simulated', async (role) => {
    const response = await as(role, '/demo/roles')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { simulates: boolean }).simulates).toBe(true)
  })
})
