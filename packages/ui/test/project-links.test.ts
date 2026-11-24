import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Login } from '../src/components/Login'
import { DECISIONS_URL, PORTFOLIO_URL, SOURCE_URL } from '../src/components/ProjectLinks'

/**
 * The way from the app to the reasoning behind it.
 *
 * A visitor from the portfolio signs in as demo and, before this, found one
 * link on the page — to a report. The project's argument is in
 * docs/decisions.md, and nothing pointed there.
 */
describe('the links to the source and the reasoning', () => {
  it('are on the sign-in page, which every visitor sees first', () => {
    const html = renderToStaticMarkup(createElement(Login, { onSignedIn: () => undefined }))

    expect(html).toContain(`href="${SOURCE_URL}"`)
    expect(html).toContain(`href="${DECISIONS_URL}"`)
  })

  it('lead back to the portfolio a visitor most likely came from', () => {
    const html = renderToStaticMarkup(createElement(Login, { onSignedIn: () => undefined }))

    expect(PORTFOLIO_URL).toBe('https://testbydesign.dev')
    expect(html).toContain(`href="${PORTFOLIO_URL}"`)
  })

  it('point at the decisions document itself', () => {
    expect(DECISIONS_URL).toMatch(/\/docs\/decisions\.md$/)
  })
})
