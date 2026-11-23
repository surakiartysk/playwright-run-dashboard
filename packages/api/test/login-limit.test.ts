import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { makeTestSandbox, migrate, request, sessionFor } from './helpers'
import { LOGIN_ATTEMPTS_ALLOWED, LOGIN_WINDOW_MINUTES } from '../src/loginLimit'
import { adminKeyFor } from '../src/sandboxes'

beforeAll(migrate)

/**
 * The limit on wrong admin keys (decisions 28 and 52).
 *
 * Every test uses its own sandbox, so each account's bucket is fresh without
 * clearing anything. The account is the one listed as admin, signed in without
 * the admin cookie: listed, and not yet unlocked.
 */

async function listedAdmin() {
  const sandbox = await makeTestSandbox()
  // The admin account's session without the admin cookie: listed, not unlocked.
  const cookie = (await sessionFor('admin', sandbox)).split(';')[0]!
  return { sandbox, cookie }
}

const unlock = (cookie: string, key: string) =>
  request('/auth/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ key }),
  })

async function guessWrong(cookie: string, times: number) {
  for (let i = 0; i < times; i++) {
    expect((await unlock(cookie, `wrong-${i}`)).status).toBe(401)
  }
}

describe('admin key limit', () => {
  it('refuses even the right key once the account has used its wrong ones', async () => {
    const { sandbox, cookie } = await listedAdmin()
    await guessWrong(cookie, LOGIN_ATTEMPTS_ALLOWED)

    // The right key, refused: a limit that still answered 200 here would tell
    // a guesser which of its guesses had worked.
    const response = await unlock(cookie, await adminKeyFor(env, sandbox.id))
    expect(response.status).toBe(429)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('counts each sandbox’s admin separately', async () => {
    const guesser = await listedAdmin()
    await guessWrong(guesser.cookie, LOGIN_ATTEMPTS_ALLOWED)

    const other = await listedAdmin()
    expect((await unlock(other.cookie, await adminKeyFor(env, other.sandbox.id))).status).toBe(200)
  })

  it('does not charge a right key, so unlocking often is never refused', async () => {
    const { sandbox, cookie } = await listedAdmin()
    const key = await adminKeyFor(env, sandbox.id)
    for (let i = 0; i < LOGIN_ATTEMPTS_ALLOWED * 2; i++) {
      expect((await unlock(cookie, key)).status).toBe(200)
    }
  })

  it('holds against guesses sent all at once', async () => {
    const { cookie } = await listedAdmin()
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) => unlock(cookie, `parallel-${i}`)),
    )
    expect(responses.filter((r) => r.status === 401).length).toBe(LOGIN_ATTEMPTS_ALLOWED)
  })

  it('starts an account over once its window has passed', async () => {
    const { sandbox, cookie } = await listedAdmin()
    const longAgo = new Date(Date.now() - (LOGIN_WINDOW_MINUTES + 1) * 60 * 1000).toISOString()
    await env.DB.prepare(
      `INSERT INTO login_attempts (client, attempts, window_start) VALUES (?1, ?2, ?3)`,
    )
      .bind(`admin:${sandbox.id}:admin@demo.testbydesign.dev`, LOGIN_ATTEMPTS_ALLOWED * 5, longAgo)
      .run()

    expect((await unlock(cookie, await adminKeyFor(env, sandbox.id))).status).toBe(200)
  })
})
