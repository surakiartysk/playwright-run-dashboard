import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, as, seedRun, uniqueService } from './helpers'

beforeAll(migrate)

/**
 * The hourly cap on demo runs.
 *
 * Housekeeping, not security: demo already cannot reach a real workflow, see
 * anyone else's runs, or delete anything. This exists so a stranger with the
 * published password cannot fill D1 with simulated rows in a loop.
 */

const startRun = (role: 'demo' | 'qa') =>
  as(role, '/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: 'items', tags: 'smoke', ref: 'main' }),
  })

/** Fills the window with rows attributed to demo, without going through the API. */
async function seedDemoRuns(count: number, minutesAgo = 5) {
  const at = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
  for (let i = 0; i < count; i++) {
    await seedRun({ service: uniqueService(), triggeredBy: 'demo', startedAt: at })
  }
}

describe('demo run limit', () => {
  it('refuses a demo run once the hour is full, with 429', async () => {
    await seedDemoRuns(30)

    const response = await startRun('demo')
    expect(response.status).toBe(429)
    expect(((await response.json()) as { error: string }).error).toMatch(/hourly limit/i)
  })

  it('does not limit a role that authenticates for real', async () => {
    // The window is already full from the test above — qa must be unaffected,
    // because the limit is about an anonymous shared password, not about load.
    const response = await startRun('qa')
    expect(response.status).toBe(201)
  })

  it('counts only the last hour, so old runs never hold the door shut', async () => {
    /*
     * Runs the whole scenario in its own database so the count is exact: far
     * more than the limit, all of them outside the window. If the query
     * dropped its time bound these would refuse; because they are old, the
     * next demo run must still be allowed.
     */
    await env.DB.prepare(`DELETE FROM runs WHERE triggered_by = 'demo'`).run()
    await seedDemoRuns(100, 90)

    const response = await startRun('demo')
    expect(response.status).toBe(201)
  })
})
