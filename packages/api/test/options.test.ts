import { createExecutionContext, env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { as, migrate, request, sessionFor } from './helpers'
import worker from '../src/index'
import { createToken } from '../src/auth'
import { SUITE_OPTIONS, refsFor } from '../src/options'
import { clearBranchCache, suiteBranches } from '../src/branches'

beforeAll(migrate)
beforeEach(clearBranchCache)
afterEach(() => vi.unstubAllGlobals())

/**
 * What a caller may ask for.
 *
 * The test environment simulates (no `SIMULATE_DISPATCH=false`), so the paths
 * that ask GitHub are exercised with `env` overridden and `fetch` stubbed. No
 * test here reaches the network.
 */

interface Options {
  role: string
  simulated: boolean
  maxWorkers: number
  suites: Record<string, { services: string[]; tags: string[]; refs: string[]; refsFrom: string }>
}

const get = async (role: 'demo' | 'dev' | 'qa' | 'admin') =>
  (await (await as(role, '/runs/options')).json()) as Options

/** The Worker's own env, switched to a real deployment with a token. */
const SECRET = 'test-only-secret-for-a-real-looking-deployment'
const real = {
  ...env,
  SIMULATE_DISPATCH: 'false',
  // A real deployment refuses to serve without these, so the test has them.
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

const githubBranches = (byRepo: Record<string, string[]>) =>
  vi.fn(async (url: string, _init?: RequestInit) => {
    const repo = /repos\/([^/]+\/[^/]+)\/branches/.exec(url)?.[1] ?? ''
    return byRepo[repo]
      ? new Response(JSON.stringify(byRepo[repo].map((name) => ({ name }))), { status: 200 })
      : new Response('nope', { status: 404 })
  })

describe('GET /runs/options', () => {
  it('needs a session', async () => {
    expect((await request('/runs/options')).status).toBe(401)
  })

  it('offers each suite its own vocabulary', async () => {
    const body = await get('admin')
    expect(body.suites.api!.services).toEqual(SUITE_OPTIONS.api.services)
    expect(body.suites.ui!.services).toEqual(SUITE_OPTIONS.ui.services)
    expect(body.suites.api!.services).toContain('maintenance-logs')
    expect(body.suites.ui!.services).not.toContain('maintenance-logs')
    expect(body.suites.ui!.tags).toEqual(['all', 'smoke'])
  })

  it('says what the role may use, and that the run would be simulated', async () => {
    const demo = await get('demo')
    expect(demo).toMatchObject({ role: 'demo', simulated: true, maxWorkers: 2 })
    expect(demo.suites.api!.refs).toEqual(['main'])

    const qa = await get('qa')
    expect(qa).toMatchObject({ role: 'qa', maxWorkers: 8 })
    expect(qa.suites.api!.refs).toEqual(['main', 'develop', 'release'])
  })

  it('keeps a developer on main', async () => {
    expect((await get('dev')).suites.api!.refs).toEqual(['main'])
  })

  it('does not ask GitHub when the run would be simulated', async () => {
    const stub = vi.fn()
    vi.stubGlobal('fetch', stub)
    const body = await get('admin')
    expect(stub).not.toHaveBeenCalled()
    expect(body.suites.api!.refsFrom).toBe('policy')
  })

  it('does not hand a demo session the previewed role’s branches', async () => {
    const demo = await sessionFor('demo')
    const preview = await request('/demo/preview-role', {
      method: 'POST',
      headers: { Cookie: demo, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    const previewCookie = preview.headers.get('Set-Cookie')!.split(';')[0]!

    const body = (await (
      await request('/runs/options', { headers: { Cookie: `${demo}; ${previewCookie}` } })
    ).json()) as Options

    // Looking as admin changes what is shown, never what may be done.
    expect(body.role).toBe('demo')
    expect(body.maxWorkers).toBe(2)
    expect(body.suites.api!.refs).toEqual(['main'])
  })
})

describe('a key', () => {
  const issue = async (body: Record<string, unknown>) =>
    (
      (await (
        await as('admin', '/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'options test', role: 'qa', ...body }),
        })
      ).json()) as { plaintext: string }
    ).plaintext

  const withKey = async (plaintext: string) =>
    (await (
      await request('/runs/options', { headers: { Authorization: `Bearer ${plaintext}` } })
    ).json()) as Options

  /** A key may be limited below its role, and what it is told it may use is that limit. */
  it('is offered what its own limits allow, not everything its role could', async () => {
    const limited = await withKey(await issue({ allowedRefs: ['main'], maxWorkers: 3 }))
    expect(limited).toMatchObject({ role: 'qa', maxWorkers: 3 })
    expect(limited.suites.api!.refs).toEqual(['main'])

    const open = await withKey(await issue({}))
    expect(open.maxWorkers).toBe(8)
    expect(open.suites.api!.refs).toEqual(['main', 'develop', 'release'])
  })
})

describe('the branches that exist', () => {
  it('asks GitHub per suite, with the token', async () => {
    const stub = githubBranches({ 'o/api': ['main', 'develop'], 'o/ui': ['main'] })
    vi.stubGlobal('fetch', stub)

    expect(await suiteBranches(real, 'api')).toEqual(['main', 'develop'])
    expect(await suiteBranches(real, 'ui')).toEqual(['main'])
    const headers = stub.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ghp_test')
  })

  it('remembers the answer, so a page load is not a GitHub request', async () => {
    const stub = githubBranches({ 'o/api': ['main'] })
    vi.stubGlobal('fetch', stub)
    await suiteBranches(real, 'api', 0)
    await suiteBranches(real, 'api', 60_000)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('asks again once five minutes have passed', async () => {
    const stub = githubBranches({ 'o/api': ['main'] })
    vi.stubGlobal('fetch', stub)
    await suiteBranches(real, 'api', 0)
    await suiteBranches(real, 'api', 5 * 60 * 1000 + 1)
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('says it does not know, rather than that there are none, when GitHub refuses', async () => {
    vi.stubGlobal('fetch', githubBranches({}))
    expect(await suiteBranches(real, 'api')).toBeNull()
  })

  it('says it does not know when GitHub is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(await suiteBranches(real, 'api')).toBeNull()
  })

  it('does not ask without a token, or for an unconfigured suite', async () => {
    const stub = vi.fn()
    vi.stubGlobal('fetch', stub)
    expect(await suiteBranches({ ...real, GITHUB_TOKEN: undefined }, 'api')).toBeNull()
    expect(await suiteBranches({ ...real, GITHUB_UI_REPO: undefined }, 'ui')).toBeNull()
    expect(stub).not.toHaveBeenCalled()
  })

  it('remembers a failure briefly too, so an outage is not a request per page load', async () => {
    const stub = githubBranches({})
    vi.stubGlobal('fetch', stub)
    await suiteBranches(real, 'api', 0)
    await suiteBranches(real, 'api', 1000)
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('refsFor', () => {
  it('offers what the role allows and the repository has', () => {
    expect(refsFor(['main', 'develop', 'release'], ['main', 'feature/x'])).toEqual(['main'])
    expect(refsFor(['main', 'develop', 'release'], ['main', 'develop'])).toEqual([
      'main',
      'develop',
    ])
  })

  /** The reason this exists: `develop` offered to QA where no such branch exists. */
  it('does not offer a branch the repository does not have', () => {
    expect(refsFor(['main', 'develop', 'release'], ['main'])).toEqual(['main'])
  })

  it('offers every existing branch to a role that may use any', () => {
    expect(refsFor(['*'], ['main', 'zeta', 'alpha'])).toEqual(['main', 'alpha', 'zeta'])
  })

  it('puts main first', () => {
    expect(refsFor(['*'], ['alpha', 'main'])[0]).toBe('main')
  })

  it('falls back to the policy’s own list when the branches are unknown', () => {
    expect(refsFor(['main', 'develop'], null)).toEqual(['main', 'develop'])
    expect(refsFor(['main'], null)).toEqual(['main'])
  })

  it('falls back to the common branches for an any-branch role, which a list cannot enumerate', () => {
    expect(refsFor(['*'], null)).toEqual(['main', 'develop', 'release'])
  })

  it('offers nothing, not a made-up branch, when none of the allowed ones exist', () => {
    expect(refsFor(['develop'], ['main'])).toEqual([])
  })

  it('does not repeat a branch', () => {
    expect(refsFor(['*'], ['main', 'main'])).toEqual(['main'])
  })
})

describe('GET /runs/options on a real deployment', () => {
  /** The Worker with a real env: `request()` always uses the test env, which simulates. */
  const asReal = async (role: 'qa' | 'admin') =>
    (await (
      await worker.fetch(
        new Request('http://api.test/runs/options', {
          headers: { Cookie: `session=${(await createToken(SECRET, role)).token}` },
        }),
        real,
        createExecutionContext(),
      )
    ).json()) as Options

  it('offers each suite the branches it really has, narrowed to the role', async () => {
    vi.stubGlobal(
      'fetch',
      githubBranches({ 'o/api': ['main', 'develop', 'wip/x'], 'o/ui': ['main'] }),
    )
    const qa = await asReal('qa')
    expect(qa.simulated).toBe(false)
    expect(qa.suites.api).toMatchObject({ refs: ['main', 'develop'], refsFrom: 'github' })
    expect(qa.suites.ui).toMatchObject({ refs: ['main'], refsFrom: 'github' })
  })

  /** Demo always simulates, whatever the deployment says, so it never costs a GitHub request. */
  it('does not ask GitHub for a demo session even on a real deployment with a token', async () => {
    const stub = githubBranches({ 'o/api': ['main', 'develop'], 'o/ui': ['main'] })
    vi.stubGlobal('fetch', stub)
    const response = await worker.fetch(
      new Request('http://api.test/runs/options', {
        headers: { Cookie: `session=${(await createToken(SECRET, 'demo')).token}` },
      }),
      real,
      createExecutionContext(),
    )
    const body = (await response.json()) as Options
    expect(stub).not.toHaveBeenCalled()
    expect(body).toMatchObject({ role: 'demo', simulated: true })
    expect(body.suites.api!.refsFrom).toBe('policy')
  })

  it('offers an admin every branch a suite has', async () => {
    vi.stubGlobal('fetch', githubBranches({ 'o/api': ['main', 'wip/x'], 'o/ui': ['main'] }))
    expect((await asReal('admin')).suites.api!.refs).toEqual(['main', 'wip/x'])
  })

  it('says where the branches came from, and falls back to the policy when GitHub says no', async () => {
    vi.stubGlobal('fetch', githubBranches({}))
    const qa = await asReal('qa')
    expect(qa.suites.api).toMatchObject({
      refs: ['main', 'develop', 'release'],
      refsFrom: 'policy',
    })
  })
})
