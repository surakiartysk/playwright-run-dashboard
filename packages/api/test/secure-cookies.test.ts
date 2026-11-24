import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, request, seedRun, sessionFor } from './helpers'
import { signReportToken } from '../src/crypto'
import { DEV_TOKEN_SECRET } from '../src/config'
import { adminKeyFor } from '../src/sandboxes'
import { makeTestSandbox } from './helpers'

beforeAll(migrate)

/**
 * Every cookie the Worker sets is `Secure` when the request came over HTTPS,
 * and only then — see `cookie` in auth.ts and decision 41.
 *
 * One table — the session, the admin hour and the report cookie — because the
 * property belongs to all of them, and a new one should have to be added here
 * to be trusted. Each is asked for twice, once
 * per scheme: the HTTPS half is the fix, and the HTTP half is what keeps
 * `wrangler dev` signing people in.
 */
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** An unlock with the right key, from the account listed as admin. */
async function unlock(base: string) {
  const sandbox = await makeTestSandbox()
  const cookie = (await sessionFor('admin', sandbox)).split(';')[0]!
  return request(`${base}/auth/admin`, {
    ...json({ key: await adminKeyFor(env, sandbox.id) }),
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  })
}

async function openReport(base: string) {
  const id = await seedRun()
  await env.DB.prepare(`UPDATE runs SET report_path = ?2 WHERE id = ?1`)
    .bind(id, `runs/${id}/index.html`)
    .run()
  await env.REPORTS.put(`runs/${id}/index.html`, 'ok')
  return request(`${base}/reports/${id}/?token=${await signReportToken(DEV_TOKEN_SECRET, id)}`)
}

const cookies: Array<[string, (base: string) => Promise<Response>]> = [
  ['the session, on the demo sign-in', (base) => request(`${base}/auth/demo`, json({}))],
  ['the admin hour, on unlock', unlock],
  ['the admin hour, given up', (base) => request(`${base}/auth/admin`, { method: 'DELETE' })],
  ['the report asset cookie', openReport],
]

/** The attributes of the cookie a response set first, trimmed — never a substring match. */
function attributes(response: Response): string[] {
  const header = response.headers.getSetCookie()[0]
  if (!header) throw new Error(`no Set-Cookie on a ${response.status} response`)
  return header.split(';').map((part) => part.trim())
}

describe.each(cookies)('%s', (_name, send) => {
  it('is Secure when the request came over HTTPS', async () => {
    expect(attributes(await send('https://api.test'))).toContain('Secure')
  })

  it('is not Secure over plain HTTP, so local development still keeps it', async () => {
    expect(attributes(await send('http://api.test'))).not.toContain('Secure')
  })
})
