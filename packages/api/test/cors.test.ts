import { describe, expect, it, beforeAll } from 'vitest'
import { migrate, request, as } from './helpers'

beforeAll(migrate)

/**
 * The CORS allowlist, which nothing was checking.
 *
 * Both mutations survived a full run: widening `origin` to `*` and turning
 * `credentials` off. The first is the misconfiguration that matters — a
 * wildcard origin *with* credentials lets any page a signed-in user visits
 * read their runs, their role, and the report links in the response.
 *
 * The allowlist exists only because development splits the UI (5173) and the
 * Worker (8787) across origins. In a real deployment both are same-origin and
 * none of this applies, which is exactly why it could be widened without
 * anyone noticing locally.
 */
const ALLOWED = 'http://localhost:5173'
const HOSTILE = 'https://evil.example'

describe('CORS on the authenticated surfaces', () => {
  it.each(['/auth/login', '/demo/roles', '/runs', '/gate'])(
    'echoes the development origin back for %s',
    async (path) => {
      const response = await request(path, { headers: { Origin: ALLOWED } })

      expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    },
  )

  /**
   * The one that matters. A browser only hands a cross-origin response to a
   * page when the origin is echoed, so an unlisted origin getting nothing back
   * is what stops another site reading a signed-in user's data.
   */
  it.each(['/auth/login', '/demo/roles', '/runs', '/gate'])(
    'refuses an unlisted origin for %s',
    async (path) => {
      const response = await request(path, { headers: { Origin: HOSTILE } })

      expect(response.headers.get('access-control-allow-origin')).not.toBe(HOSTILE)
      expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
    },
  )

  /**
   * `*` and credentials together is the combination browsers refuse outright,
   * and asserting it separately keeps the two mutations distinguishable: one
   * widens the origin, the other drops the credential flag.
   */
  it('never answers with a wildcard origin', async () => {
    for (const origin of [ALLOWED, HOSTILE]) {
      const response = await as('qa', '/runs', { headers: { Origin: origin } })
      expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
    }
  })

  it('allows credentials, or the session cookie never crosses in development', async () => {
    const response = await request('/runs', { headers: { Origin: ALLOWED } })

    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  /**
   * Health is unauthenticated and carries nothing, so it is deliberately not
   * on the allowlist. Asserting that keeps the list a decision rather than a
   * thing that grows by habit.
   */
  it('leaves the health check out of the allowlist', async () => {
    const response = await request('/health', { headers: { Origin: ALLOWED } })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
