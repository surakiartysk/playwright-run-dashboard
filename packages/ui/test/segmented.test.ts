import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GateControl } from '../src/components/GateControl'
import { RoleSwitcher } from '../src/components/RoleSwitcher'
import { RunFilters } from '../src/components/RunFilters'
import { Segmented, nextChoice } from '../src/components/Segmented'
import { run } from './fixtures'
import type { RolePolicy } from '../src/api'

/**
 * One way to choose one of a few things (Segmented.tsx says what the six were).
 */
const draw = (over: Partial<Parameters<typeof Segmented<string>>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Segmented<string>, {
      label: 'Fruit',
      options: [
        { value: 'apple', label: 'Apple' },
        { value: 'pear', label: 'Pear', disabled: true },
        { value: 'plum', label: 'Plum' },
      ],
      value: 'apple',
      onChange: () => undefined,
      ...over,
    }),
  )

describe('a choice of one', () => {
  it('is a radio group that says which is chosen', () => {
    const html = draw()
    expect(html).toMatch(/^<div role="radiogroup" aria-label="Fruit"/)
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*>Apple</)
    expect(html).toMatch(/role="radio" aria-checked="false" tabindex="-1"[^>]*>Plum</)
  })

  it('is one Tab stop: only the chosen option can be tabbed to', () => {
    expect(draw().match(/tabindex="0"/g)).toHaveLength(1)
    expect(draw({ value: 'plum' })).toMatch(/tabindex="0"[^>]*>Plum</)
  })

  it('is tabs, saying what each one shows, where choosing changes what is below', () => {
    const html = draw({ kind: 'tab', panelId: (v) => `panel-${v}` })
    expect(html).toMatch(/^<div role="tablist" aria-label="Fruit"/)
    expect(html).toMatch(/role="tab" aria-selected="true" aria-controls="panel-apple"[^>]*>Apple</)
    expect(html).not.toContain('aria-checked')
  })

  it('disables every option while disabled, and while busy says so without moving the focus', () => {
    expect(draw({ disabled: true }).match(/disabled=""/g)).toHaveLength(3)
    const busy = draw({ busy: true })
    expect(busy).toContain('aria-busy="true"')
    // Not disabled while busy, so the focused option keeps the focus; said instead.
    expect(busy.match(/ disabled=""/g)).toHaveLength(1)
    expect(busy.match(/aria-disabled="true"/g)).toHaveLength(2)
    expect(draw()).not.toContain('aria-busy')
  })
})

describe('how a choice that cannot be made looks', () => {
  it('is faint for an option with nothing behind it, and legible in a group that is only read-only', () => {
    const faint = /color:var\(--c-t6\)/
    expect(draw()).toMatch(new RegExp(`${faint.source}[^>]*>Pear<`))
    const readOnly = draw({ disabled: true })
    expect(readOnly).not.toMatch(new RegExp(`${faint.source}[^>]*>Plum<`))
  })
})

describe('the arrow keys', () => {
  const enabled = ['apple', 'plum', 'fig']

  it('move to the next and the previous, round from the end, and Home and End go to the ends', () => {
    expect(nextChoice(enabled, 'apple', 'ArrowRight')).toBe('plum')
    expect(nextChoice(enabled, 'apple', 'ArrowDown')).toBe('plum')
    expect(nextChoice(enabled, 'fig', 'ArrowRight')).toBe('apple')
    expect(nextChoice(enabled, 'apple', 'ArrowLeft')).toBe('fig')
    expect(nextChoice(enabled, 'plum', 'Home')).toBe('apple')
    expect(nextChoice(enabled, 'plum', 'End')).toBe('fig')
  })

  it('leave every other key, and a move that lands where it is, alone', () => {
    expect(nextChoice(enabled, 'apple', 'Enter')).toBeNull()
    expect(nextChoice(enabled, 'apple', 'Tab')).toBeNull()
    expect(nextChoice(enabled, 'apple', 'Home')).toBeNull()
    expect(nextChoice([], 'apple', 'ArrowRight')).toBeNull()
  })

  it('step over what cannot be chosen, starting from the first that can when the chosen one cannot', () => {
    // 'pear' is disabled, so it is not among the enabled.
    expect(nextChoice(['apple', 'plum'], 'apple', 'ArrowRight')).toBe('plum')
    expect(nextChoice(['apple', 'plum'], 'pear', 'ArrowRight')).toBe('plum')
    // Only the moving keys move it, even from a chosen option that cannot be chosen now.
    expect(nextChoice(['apple', 'plum'], 'pear', 'Enter')).toBeNull()
  })
})

describe('where the page chooses one of a few things', () => {
  const policies: RolePolicy[] = (['demo', 'dev', 'qa', 'admin'] as const).map((role) => ({
    role,
    allowedRefs: ['main'],
    maxWorkers: 2,
    canDelete: role === 'admin',
    sees: 'every run',
  }))

  it('the role preview says which role is being viewed', () => {
    const html = renderToStaticMarkup(
      createElement(RoleSwitcher, {
        role: 'qa',
        realRole: 'demo',
        policies,
        onSwitched: () => undefined,
      }),
    )
    expect(html).toMatch(/role="radiogroup" aria-label="Viewing as"/)
    expect(html).toMatch(/aria-checked="true"[^>]*>qa</)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })

  it('the status filter is a radio group, with nothing to choose disabled', () => {
    const html = renderToStaticMarkup(
      createElement(RunFilters, {
        runs: [run({ status: 'passed' })],
        value: 'all',
        onChange: () => undefined,
      }),
    )
    expect(html).toMatch(/role="radiogroup" aria-label="Filter runs by status"/)
    expect(html).toMatch(
      /role="radio" aria-checked="false" tabindex="-1" disabled=""[^>]*>.*?Running/,
    )
    expect(html).not.toContain('aria-pressed')
  })

  it('the gate’s mode is a radio group, every option disabled in a preview', () => {
    const html = renderToStaticMarkup(createElement(GateControl, { readOnly: true }))
    expect(html).toMatch(/role="radiogroup" aria-label="Run gate"/)
    expect(html.match(/role="radio"[^>]*disabled=""/g)).toHaveLength(3)
    expect(html).not.toContain('aria-pressed')
  })

  it('the admin panel’s tabs and the appearance’s rows are drawn by it too', () => {
    const src = (f: string) =>
      readFileSync(new URL(`../src/components/${f}`, import.meta.url), 'utf8')
    expect(src('AdminPanel.tsx')).toMatch(/<Segmented\s+kind="tab"[\s\S]*?panelId=/)
    expect(src('AdminPanel.tsx')).toMatch(/role="tabpanel"\s+id=\{`admin-panel-\$\{tab\}`\}/)
    expect(src('Appearance.tsx').match(/<Segmented/g)).toHaveLength(2)
    for (const f of [
      'Appearance.tsx',
      'AdminPanel.tsx',
      'GateControl.tsx',
      'RoleSwitcher.tsx',
      'RunFilters.tsx',
      'RunTrigger.tsx',
    ]) {
      expect(src(f), f).not.toMatch(/aria-pressed|role="radio"|role="tab"|onKeyDown=\{onKeyDown\}/)
    }
  })
})
