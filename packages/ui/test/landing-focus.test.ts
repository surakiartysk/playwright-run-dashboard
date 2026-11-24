import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Login } from '../src/components/Login'

/**
 * Where the keyboard starts, and where it can go.
 *
 * Found by the UX review of the live site: the sign-in page put the focus in
 * the password field on load (`autoFocus`), on a deployment whose way in for a
 * visitor is the "Look around as demo" button above it — measured as
 * `document.activeElement` = `#password` at 1,280 and 390px. And the signed-in
 * page had no `main` landmark and no way past the header to the runs.
 */
describe('the sign-in page', () => {
  /*
   * There is no field to type into any more (decision 52), so the way in is
   * the first button, and the browser is not asked to move focus anywhere.
   */
  it('does not ask the browser to focus anything on load', () => {
    const html = renderToStaticMarkup(createElement(Login, { onSignedIn: () => undefined }))
    expect(html).not.toContain('autofocus')
    expect(html).not.toContain('type="password"')
  })

  it('leads with the demo button, before the concept sign-in', () => {
    const html = renderToStaticMarkup(createElement(Login, { onSignedIn: () => undefined }))
    expect(html.indexOf('Log in to demo')).toBeGreaterThan(-1)
    expect(html.indexOf('Log in to demo')).toBeLessThan(html.indexOf('Sign in with Google'))
    expect(html).toContain('concept')
  })
})

describe('the signed-in page', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('puts the runs in a main landmark, in both layouts, and the summary beside it rather than in it', () => {
    expect(
      app.match(/<main id="main" style=\{s\.main\}>\s*\{mainContent\}\s*<\/main>/g),
    ).toHaveLength(2)
    expect(app).toMatch(/<\/main>\s*<aside style=\{s\.aside\}>\{asideContent\}<\/aside>/)
  })

  it('has a skip link to it, off the page until a keyboard reaches it', () => {
    expect(app).toMatch(/<a href="#main" className="skip-link">\s*Skip to the runs\s*<\/a>/)
    expect(css).toMatch(/\.skip-link \{[^}]*position: absolute;[^}]*top: -48px;/)
    expect(css).toMatch(/\.skip-link:focus \{\s*top: 12px;/)
  })
})
