import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCENT_OPTIONS, MODE_OPTIONS, stepOption, triggerLabel } from '../src/appearance'
import { ACCENT_IDS } from '../src/tokens'

/**
 * The Appearance control's decisions: what it offers, in what order, what a
 * keyboard does and what a screen reader hears. The component only draws them.
 */

const modes = MODE_OPTIONS.map((m) => m.id)

describe('what is offered', () => {
  it('offers light, dark and the device setting, in that order', () => {
    expect(modes).toEqual(['light', 'dark', 'system'])
  })

  it('offers every accent the stylesheet defines, in the same order', () => {
    expect(ACCENT_OPTIONS.map((a) => a.id)).toEqual([...ACCENT_IDS])
  })

  it('describes the device setting as what it does, not as "Auto"', () => {
    expect(MODE_OPTIONS.find((m) => m.id === 'system')?.description).toBe('Follow the device')
  })
})

describe('moving between options with the keyboard', () => {
  it('moves forward and back, and wraps at both ends', () => {
    expect(stepOption(modes, 'light', 'ArrowRight')).toBe('dark')
    expect(stepOption(modes, 'system', 'ArrowRight')).toBe('light')
    expect(stepOption(modes, 'dark', 'ArrowLeft')).toBe('light')
    expect(stepOption(modes, 'light', 'ArrowLeft')).toBe('system')
  })

  it('treats down and up like right and left', () => {
    expect(stepOption(modes, 'light', 'ArrowDown')).toBe('dark')
    expect(stepOption(modes, 'light', 'ArrowUp')).toBe('system')
  })

  it('jumps to the first and last option', () => {
    expect(stepOption(modes, 'dark', 'Home')).toBe('light')
    expect(stepOption(modes, 'dark', 'End')).toBe('system')
  })

  it('leaves the choice alone for any other key, or when the current one is not an option', () => {
    expect(stepOption(modes, 'dark', 'a')).toBe('dark')
    expect(stepOption(modes, 'dark', 'Tab')).toBe('dark')
    expect(stepOption(modes, 'sepia' as never, 'ArrowRight')).toBe('sepia')
    expect(stepOption([], 'x', 'ArrowRight')).toBe('x')
  })
})

describe('what the button says', () => {
  it('names the mode and the accent that are chosen', () => {
    expect(triggerLabel('dark', 'teal')).toBe('Appearance: Dark, Teal')
  })

  it('says "Follow the device" rather than "system"', () => {
    expect(triggerLabel('system', 'graphite')).toBe('Appearance: Follow the device, Graphite')
  })
})

describe('reduced motion', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('stops animation and transitions for anyone who asked for less', () => {
    const at = html.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(-1)
    const rule = html.slice(at, html.indexOf('/*', at))
    expect(rule).toContain('animation-duration: 0.01ms !important')
    expect(rule).toContain('transition-duration: 0.01ms !important')
  })

  it('defines the keyframes the Appearance panel opens with', () => {
    expect(html).toMatch(/@keyframes pop-in\s*\{/)
  })
})

describe('keyboard focus', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('draws a focus ring on every kind of control, in the accent colour', () => {
    expect(html).toMatch(
      /:where\(button, input, select, textarea, a, summary\):focus-visible\s*\{\s*outline: 2px solid var\(--c-primary\)/,
    )
  })

  it('does not switch the outline off in any component', () => {
    for (const file of ['Login', 'ApiKeys', 'RunTrigger', 'GateControl', 'Appearance']) {
      const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/outline:\s*'none'/)
    }
  })
})
