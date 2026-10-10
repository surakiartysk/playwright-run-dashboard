import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { RunTrigger } from '../src/components/RunTrigger'
import type * as Compact from '../src/use-compact'
import { runOptions } from './fixtures'

/**
 * Where the run form's choices go, so that none is cut and Run stays on a
 * phone's first screen.
 *
 * Measured before: the four choices before Workers and Run on the first row
 * were left 65 to 77px of text at every desktop width, so "Maintenance logs"
 * read "Mainten…"; half a 320px row cut "All tests" to "All t…"; and with the
 * role preview above the form, Run sat at 632–676px of a 667px screen.
 */
const media = vi.hoisted(() => ({ compact: false }))
vi.mock('../src/use-compact', async (original) => ({
  ...(await original<typeof Compact>()),
  useCompact: () => media.compact,
}))

const render = (compact: boolean) => {
  media.compact = compact
  return renderToStaticMarkup(
    createElement(RunTrigger, { options: runOptions(), role: 'demo', onStarted: () => undefined }),
  )
}

/** The inline style of the pill that holds the select with this label: the span opened last before it. */
const pill = (html: string, label: string) => {
  const at = html.indexOf(`<select aria-label="${label}`)
  if (at < 0) return ''
  const open = html.lastIndexOf('<span style="', at)
  return html.slice(open + '<span style="'.length, html.indexOf('"', open + '<span style="'.length))
}

describe('the run form, wide', () => {
  const html = render(false)

  it('puts Workers and Run on the second row, after the simulated result', () => {
    const [firstRow] = html.split('aria-label="Simulated result"')
    expect(firstRow).not.toContain('aria-label="Workers')
    expect(firstRow).not.toMatch(/>Run<\/button>/)
    expect(html).toMatch(
      /aria-label="Simulated result".*role="group" aria-label="Workers and run"/s,
    )
  })

  it('never shrinks service or tag below the width of their longest names', () => {
    for (const label of ['Service', 'Tag']) expect(pill(html, label)).toContain('flex:1 0 180px')
  })
})

describe('the run form, on a phone', () => {
  const html = render(true)

  it('gives service, tag and the simulated result a whole row each, the full width of it', () => {
    for (const label of ['Service', 'Tag', 'Simulated result']) {
      expect(pill(html, label)).toContain('flex:1 1 100%;max-width:none')
    }
  })

  it('keeps the branch beside the workers, half a row', () => {
    expect(pill(html, 'Suite branch')).toContain('flex:1 1 calc(50% - 4px)')
  })
})

describe('the role preview on a phone', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

  it('comes after the run form, and before the runs, so it does not push Run down', () => {
    expect(app).toMatch(/const asideContent = \([\s\S]*?\{!compact && roleSwitcher\}/)
    const main = /const mainContent = \(([\s\S]*?)\n {2}\)\n/.exec(app)?.[1] ?? ''
    expect(main.indexOf('<RunTrigger')).toBeGreaterThan(-1)
    expect(main.indexOf('{compact && roleSwitcher}')).toBeGreaterThan(main.indexOf('<RunTrigger'))
    expect(main.indexOf('{compact && roleSwitcher}')).toBeLessThan(main.indexOf('<RunHistory'))
  })
})
