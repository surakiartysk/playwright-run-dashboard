import { beforeAll, describe, expect, it } from 'vitest'
import { as, migrate, request } from './helpers'
import { DEMO_BRANCHES, MAX_PATTERN_REFS, SUITE_OPTIONS, refsFor } from '../src/options'

beforeAll(migrate)

/**
 * What a caller may ask for. Nothing is dispatched (decision 52), so the
 * branches come from a fixed demo list narrowed by the caller's policy — never
 * from GitHub.
 */

interface Options {
  role: string
  simulated: boolean
  maxWorkers: number
  suites: Record<string, { services: string[]; tags: string[]; refs: string[] }>
}

const get = async (role: 'dev' | 'qa' | 'admin') =>
  (await (await as(role, '/runs/options')).json()) as Options

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

  it('says every run is simulated', async () => {
    for (const role of ['dev', 'qa', 'admin'] as const) {
      expect((await get(role)).simulated).toBe(true)
    }
  })

  it('keeps a developer on main', async () => {
    expect(await get('dev')).toMatchObject({ role: 'dev', maxWorkers: 4 })
    expect((await get('dev')).suites.api!.refs).toEqual(['main'])
  })

  it('gives qa develop and the release branches, newest first, and not a feature branch', async () => {
    const qa = await get('qa')
    expect(qa).toMatchObject({ role: 'qa', maxWorkers: 8 })
    expect(qa.suites.api!.refs).toEqual(['main', 'develop', 'release/1.1.0', 'release/1.0.0'])
  })

  it('gives admin every demo branch', async () => {
    expect([...(await get('admin')).suites.api!.refs].sort()).toEqual([...DEMO_BRANCHES].sort())
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
    expect(open.suites.api!.refs).toEqual(['main', 'develop', 'release/1.1.0', 'release/1.0.0'])
  })
})

describe('refsFor', () => {
  it('offers what the role allows and the repository has', () => {
    expect(refsFor(['main', 'develop', 'release/*'], ['main', 'feature/x'])).toEqual(['main'])
    expect(refsFor(['main', 'develop', 'release/*'], ['main', 'develop'])).toEqual([
      'main',
      'develop',
    ])
  })

  /** The reason this exists: `develop` offered to QA where no such branch exists. */
  it('does not offer a branch the repository does not have', () => {
    expect(refsFor(['main', 'develop', 'release/*'], ['main'])).toEqual(['main'])
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
    expect(refsFor(['*'], null)).toEqual(['main', 'develop'])
  })

  describe('with a pattern', () => {
    const qa = ['main', 'develop', 'release/*']
    const releases = (...versions: string[]) => versions.map((v) => `release/${v}`)

    it('offers the release branches that exist, after main and develop', () => {
      expect(refsFor(qa, ['develop', ...releases('1.0.0', '1.1.0'), 'main'])).toEqual([
        'main',
        'develop',
        'release/1.1.0',
        'release/1.0.0',
      ])
    })

    it('puts the newest version first, by number and not by letter', () => {
      expect(refsFor(qa, ['main', ...releases('1.9.0', '1.10.0', '1.2.0', '2.0.0')])).toEqual([
        'main',
        ...releases('2.0.0', '1.10.0', '1.9.0', '1.2.0'),
      ])
    })

    it('offers at most MAX_PATTERN_REFS of them, the newest', () => {
      const many = Array.from({ length: 14 }, (_, n) => `release/1.${n}.0`)
      const offered = refsFor(qa, ['main', ...many])
      expect(offered).toHaveLength(1 + MAX_PATTERN_REFS)
      expect(offered[1]).toBe('release/1.13.0')
      expect(offered.at(-1)).toBe('release/1.4.0')
      expect(offered).not.toContain('release/1.3.0')
    })

    it('does not count main or develop against the cap', () => {
      const many = Array.from({ length: MAX_PATTERN_REFS }, (_, n) => `release/2.${n}.0`)
      expect(refsFor(qa, ['main', 'develop', ...many])).toHaveLength(2 + MAX_PATTERN_REFS)
    })

    it('does not offer a branch the pattern does not cover', () => {
      expect(
        refsFor(qa, ['main', 'release', 'releasefoo', 'release/1.0/x', 'release/../x', 'wip/x']),
      ).toEqual(['main'])
    })

    it('never offers the pattern itself as a branch', () => {
      expect(refsFor(qa, null)).toEqual(['main', 'develop'])
      expect(refsFor(['release/*'], null)).toEqual([])
    })

    it('leaves an any-branch role uncapped and unreordered', () => {
      const many = Array.from({ length: 14 }, (_, n) => `release/1.${n}.0`)
      expect(refsFor(['*'], ['main', ...many])).toHaveLength(15)
    })
  })

  it('offers nothing, not a made-up branch, when none of the allowed ones exist', () => {
    expect(refsFor(['develop'], ['main'])).toEqual([])
  })

  it('does not repeat a branch', () => {
    expect(refsFor(['*'], ['main', 'main'])).toEqual(['main'])
  })
})
