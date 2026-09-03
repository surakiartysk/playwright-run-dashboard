import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiError, api, isPending, type RunStatus } from '../src/api'

/**
 * The UI's logic, not its rendering.
 *
 * There is deliberately no component test here. What the components do is
 * arrange styled `div`s, and a test asserting that a card renders a card is
 * one that fails when the design changes and passes when the behaviour breaks
 * — the wrong way round. The two things in this package that can be *wrong*
 * rather than merely ugly are which runs count as in-flight (it decides
 * whether polling ever stops) and how a failed request is surfaced.
 */

afterEach(() => vi.unstubAllGlobals())

describe('isPending', () => {
  it.each(['queued', 'running'] as RunStatus[])('treats %s as in flight', (status) => {
    expect(isPending(status)).toBe(true)
  })

  /**
   * The one that matters: polling continues while any run is pending, so a
   * terminal state wrongly reported as pending means a dashboard left open all
   * afternoon keeps hitting the API forever.
   */
  it.each(['passed', 'failed', 'error', 'timeout'] as RunStatus[])(
    'treats %s as finished, so polling can stop',
    (status) => {
      expect(isPending(status)).toBe(false)
    },
  )
})

describe('the request wrapper', () => {
  const respondWith = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    )

  it('returns the parsed body on success', async () => {
    respondWith(200, { role: 'qa', expiresAt: 123 })
    await expect(api.login('qa')).resolves.toEqual({ role: 'qa', expiresAt: 123 })
  })

  it('throws an ApiError carrying the status, so callers can branch on 401', async () => {
    respondWith(401, { error: 'Session is invalid or expired' })

    await expect(api.listRuns()).rejects.toMatchObject({
      status: 401,
      message: 'Session is invalid or expired',
    })
    await expect(api.listRuns()).rejects.toBeInstanceOf(ApiError)
  })

  it("surfaces the server's message rather than a generic one", async () => {
    respondWith(403, { error: "Role 'dev' may only run against: main" })

    await expect(api.createRun({ service: 'items', tags: 'smoke' })).rejects.toThrow(
      "Role 'dev' may only run against: main",
    )
  })

  it('still throws when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502</html>', { status: 502 })),
    )

    await expect(api.listRuns()).rejects.toMatchObject({ status: 502 })
  })

  /**
   * The session is an HttpOnly cookie, so it is only sent if the request asks
   * for it. Forgetting this makes every call 401 in the cross-origin dev setup.
   */
  it('sends credentials, or the session cookie never leaves the browser', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.listRuns()

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('sends the role as JSON when previewing', async () => {
    const fetchMock = vi.fn(async () => new Response('{"previewing":"admin"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.previewRole('admin')

    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toBe('/demo/preview-role')
    expect(init).toMatchObject({ method: 'POST', body: '{"role":"admin"}' })
  })
})

describe('the gate endpoint', () => {
  const respondWith = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    )

  it('reports a closed gate that applies to the caller', async () => {
    respondWith({
      state: 'closed',
      reason: 'manual',
      opensAt: null,
      closesAt: null,
      appliesToYou: true,
    })

    await expect(api.gate()).resolves.toMatchObject({ state: 'closed', appliesToYou: true })
  })

  /**
   * `appliesToYou` is what the UI branches on, not `state`. A closed gate that
   * does not apply must not disable QA's Run button.
   */
  it('distinguishes a closed gate from one that affects you', async () => {
    respondWith({
      state: 'closed',
      reason: 'manual',
      opensAt: null,
      closesAt: null,
      appliesToYou: false,
    })

    const gate = await api.gate()
    expect(gate.state).toBe('closed')
    expect(gate.appliesToYou).toBe(false)
  })

  it('carries the reopening time when a window is set', async () => {
    respondWith({
      state: 'closed',
      reason: 'window',
      opensAt: '2026-01-01T09:00:00.000Z',
      closesAt: null,
      appliesToYou: true,
    })

    await expect(api.gate()).resolves.toMatchObject({ opensAt: '2026-01-01T09:00:00.000Z' })
  })
})
