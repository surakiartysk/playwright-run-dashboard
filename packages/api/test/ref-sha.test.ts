import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, seedRun } from './helpers'
import { recordRefSha } from '../src/branches'
import worker from '../src/index'
import { createToken } from '../src/auth'

beforeAll(migrate)
afterEach(() => vi.unstubAllGlobals())

/**
 * Writing down which commit a branch was at when a run was dispatched, so a run
 * that is still queued can say what it is running.
 */

const SECRET = 'test-only-secret-for-a-real-looking-deployment'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const real = {
  ...env,
  SIMULATE_DISPATCH: 'false',
  WEBHOOK_SECRET: SECRET,
  TOKEN_SECRET: SECRET,
  ADMIN_PASSWORD: 'a',
  QA_PASSWORD: 'q',
  DEV_PASSWORD: 'd',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_REPO: 'o/api',
  GITHUB_WORKFLOW: 'on-demand.yml',
  GITHUB_UI_REPO: 'o/ui',
  GITHUB_UI_WORKFLOW: 'on-demand.yml',
}

const shaOf = async (id: string) =>
  (
    await env.DB.prepare(`SELECT suite_sha FROM runs WHERE id = ?1`)
      .bind(id)
      .first<{ suite_sha: string | null }>()
  )?.suite_sha

const github = (commit: Response | Error = new Response(JSON.stringify({ sha: SHA }))) =>
  vi.fn(async (url: string, _init?: RequestInit) => {
    if (String(url).includes('/dispatches')) return new Response(null, { status: 204 })
    if (commit instanceof Error) throw commit
    return commit.clone()
  })

describe('recordRefSha', () => {
  it('writes the commit the branch is at onto the run', async () => {
    vi.stubGlobal('fetch', github())
    const id = await seedRun()
    await recordRefSha(real, id, 'api', 'main')
    expect(await shaOf(id)).toBe(SHA)
  })

  it('asks the suite’s own repository, for the branch that was chosen', async () => {
    const stub = github()
    vi.stubGlobal('fetch', stub)
    const id = await seedRun()
    await recordRefSha(real, id, 'ui', 'release/1.4')
    expect(String(stub.mock.calls[0]![0])).toBe(
      'https://api.github.com/repos/o/ui/commits/release%2F1.4',
    )
  })

  /** The workflow's own report is the fact; this is the guess made earlier. */
  it('does not replace a commit the run already reported', async () => {
    vi.stubGlobal('fetch', github())
    const id = await seedRun()
    await env.DB.prepare(`UPDATE runs SET suite_sha = 'feedbeef' WHERE id = ?1`).bind(id).run()
    await recordRefSha(real, id, 'api', 'main')
    expect(await shaOf(id)).toBe('feedbeef')
  })

  it.each([
    ['GitHub refusing', new Response('no', { status: 404 })],
    [
      'an error that happens to carry a sha',
      new Response(JSON.stringify({ sha: SHA }), { status: 500 }),
    ],
    ['a reply that is not a commit', new Response(JSON.stringify({ message: 'x' }))],
    ['a sha that is not hex', new Response(JSON.stringify({ sha: 'not a sha; DROP' }))],
    ['unreachable', new Error('network')],
  ])('leaves the run as it was on %s, and does not throw', async (_label, reply) => {
    vi.stubGlobal('fetch', github(reply))
    const id = await seedRun()
    await expect(recordRefSha(real, id, 'api', 'main')).resolves.toBeUndefined()
    expect(await shaOf(id)).toBeNull()
  })

  it('does not ask without a token or for an unconfigured suite', async () => {
    const stub = github()
    vi.stubGlobal('fetch', stub)
    const id = await seedRun()
    await recordRefSha({ ...real, GITHUB_TOKEN: undefined }, id, 'api', 'main')
    await recordRefSha({ ...real, GITHUB_UI_REPO: undefined }, id, 'ui', 'main')
    expect(stub).not.toHaveBeenCalled()
  })
})

describe('POST /runs', () => {
  const start = async (role: 'admin' | 'demo', settle = true) => {
    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request('http://api.test/runs', {
        method: 'POST',
        headers: {
          Cookie: `session=${(await createToken(SECRET, role)).token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ service: 'items', tags: 'all', ref: 'main' }),
      }),
      real,
      ctx,
    )
    // A simulated run's background work sleeps for seconds on purpose; a test
    // that is only about what was *not* called need not sit through it.
    if (settle) await waitOnExecutionContext(ctx)
    return (await response.json()) as { runId: string }
  }

  it('notes the commit once a real dispatch has gone out', async () => {
    vi.stubGlobal('fetch', github())
    const { runId } = await start('admin')
    expect(await shaOf(runId)).toBe(SHA)
  })

  it('does not ask GitHub about a run that is only simulated', async () => {
    const stub = github()
    vi.stubGlobal('fetch', stub)
    const { runId } = await start('demo', false)
    expect(stub).not.toHaveBeenCalled()
    expect(await shaOf(runId)).toBeNull()
  })
})
