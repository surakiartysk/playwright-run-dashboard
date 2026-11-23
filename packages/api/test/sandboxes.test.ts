import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import {
  emailFor,
  makeTestSandbox,
  migrate,
  postWebhook,
  request,
  seedRun,
  sessionFor,
  uniqueService,
} from './helpers'
import { pruneSandboxes } from '../src/sandboxes'
import { MEMBERS_MAX } from '../src/members'
import type { RunView } from '../src/types'

beforeAll(migrate)

/**
 * A sandbox for each visitor (decision 52).
 *
 * The property the whole design rests on: what one visitor makes, another
 * cannot see, change or delete; and the real runs from the suites' CI are
 * seen by every visitor and changed by none. Each test makes the sandboxes it
 * needs, so nothing here depends on what another test left behind.
 */

type Box = { id: string; expires_at: string }

const call = async (box: Box, role: 'dev' | 'qa' | 'admin', path: string, init: RequestInit = {}) =>
  request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: await sessionFor(role, box),
      ...(init.headers ?? {}),
    },
  })

const listed = async (box: Box, role: 'dev' | 'qa' | 'admin', service: string) => {
  const { runs } = (await (await call(box, role, `/runs?limit=100&service=${service}`)).json()) as {
    runs: RunView[]
  }
  return runs.map((run) => run.id).sort()
}

describe('what a visitor sees', () => {
  it('their own sandbox’s runs and the real ones, never another sandbox’s', async () => {
    const service = uniqueService()
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    const own = await seedRun({ service, sandboxId: mine.id })
    const real = await seedRun({ service })
    await seedRun({ service, sandboxId: theirs.id })

    expect(await listed(mine, 'qa', service)).toEqual([own, real].sort())
  })

  it('counts in the total only what it may see', async () => {
    const service = uniqueService()
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    await seedRun({ service, sandboxId: theirs.id })
    await seedRun({ service, sandboxId: theirs.id })
    await seedRun({ service, sandboxId: mine.id })

    const page = (await (await call(mine, 'admin', `/runs?service=${service}`)).json()) as {
      total: number
    }
    expect(page.total).toBe(1)
  })

  it('answers another sandbox’s run as no such run', async () => {
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    const id = await seedRun({ sandboxId: theirs.id })
    expect((await call(mine, 'admin', `/runs/${id}`)).status).toBe(404)
    expect((await call(theirs, 'admin', `/runs/${id}`)).status).toBe(200)
  })

  /*
   * Simulated rows from before sandboxes have no sandbox. Without the
   * `simulated = 0` half of the clause, every visitor would see them as real.
   */
  it('does not pass off an old simulated run as a real one', async () => {
    const service = uniqueService()
    const box = await makeTestSandbox()
    await seedRun({ service, simulated: true })
    expect(await listed(box, 'admin', service)).toEqual([])
  })

  it('keeps a developer on main, of the real runs and their own alike', async () => {
    const service = uniqueService()
    const box = await makeTestSandbox()
    const ownMain = await seedRun({ service, sandboxId: box.id, ref: 'main' })
    await seedRun({ service, sandboxId: box.id, ref: 'develop' })
    await seedRun({ service, ref: 'develop' })
    expect(await listed(box, 'dev', service)).toEqual([ownMain])
  })

  it('starts a run into its own sandbox, seen by nobody else', async () => {
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    const created = await call(mine, 'dev', '/runs', {
      method: 'POST',
      body: JSON.stringify({ service: 'items', tags: 'all' }),
    })
    const { runId } = (await created.json()) as { runId: string }
    expect((await call(mine, 'dev', `/runs/${runId}`)).status).toBe(200)
    expect((await call(theirs, 'admin', `/runs/${runId}`)).status).toBe(404)
  })
})

describe('the admin page’s members', () => {
  const members = async (box: Box) =>
    (
      (await (await call(box, 'admin', '/demo/admin/members')).json()) as {
        members: { email: string; role: string }[]
      }
    ).members

  it.each(['dev', 'qa'] as const)('are refused to %s', async (role) => {
    const box = await makeTestSandbox()
    expect((await call(box, role, '/demo/admin/members')).status).toBe(403)
  })

  it('are refused to the account listed as admin until the key is given', async () => {
    const box = await makeTestSandbox()
    const listedOnly = (await sessionFor('admin', box)).split(';')[0]!
    const response = await request('/demo/admin/members', { headers: { Cookie: listedOnly } })
    expect(response.status).toBe(403)
  })

  it('takes a new account, which may then sign in', async () => {
    const box = await makeTestSandbox()
    const added = await call(box, 'admin', '/demo/admin/members', {
      method: 'PUT',
      body: JSON.stringify({ email: 'new.person@demo.testbydesign.dev', role: 'qa' }),
    })
    expect(added.status).toBe(201)
    expect(await members(box)).toContainEqual(
      expect.objectContaining({ email: 'new.person@demo.testbydesign.dev', role: 'qa' }),
    )

    const signIn = await request('/auth/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: await sessionFor('dev', box) },
      body: JSON.stringify({ email: 'new.person@demo.testbydesign.dev' }),
    })
    expect(signIn.status).toBe(200)
  })

  it('changes a member’s role', async () => {
    const box = await makeTestSandbox()
    await call(box, 'admin', '/demo/admin/members', {
      method: 'PUT',
      body: JSON.stringify({ email: emailFor('dev'), role: 'qa' }),
    })
    expect(await members(box)).toContainEqual(
      expect.objectContaining({ email: emailFor('dev'), role: 'qa' }),
    )
  })

  it('removes a member', async () => {
    const box = await makeTestSandbox()
    const removed = await call(
      box,
      'admin',
      `/demo/admin/members/${encodeURIComponent(emailFor('qa'))}`,
      {
        method: 'DELETE',
      },
    )
    expect(removed.status).toBe(200)
    expect((await members(box)).map((m) => m.email)).not.toContain(emailFor('qa'))
  })

  /* A sandbox nobody can administer is one whose lockdown nobody can lift. */
  it('will not remove or demote the last admin', async () => {
    const box = await makeTestSandbox()
    const self = encodeURIComponent(emailFor('admin'))
    expect(
      (await call(box, 'admin', `/demo/admin/members/${self}`, { method: 'DELETE' })).status,
    ).toBe(409)
    expect(
      (
        await call(box, 'admin', '/demo/admin/members', {
          method: 'PUT',
          body: JSON.stringify({ email: emailFor('admin'), role: 'dev' }),
        })
      ).status,
    ).toBe(409)
  })

  it('demotes an admin once there is another', async () => {
    const box = await makeTestSandbox()
    await call(box, 'admin', '/demo/admin/members', {
      method: 'PUT',
      body: JSON.stringify({ email: emailFor('qa'), role: 'admin' }),
    })
    const demoted = await call(box, 'admin', '/demo/admin/members', {
      method: 'PUT',
      body: JSON.stringify({ email: emailFor('admin'), role: 'dev' }),
    })
    expect(demoted.status).toBe(200)
  })

  it('refuses a list longer than a demo needs', async () => {
    const box = await makeTestSandbox()
    for (let i = 0; i < MEMBERS_MAX - 3; i++) {
      await call(box, 'admin', '/demo/admin/members', {
        method: 'PUT',
        body: JSON.stringify({ email: `p${i}@demo.testbydesign.dev`, role: 'dev' }),
      })
    }
    const over = await call(box, 'admin', '/demo/admin/members', {
      method: 'PUT',
      body: JSON.stringify({ email: 'one.more@demo.testbydesign.dev', role: 'dev' }),
    })
    expect(over.status).toBe(409)
  })

  it.each([
    ['an address that is not one', { email: 'nope', role: 'qa' }],
    ['a role that does not exist', { email: 'a@b.co', role: 'owner' }],
  ])('refuses %s', async (_label, body) => {
    const box = await makeTestSandbox()
    expect(
      (
        await call(box, 'admin', '/demo/admin/members', {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(422)
  })

  it('touches only its own sandbox', async () => {
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    await call(mine, 'admin', `/demo/admin/members/${encodeURIComponent(emailFor('qa'))}`, {
      method: 'DELETE',
    })
    expect((await members(theirs)).map((m) => m.email)).toContain(emailFor('qa'))
  })
})

describe('lockdown', () => {
  const lock = (box: Box, on: boolean) =>
    call(box, 'admin', '/demo/admin/lockdown', { method: 'PUT', body: JSON.stringify({ on }) })

  it('refuses everyone in the sandbox but its admin', async () => {
    const box = await makeTestSandbox()
    expect((await lock(box, true)).status).toBe(200)

    for (const role of ['dev', 'qa'] as const) {
      const response = await call(box, role, '/runs')
      expect(response.status, role).toBe(403)
      expect(await response.json()).toMatchObject({ locked: true })
    }
    expect((await call(box, 'admin', '/runs')).status).toBe(200)
  })

  it('refuses a key that is not admin’s', async () => {
    const box = await makeTestSandbox()
    const issued = (await (
      await call(box, 'admin', '/keys', {
        method: 'POST',
        body: JSON.stringify({ label: 'pipeline', role: 'qa' }),
      })
    ).json()) as { plaintext: string }
    await lock(box, true)
    const response = await request('/runs', {
      headers: { Authorization: `Bearer ${issued.plaintext}` },
    })
    expect(response.status).toBe(403)
  })

  it('lifts', async () => {
    const box = await makeTestSandbox()
    await lock(box, true)
    await lock(box, false)
    expect((await call(box, 'dev', '/runs')).status).toBe(200)
  })

  it('locks only its own sandbox', async () => {
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    await lock(mine, true)
    expect((await call(theirs, 'dev', '/runs')).status).toBe(200)
  })

  it('takes only a true or a false', async () => {
    const box = await makeTestSandbox()
    const response = await call(box, 'admin', '/demo/admin/lockdown', {
      method: 'PUT',
      body: JSON.stringify({ on: 'yes' }),
    })
    expect(response.status).toBe(422)
  })
})

describe('activity', () => {
  it('records what was done, by whom, newest first', async () => {
    const box = await makeTestSandbox()
    await call(box, 'admin', '/demo/admin/lockdown', {
      method: 'PUT',
      body: JSON.stringify({ on: true }),
    })
    await call(box, 'admin', '/demo/admin/lockdown', {
      method: 'PUT',
      body: JSON.stringify({ on: false }),
    })

    const { entries } = (await (await call(box, 'admin', '/demo/admin/activity')).json()) as {
      entries: { action: string; actor: string }[]
    }
    expect(entries.slice(0, 2).map((e) => e.action)).toEqual(['lockdown-off', 'lockdown-on'])
    expect(entries[0]!.actor).toBe(emailFor('admin'))
  })

  it('shows one sandbox nothing of another’s', async () => {
    const mine = await makeTestSandbox()
    const theirs = await makeTestSandbox()
    await call(theirs, 'admin', '/demo/admin/lockdown', {
      method: 'PUT',
      body: JSON.stringify({ on: false }),
    })
    const { entries } = (await (await call(mine, 'admin', '/demo/admin/activity')).json()) as {
      entries: unknown[]
    }
    expect(entries).toEqual([])
  })

  it.each(['dev', 'qa'] as const)('is refused to %s', async (role) => {
    const box = await makeTestSandbox()
    expect((await call(box, role, '/demo/admin/activity')).status).toBe(403)
  })
})

describe('the admin page refuses keys', () => {
  it.each([
    ['GET', '/demo/admin/members'],
    ['GET', '/demo/admin/activity'],
    ['PUT', '/demo/admin/lockdown'],
  ])('%s %s, even with an admin key', async (method, path) => {
    const box = await makeTestSandbox()
    const issued = (await (
      await call(box, 'admin', '/keys', {
        method: 'POST',
        body: JSON.stringify({ label: 'release', role: 'admin' }),
      })
    ).json()) as { plaintext: string }
    const response = await request(path, {
      method,
      headers: { Authorization: `Bearer ${issued.plaintext}`, 'Content-Type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ on: true }) } : {}),
    })
    expect(response.status).toBe(403)
  })
})

describe('keys a member mints', () => {
  it('belong to the sandbox and carry the member’s role', async () => {
    const box = await makeTestSandbox()
    const minted = await call(box, 'qa', '/demo/keys', { method: 'POST' })
    expect(minted.status).toBe(201)
    const { key } = (await minted.json()) as { key: string }
    const options = (await (
      await request('/runs/options', { headers: { Authorization: `Bearer ${key}` } })
    ).json()) as { role: string }
    expect(options.role).toBe('qa')
  })

  it('are not minted for admin, whose keys are issued with a label', async () => {
    const box = await makeTestSandbox()
    expect((await call(box, 'admin', '/demo/keys', { method: 'POST' })).status).toBe(403)
  })

  it('die with their sandbox', async () => {
    const box = await makeTestSandbox()
    const { key } = (await (await call(box, 'dev', '/demo/keys', { method: 'POST' })).json()) as {
      key: string
    }
    await env.DB.prepare(`UPDATE sandboxes SET expires_at = ?2 WHERE id = ?1`)
      .bind(box.id, new Date(Date.now() - 1000).toISOString())
      .run()
    expect((await request('/runs', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(
      401,
    )
  })
})

describe('a real run from a suite’s CI', () => {
  const ciRun = (over: Record<string, unknown> = {}) => ({
    runId: `ci-${Math.random().toString(36).slice(2, 10)}`,
    status: 'passed',
    total: 12,
    passed: 12,
    failed: 0,
    durationMs: 30_000,
    suite: 'api',
    service: 'items',
    tags: 'all',
    ref: 'main',
    ...over,
  })

  it('is recorded when it reports, and every sandbox sees it', async () => {
    const payload = ciRun()
    const response = await postWebhook(payload)
    expect(response.status).toBe(201)

    for (const box of [await makeTestSandbox(), await makeTestSandbox()]) {
      const read = (await (await call(box, 'dev', `/runs/${payload.runId}`)).json()) as RunView
      expect(read).toMatchObject({ status: 'passed', simulated: false, triggeredBy: 'ci' })
    }
  })

  it('cannot be deleted by any sandbox’s admin', async () => {
    const payload = ciRun()
    await postWebhook(payload)
    const box = await makeTestSandbox()
    expect((await call(box, 'admin', `/runs/${payload.runId}`, { method: 'DELETE' })).status).toBe(
      404,
    )
  })

  it('is not overwritten by a second report under the same id', async () => {
    const payload = ciRun()
    expect((await postWebhook(payload)).status).toBe(201)
    // The existing row is updated by the ordinary path, not inserted again.
    expect(
      (await postWebhook({ ...payload, status: 'failed', failed: 1, passed: 11 })).status,
    ).toBe(200)
  })

  /*
   * A sandbox's run id is not a CI run's. A signed callback naming one must
   * not reach into a visitor's sandbox and rewrite its result.
   */
  it('cannot rewrite a sandbox’s run', async () => {
    const box = await makeTestSandbox()
    const id = await seedRun({ sandboxId: box.id, status: 'queued' })
    const response = await postWebhook(ciRun({ runId: id, status: 'failed' }))
    expect(response.status).toBe(409)
    const read = (await (await call(box, 'admin', `/runs/${id}`)).json()) as RunView
    expect(read.status).toBe('queued')
  })

  it.each([
    ['a suite that does not exist', { suite: 'mobile' }],
    ['a service that is not a name', { service: 'Items; DROP' }],
    ['a ref that is not one', { ref: 'has space' }],
    ['a run id with a slash', { runId: '../x' }],
  ])('refuses %s', async (_label, over) => {
    expect((await postWebhook(ciRun(over))).status).toBe(422)
  })
})

describe('pruneSandboxes', () => {
  it('removes an expired sandbox and everything it held, and nothing else', async () => {
    const expired = await makeTestSandbox({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const alive = await makeTestSandbox()
    const gone = await seedRun({ sandboxId: expired.id })
    const kept = await seedRun({ sandboxId: alive.id })
    const real = await seedRun()

    await pruneSandboxes(env.DB)

    const exists = async (table: string, column: string, value: string) =>
      (await env.DB.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?1`).bind(value).first()) !==
      null
    expect(await exists('sandboxes', 'id', expired.id)).toBe(false)
    expect(await exists('members', 'sandbox_id', expired.id)).toBe(false)
    expect(await exists('sandbox_gate', 'sandbox_id', expired.id)).toBe(false)
    expect(await exists('runs', 'id', gone)).toBe(false)
    expect(await exists('sandboxes', 'id', alive.id)).toBe(true)
    expect(await exists('runs', 'id', kept)).toBe(true)
    expect(await exists('runs', 'id', real)).toBe(true)
  })
})
