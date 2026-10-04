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
    expect(headersFor('/*').get('content-security-policy')).toBe("frame-ancestors 'none'")
  })
})
