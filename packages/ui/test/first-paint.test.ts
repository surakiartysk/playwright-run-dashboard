import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCENT, accentTokens } from '../src/tokens'
import { App } from '../src/App'

/**
 * What shows before the app has said anything: the tab's icon, and the wait
 * while the session is checked. Both found by the design review.
 */
describe('the tab icon', () => {
  /*
   * It was #4f6bed, which is none of the four accents — a blue left from before
   * the palette was generated (decision 29).
   */
  it('is drawn in the default accent', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const fill = /rel="icon"[\s\S]*?<rect[^>]*fill='%23([0-9a-f]{6})'/.exec(html)?.[1]

    expect(`#${fill}`).toBe(accentTokens(DEFAULT_ACCENT, 'light').primary)
  })
})

describe('the first render, while the session is checked', () => {
  it('says what it is waiting for, as a status', () => {
    const html = renderToStaticMarkup(createElement(App))

    expect(html).toContain('role="status"')
    expect(html).toContain('Checking whether you are signed in')
  })
})
