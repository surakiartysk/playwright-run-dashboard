import type { Role } from '../src/api'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KEY_VARIABLE, optionsCurl, quote, runCurl } from '../src/curl'
import { ApiSnippet, SnippetView, limitsLine } from '../src/components/ApiSnippet'
import { initialForm } from '../src/run-form'
import { runOptions } from './fixtures'

/**
 * The commands that do from a terminal what the form does with a button.
 *
 * They are meant to be pasted, so what is held is that pasting gives the same
 * request: the form's selection is the body, the key comes from the
 * environment, and no value can break out of the quoting.
 */

const ORIGIN = 'https://runs.example.dev'
const form = initialForm(runOptions(), { service: 'items', tags: 'smoke', workers: 2 })

describe('quote', () => {
  it('wraps a value as one shell word', () => {
    expect(quote('abc')).toBe("'abc'")
  })

  /** Nothing in a value may end the quoting: a branch name is typed by a person. */
  it('survives a single quote in the value', () => {
    expect(quote("it's")).toBe("'it'\\''s'")
  })

  it.each(["a'b", "'", "''", "x'; rm -rf ~; echo '", '$(whoami)', '`id`', 'a b'])(
    'turns %j into something a shell reads back unchanged',
    (value) => {
      // Undo the quoting the way a shell does: the escape sequence is a quote.
      const readBack = quote(value).slice(1, -1).replace(/'\\''/g, "'")
      expect(readBack).toBe(value)
      // And no bare quote is left inside, which is what would end the word early.
      expect(quote(value).slice(1, -1).replace(/'\\''/g, '')).not.toContain("'")
    },
  )
})

describe('runCurl', () => {
  const text = runCurl(form, ORIGIN)

  it('posts to /runs on the origin it is shown on', () => {
    expect(text).toContain(`curl -X POST '${ORIGIN}/runs'`)
  })

  it('reads the key from the environment, never writing it into the command', () => {
    expect(text).toContain(`Authorization: Bearer $${KEY_VARIABLE}`)
    expect(text).not.toMatch(/rdk_/)
  })

  it('sends exactly what the form holds, as JSON', () => {
    const body = /-d '(.*)'$/.exec(text)![1]!
    expect(JSON.parse(body)).toEqual({
      suite: 'api',
      service: 'items',
      tags: 'smoke',
      ref: 'main',
      workers: 2,
    })
  })

  it('follows the form: another selection is another command', () => {
    const other = runCurl(
      { ...form, suite: 'ui', service: 'auth', ref: 'develop', workers: 3 },
      ORIGIN,
    )
    const body = JSON.parse(/-d '(.*)'$/.exec(other)![1]!)
    expect(body).toMatchObject({ suite: 'ui', service: 'auth', ref: 'develop', workers: 3 })
  })

  it('declares its content type', () => {
    expect(text).toContain('Content-Type: application/json')
  })

  it('is one command across lines, each continued', () => {
    const lines = text.split('\n')
    expect(lines).toHaveLength(4)
    for (const line of lines.slice(0, -1)) expect(line.endsWith('\\')).toBe(true)
    expect(lines.at(-1)!.endsWith('\\')).toBe(false)
  })

  it('cannot be broken out of by a value with a quote in it', () => {
    const hostile = runCurl({ ...form, ref: "x'; echo pwned; echo '" }, ORIGIN)
    const body = /-d (.*)$/.exec(hostile)![1]!
    // The body is one quoted word: the only bare quotes are its two ends.
    expect(body.replace(/'\\''/g, '').split("'").length).toBe(3)
  })
})

describe('optionsCurl', () => {
  it('asks /runs/options with the same key', () => {
    const text = optionsCurl(ORIGIN)
    expect(text).toContain(`'${ORIGIN}/runs/options'`)
    expect(text).toContain(`Bearer $${KEY_VARIABLE}`)
    expect(text).not.toContain('-X POST')
  })
})

describe('with a key to show', () => {
  const key = 'rdk_abcdef123456_zyxwvu9876543210zyxwvu9876'

  it('writes the key into the header, so a copy runs as it is', () => {
    expect(runCurl(form, ORIGIN, key)).toContain(`-H 'Authorization: Bearer ${key}'`)
    expect(optionsCurl(ORIGIN, key)).toContain(`-H 'Authorization: Bearer ${key}'`)
  })

  it('no longer reads the variable', () => {
    expect(runCurl(form, ORIGIN, key)).not.toContain(`$${KEY_VARIABLE}`)
    expect(optionsCurl(ORIGIN, key)).not.toContain(`$${KEY_VARIABLE}`)
  })

  it('keeps the command the same shape, one header changed', () => {
    const withKey = runCurl(form, ORIGIN, key).split('\n')
    const without = runCurl(form, ORIGIN).split('\n')
    expect(withKey).toHaveLength(without.length)
    expect(withKey.filter((line, n) => line !== without[n])).toHaveLength(1)
  })

  it('quotes the key like any other value', () => {
    expect(runCurl(form, ORIGIN, "a'b")).toContain(`'Authorization: Bearer a'\\''b'`)
  })
})

describe('limitsLine', () => {
  const key = {
    expiresAt: '2026-10-05T12:34:56.789Z',
    limits: { runsPerHour: 10, maxWorkers: 2, refs: ['main'] },
  }

  it('says what the key may do, so it can be checked against what happens', () => {
    expect(limitsLine(key)).toBe(
      'Simulated only · 10 runs an hour · up to 2 workers · main only · expires 2026-10-05 12:34 UTC.',
    )
  })

  it('lists every branch it may use', () => {
    expect(limitsLine({ ...key, limits: { ...key.limits, refs: ['main', 'develop'] } })).toContain(
      'main, develop only',
    )
  })
})

describe('ApiSnippet', () => {
  const html = (role: Role, f = form) =>
    renderToStaticMarkup(createElement(ApiSnippet, { form: f, role, origin: ORIGIN }))

  it('is shut until asked for, under a plain heading', () => {
    const out = html('demo')
    expect(out).toContain('<details')
    expect(out).toContain('Run this from a script')
    expect(out).not.toMatch(/<details[^>]*\sopen/)
  })

  it('offers a demo visitor a key of their own, and says what it is', () => {
    const out = html('demo')
    expect(out).toContain('Get a sandbox key')
    expect(out).toContain('simulated runs only')
    expect(out).not.toContain('rdk_')
  })

  it('does not offer the other roles one: they use a key an admin issued', () => {
    const out = html('qa')
    expect(out).not.toContain('Get a sandbox key')
    expect(out).toContain('Ask an admin')
  })

  /*
   * Only admin can open the panel the note used to send everyone to, and the
   * variable the commands read was never shown being set — so a pasted
   * command sent an empty key. Found by the real-user review.
   */
  it('tells admin where keys are issued, and the others to ask for one', () => {
    expect(html('admin')).toContain('admin panel')
    expect(html('dev')).not.toContain('admin panel')
    expect(html('dev')).toContain('Ask an admin')
  })

  it('shows setting the variable the commands read, for every role that needs one', () => {
    for (const role of ['dev', 'qa', 'admin'] as const) {
      expect(html(role)).toContain('export RUN_KEY=')
    }
  })

  it('shows the request the form would send, and the way to see the options', () => {
    const out = html('qa')
    expect(out).toContain('Start this run')
    expect(out).toContain('See what you can ask for')
    expect(out).toContain('&quot;service&quot;:&quot;items&quot;')
    expect(out).toContain('/runs/options')
  })

  it('follows the selection', () => {
    expect(html('qa', { ...form, service: 'reservations' })).toContain('reservations')
  })

  it('has a copy button for each command', () => {
    expect(html('qa').match(/>Copy</g)).toHaveLength(2)
  })
})

describe('SnippetView once a key has been made', () => {
  const sandbox = {
    key: 'rdk_abcdef123456_zyxwvu9876543210zyxwvu9876',
    expiresAt: '2026-10-05T12:00:00.000Z',
    limits: { runsPerHour: 10, maxWorkers: 2, refs: ['main'], simulated: true as const },
  }
  const html = (over: Partial<Parameters<typeof SnippetView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(SnippetView, {
        form,
        role: 'demo',
        origin: ORIGIN,
        sandbox,
        busy: false,
        error: null,
        onMint: () => undefined,
        ...over,
      }),
    )

  it('gives the key its own field, read only, with a button to copy it', () => {
    const out = html()
    expect(out).toMatch(/<input[^>]*readonly=""[^>]*value="rdk_abcdef123456_/)
    expect(out).toContain('Sandbox key')
    expect(out).toContain('>Copy key<')
  })

  it('writes the key into both commands rather than a line of its own', () => {
    const out = html()
    expect(out).not.toContain('export ')
    expect(out.match(new RegExp(`Bearer ${sandbox.key}`, 'g'))).toHaveLength(2)
  })

  it('says where its runs will show', () => {
    expect(html()).toContain('marked “via key”')
  })

  it('says the key is shown once, and what it may do', () => {
    const out = html()
    expect(out).toContain('It is shown once.')
    expect(out).toContain('Simulated only')
    expect(out).not.toContain('Get a sandbox key')
  })

  it('never shows a key before there is one', () => {
    expect(html({ sandbox: null })).not.toContain('rdk_')
    expect(html({ sandbox: null })).toContain('Get a sandbox key')
  })

  it('says it is working while the key is being made, and disables the button', () => {
    const out = html({ sandbox: null, busy: true })
    expect(out).toContain('Making a key…')
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Making a key/)
  })

  it('says what went wrong, as an alert', () => {
    const out = html({
      sandbox: null,
      error: 'Sandbox keys have been issued as fast as they are allowed',
    })
    expect(out).toContain('role="alert"')
    expect(out).toContain('issued as fast as they are allowed')
  })
})
