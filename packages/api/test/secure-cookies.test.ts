import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, request, seedRun, sessionFor } from './helpers'
import { signReportToken } from '../src/crypto'
import { DEV_PASSWORDS, DEV_TOKEN_SECRET } from '../src/config'

beforeAll(migrate)

/**
 * Every cookie the Worker sets is `Secure` when the request came over HTTPS,
 * and only then — see `cookie` in auth.ts and decision 41.
 *
 * One table — three cookies, set or cleared in five places — because the
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

const asDemo = async (body?: unknown) => ({
  ...json(body ?? {}),
  headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('demo') },
})

async function openReport(base: string) {
  const id = await seedRun()
  await env.DB.prepare(`UPDATE runs SET report_path = ?2 WHERE id = ?1`)
    .bind(id, `runs/${id}/index.html`)
    .run()
  await env.REPORTS.put(`runs/${id}/index.html`, 'ok')
  return request(`${base}/reports/${id}/?token=${await signReportToken(DEV_TOKEN_SECRET, id)}`)
}

const cookies: Array<[string, (base: string) => Promise<Response>]> = [
  [
    'the session, on sign-in',
    (base) => request(`${base}/auth/login`, json({ password: DEV_PASSWORDS.qa })),
  ],
  ['the session, cleared on sign-out', (base) => request(`${base}/auth/logout`, json({}))],
  [
    'the preview role, on preview',
    async (base) => request(`${base}/demo/preview-role`, await asDemo({ role: 'qa' })),
  ],
  [
    'the preview role, cleared',
    async (base) => request(`${base}/demo/stop-preview`, await asDemo()),
  ],
  ['the report asset cookie', openReport],
]

/** The attributes of the one cookie a response set, trimmed — never a substring match. */
function attributes(response: Response): string[] {
  const header = response.headers.get('Set-Cookie')
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
