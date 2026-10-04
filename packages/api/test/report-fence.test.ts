import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { as, migrate, request, seedRun } from './helpers'
import { signReportToken } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'

beforeAll(migrate)

/**
 * A report is a third party's program served from the dashboard's own origin,
 * so what it may load and reach is fenced — decision 40.
 *
 * These pin the headers. They cannot show that a browser honours them, or that
 * a real report still renders under them; that was checked by opening an Allure
 * 3.20 report in Chromium, and the decision records what was tried.
 */
async function openReport(path = 'index.html') {
  const id = await seedRun()
  await env.DB.prepare(`UPDATE runs SET report_path = ?2 WHERE id = ?1`)
    .bind(id, `runs/${id}/index.html`)
    .run()
  await env.REPORTS.put(`runs/${id}/${path}`, 'ok')
  return request(`/reports/${id}/${path}?token=${await signReportToken(DEV_TOKEN_SECRET, id)}`)
}

/** The sources one CSP directive allows, or null if the policy does not name it. */
function sources(policy: string | null, directive: string): string[] | null {
  for (const part of (policy ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name === directive) return values
  }
  return null
}

/**
 * A source that reaches the network: anything but the page's own inline code,
 * `data:` and `blob:`. `'self'` counts — it is the API.
 */
const network = (values: string[] | null) =>
  (values ?? []).filter((value) => !["'unsafe-inline'", 'data:', 'blob:', "'none'"].includes(value))

describe('a report response', () => {
  it('lets no script in from anywhere but the page itself', async () => {
    const policy = (await openReport()).headers.get('Content-Security-Policy')

    expect(sources(policy, 'script-src')).not.toBeNull()
    expect(network(sources(policy, 'script-src'))).toEqual([])
  })

  it('lets the page connect to nothing — not even the API it is served beside', async () => {
    const policy = (await openReport()).headers.get('Content-Security-Policy')

    expect(sources(policy, 'connect-src')).not.toBeNull()
    expect(network(sources(policy, 'connect-src'))).toEqual([])
  })

  it('refuses whatever the policy does not name', async () => {
    const policy = (await openReport()).headers.get('Content-Security-Policy')

    expect(sources(policy, 'default-src')).toEqual(["'none'"])
  })

  /*
   * Compared with the entry point's policy rather than checked for a clean
   * `script-src`: a response with no policy at all has no `script-src` to be
   * unclean, and the first version of this test passed with the header removed
   * from assets.
   */
  it('carries the same policy on an asset as on the entry point', async () => {
    const entry = (await openReport()).headers.get('Content-Security-Policy')
    const asset = await openReport('app.js')

    expect(asset.status).toBe(200)
    expect(entry).not.toBeNull()
    expect(asset.headers.get('Content-Security-Policy')).toBe(entry)
  })

  it('sends no referrer, since its URL carries the token', async () => {
    expect((await openReport()).headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  /**
   * The other half of the fence lives on every other response, and the report
   * must stay out of it: a report sharing the API's opener policy would share
   * its browsing-context group, and could read a window it opened on the API.
   */
  it('carries no opener policy of its own', async () => {
    expect((await openReport()).headers.get('Cross-Origin-Opener-Policy')).toBeNull()
  })
})

describe('everything else the Worker serves', () => {
  it.each([
    ['the run list', () => as('qa', '/runs')],
    ['an endpoint that refuses', () => request('/runs')],
    ['health', () => request('/health')],
    ['a path that does not exist', () => request('/nothing-here')],
  ])('opens in a browsing-context group of its own: %s', async (_name, send) => {
    expect((await send()).headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
  })
})
