import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The headers Pages adds to the UI's pages, read from the file it reads.
 *
 * Pages applies `public/_headers` at the edge, so nothing in this repository
 * runs it and a line deleted from it would fail nowhere. This holds the two
 * lines that matter to what they say. Whether a browser then does what they
 * ask is not something a unit test can show — decision 40 records the
 * Chromium run that checked it.
 */
function headersFor(path: string): Map<string, string> {
  const text = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  const headers = new Map<string, string>()
  let current: string | null = null

  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      current = line.trim()
      continue
    }
    if (current !== path) continue
    const colon = line.indexOf(':')
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return headers
}

describe('every page of the UI', () => {
  /*
   * A report is served from this origin and a script inside one could open
   * the dashboard in a new window and read it. This is what stops the read —
   * the Worker sets the same on the API's responses.
   */
  it('opens in a browsing-context group of its own', () => {
    expect(headersFor('/*').get('cross-origin-opener-policy')).toBe('same-origin')
  })

  it('may not be framed by any site', () => {
    expect(policy()['frame-ancestors']).toEqual(["'none'"])
  })
})

/** The page's content-security-policy, by directive. */
function policy(): Record<string, string[]> {
  const raw = headersFor('/*').get('content-security-policy') ?? ''
  return Object.fromEntries(
    raw
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name!, values]),
  )
}

/*
 * Decision 48. The page had no script policy because its theme script was inline; the
 * script is a file now, so scripts can be asked to come from this origin and nothing else.
 * This holds what the policy says, and that the page it is for has no inline script left to
 * break it. Whether a browser accepts the page under it is what the Chromium run recorded in
 * that decision showed.
 */
describe('the script policy', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('lets scripts come from this origin only: no inline script, no eval, no other host', () => {
    expect(policy()['script-src']).toEqual(["'self'"])
    expect(policy()['default-src']).toEqual(["'self'"])
  })

  it('names the fonts host it needs and nothing wider', () => {
    expect(policy()['style-src']).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
    ])
    expect(policy()['font-src']).toEqual(['https://fonts.gstatic.com'])
  })

  it('fetches only from this origin, takes images from it and from data, and loads no plugin', () => {
    expect(policy()['connect-src']).toEqual(["'self'"])
    expect(policy()['img-src']).toEqual(["'self'", 'data:'])
    expect(policy()['object-src']).toEqual(["'none'"])
    expect(policy()['base-uri']).toEqual(["'self'"])
    expect(policy()['form-action']).toEqual(["'self'"])
  })

  it('is met by the page: every script has a src, and no element carries an event handler', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
    expect(scripts.length).toBeGreaterThanOrEqual(2)
    for (const tag of scripts) expect(tag, tag).toMatch(/\ssrc="\//)
    expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('runs the theme script before the app, as a plain script in the head', () => {
    const theme = html.indexOf('<script src="/theme-init.js"></script>')
    const app = html.indexOf('<script type="module" src="/src/main.tsx">')
    expect(theme).toBeGreaterThan(-1)
    expect(theme).toBeLessThan(html.indexOf('</head>'))
    expect(theme).toBeLessThan(app)
  })
})

/*
 * What the file the page now loads does, run as a browser would run it: a stored choice is
 * stamped on the document, and nothing else is.
 */
describe('the theme script', () => {
  const source = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8')

  function stamped(stored: Record<string, string>): Record<string, string> {
    const attrs: Record<string, string> = {}
    const context = {
      localStorage: { getItem: (key: string) => stored[key] ?? null },
      document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
    }
    new Function('localStorage', 'document', source)(context.localStorage, context.document)
    return attrs
  }

  it('stamps a stored dark or light, so a stored light beats a dark system', () => {
    expect(stamped({ rd_theme: 'dark' })).toEqual({ 'data-theme': 'dark' })
    expect(stamped({ rd_theme: 'light' })).toEqual({ 'data-theme': 'light' })
  })

  it('stamps a stored accent that is a lower-case word, and nothing that is not', () => {
    expect(stamped({ rd_accent: 'teal' })).toEqual({ 'data-accent': 'teal' })
    expect(stamped({ rd_accent: 'Teal' })).toEqual({})
    expect(stamped({ rd_accent: 'x"><script>' })).toEqual({})
  })

  it('stamps nothing for an unknown theme or an empty store', () => {
    expect(stamped({ rd_theme: 'sepia' })).toEqual({})
    expect(stamped({})).toEqual({})
  })
})
