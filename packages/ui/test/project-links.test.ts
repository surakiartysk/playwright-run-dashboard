import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Login } from '../src/components/Login'
import { RoleSwitcher } from '../src/components/RoleSwitcher'
import { DECISIONS_URL, PORTFOLIO_URL, SOURCE_URL } from '../src/components/ProjectLinks'
import type { RolePolicy } from '../src/api'

/**
 * The way from the app to the reasoning behind it.
 *
 * A visitor from the portfolio signs in as demo and, before this, found one
 * link on the page — to a report. The project's argument is in
 * docs/decisions.md, and nothing pointed there.
 */
const policies: RolePolicy[] = (['demo', 'dev', 'qa', 'admin'] as const).map((role) => ({
  role,
  allowedRefs: ['main'],
  maxWorkers: 2,
  canDelete: false,
  sees: 'every run',
}))

const switcher = (realRole: RolePolicy['role']) =>
  renderToStaticMarkup(
    createElement(RoleSwitcher, {
      role: realRole,
      realRole,
      policies,
      onSwitched: () => undefined,
    }),
  )

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

  it("sit beside demo's role panel, with what the panel is for", () => {
    const html = switcher('demo')

    expect(html).toContain('the point of the project')
    expect(html).toContain(`href="${DECISIONS_URL}"`)
  })

  /*
   * Only demo is a visitor. A role with a password of its own is someone using
   * the tool, and a note about the portfolio is noise to them.
   */
  it('are not repeated to a role that signs in with its own password', () => {
    expect(switcher('qa')).not.toContain('the point of the project')
  })
})
