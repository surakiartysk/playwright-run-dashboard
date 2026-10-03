import { describe, expect, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { migrate, request } from './helpers'
import { DEV_PASSWORDS } from '../src/config'
import { LOGIN_ATTEMPTS_ALLOWED, LOGIN_WINDOW_MINUTES } from '../src/loginLimit'

beforeAll(migrate)

/**
 * The limit on wrong passwords at sign-in.
 *
 * Every test signs in from its own address. Storage is shared across the file,
 * and the address is what the limit is keyed on, so a fresh one is a fresh
 * bucket without clearing anything.
 */

let nextAddress = 1
const freshAddress = () => `203.0.113.${nextAddress++}`

const login = (address: string, password: string) =>
  request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': address },
    body: JSON.stringify({ password }),
  })

async function guessWrong(address: string, times: number) {
  for (let i = 0; i < times; i++) {
    expect((await login(address, `wrong-${i}`)).status).toBe(401)
  }
}

describe('sign-in limit', () => {
  it('refuses even the right password once an address has used its wrong ones', async () => {
    const address = freshAddress()
    await guessWrong(address, LOGIN_ATTEMPTS_ALLOWED)

    // The right password, refused: a limit that still answered 200 here would
    // tell a guesser which of its guesses had worked.
    const response = await login(address, DEV_PASSWORDS.admin)
    expect(response.status).toBe(429)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('counts each address separately', async () => {
    const guesser = freshAddress()
    await guessWrong(guesser, LOGIN_ATTEMPTS_ALLOWED)

    expect((await login(freshAddress(), DEV_PASSWORDS.qa)).status).toBe(200)
  })

  it('does not charge a right password, so signing in often is never refused', async () => {
    const address = freshAddress()
    for (let i = 0; i < LOGIN_ATTEMPTS_ALLOWED * 2; i++) {
      expect((await login(address, DEV_PASSWORDS.dev)).status).toBe(200)
    }
  })

  it("does not let demo's published password wipe the count between guesses", async () => {
    const address = freshAddress()
    await guessWrong(address, LOGIN_ATTEMPTS_ALLOWED - 1)

    // Anyone can do this: the password is on the sign-in screen.
    expect((await login(address, DEV_PASSWORDS.demo)).status).toBe(200)

    await guessWrong(address, 1)
    expect((await login(address, DEV_PASSWORDS.admin)).status).toBe(429)
  })

  it('holds against guesses sent all at once', async () => {
    /*
     * Thirty wrong passwords in flight together. Checking the count and then
     * recording a failure would let every one of them read the count before
     * any had been recorded, and all thirty would be checked.
     */
    const address = freshAddress()
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) => login(address, `parallel-${i}`)),
    )
    const checked = responses.filter((r) => r.status === 401).length

    expect(checked).toBe(LOGIN_ATTEMPTS_ALLOWED)
  })

  it('starts an address over once its window has passed', async () => {
    const address = freshAddress()
    const longAgo = new Date(Date.now() - (LOGIN_WINDOW_MINUTES + 1) * 60 * 1000).toISOString()
    await env.DB.prepare(
      `INSERT INTO login_attempts (client, attempts, window_start) VALUES (?1, ?2, ?3)`,
    )
      .bind(address, LOGIN_ATTEMPTS_ALLOWED * 5, longAgo)
      .run()

    expect((await login(address, DEV_PASSWORDS.admin)).status).toBe(200)
  })
})
