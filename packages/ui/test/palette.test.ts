import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The text tones against the backgrounds they sit on, read from index.html.
 *
 * t4 and t5 failed WCAG AA for a long time without anything noticing: t5, on
 * 34 hints and sub-labels, measured 2.7:1 on the light surface. Contrast is
 * invisible to every other test here and easy to lose again by nudging one hex
 * value, so the palette block itself is what gets checked.
 */

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

/** The custom properties declared in the first `{ … }` after `marker`. */
function block(marker: string): Record<string, string> {
  const start = html.indexOf(marker)
  if (start < 0) throw new Error(`no ${marker} in index.html`)
  const open = html.indexOf('{', start + marker.length - 1)
  const body = html.slice(open + 1, html.indexOf('}', open))
  return Object.fromEntries(
    [...body.matchAll(/--c-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1],
      (m[2] ?? '').toLowerCase(),
    ]),
  )
}

const themes = {
  light: block(':root {'),
  'dark (system)': block(":root:not([data-theme='light']) {"),
  'dark (chosen)': block("[data-theme='dark'] {"),
}

/** A token's value, or a failure naming the one that is missing. */
function token(tokens: Record<string, string>, name: string): string {
  const value = tokens[name]
  if (!value) throw new Error(`--c-${name} is not declared in this block`)
  return value
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const TEXT = ['t1', 't2', 't3', 't4', 't5']
const BACKGROUNDS = ['bg', 'card', 'surface', 'hover']

describe('text contrast', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const text of TEXT) {
      it(`${theme}: ${text} clears 4.5:1 on every background`, () => {
        for (const bg of BACKGROUNDS) {
          const [fg, back] = [token(tokens, text), token(tokens, bg)]
          expect(contrast(fg, back), `${text} ${fg} on ${bg} ${back}`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it('keeps the tones in order, each lighter than the last on the light theme', () => {
    const l = TEXT.map((t) => luminance(token(themes.light, t)))
    expect(l).toEqual([...l].sort((a, b) => a - b))
  })

  /*
   * The dark theme is written twice — once for a dark OS, once for an explicit
   * choice — and nothing but this keeps the copies the same.
   */
  it('declares the dark theme identically in both of its blocks', () => {
    for (const t of [...TEXT, ...BACKGROUNDS]) {
      expect(token(themes['dark (chosen)'], t), t).toBe(token(themes['dark (system)'], t))
    }
  })
})
