import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCENT_IDS,
  MOTION,
  DEFAULT_ACCENT,
  FONTS,
  NEUTRALS,
  accentTokens,
  tokensCss,
  type Accent,
  type Mode,
} from '../src/tokens'
import { TOKENS_MARKER, tokensPlugin } from '../vite.config'
import { status } from '../src/theme'

/**
 * The palette, checked as a table.
 *
 * t4 and t5 failed WCAG AA for a long time without anything noticing: t5, on
 * 34 hints and sub-labels, measured 2.7:1 on the light surface. Contrast is
 * invisible to every other test here and easy to lose again by nudging one hex
 * value, so the values themselves are what gets checked.
 *
 * These tests used to read `index.html`, where the palette was written out by
 * hand. It is now generated from `src/tokens.ts`, so they read that, plus the
 * stylesheet it produces for the things only the stylesheet can get wrong: a
 * selector missing, or two copies of one theme drifting apart.
 */

const MODES: Mode[] = ['light', 'dark']

/**
 * How far apart two colours look to someone without one kind of cone: each is passed through
 * Machado, Oliveira and Fernandes (2009) at full severity in linear RGB, and the distance taken in
 * OKLab, ×100. The same method gives 7.4 for the old #22c55e and #ef4444 under deuteranopia, the
 * figure decision 17 recorded.
 */
const DEUTERANOPIA = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
]
const PROTANOPIA = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
]

function separation(a: string, b: string, cones: number[][]): number {
  const linear = (hex: string) =>
    [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
  const seen = (rgb: number[]) =>
    cones.map((row) =>
      Math.min(1, Math.max(0, row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!)),
    )
  const oklab = ([r, g, b]: number[]) => {
    const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!)
    const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!)
    const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
  }
  const [x, y] = [oklab(seen(linear(a))), oklab(seen(linear(b)))]
  return 100 * Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!)
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

/**
 * A fill as it looks on `over`.
 *
 * The dark theme writes its tints as `rgba(…, 0.14)`, which has no contrast of
 * its own: what matters is the colour a reader sees, so it is laid over the
 * surface it sits on first.
 */
function flatten(colour: string, over: string): string {
  if (colour.startsWith('#')) return colour
  const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(colour)
  if (!m) throw new Error(`cannot read ${colour}`)
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const base = [1, 3, 5].map((i) => parseInt(over.slice(i, i + 2), 16))
  const out = [r, g, b].map((v, i) => Math.round(v * a + (base[i] ?? 0) * (1 - a)))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

const TEXT = ['t1', 't2', 't3', 't4', 't5'] as const
const BACKGROUNDS = ['bg', 'card', 'surface', 'hover'] as const

describe('text contrast', () => {
  for (const mode of MODES) {
    for (const text of TEXT) {
      it(`${mode}: ${text} clears 4.5:1 on every background`, () => {
        for (const bg of BACKGROUNDS) {
          const [fg, back] = [NEUTRALS[mode][text], NEUTRALS[mode][bg]]
          expect(contrast(fg, back), `${text} ${fg} on ${bg} ${back}`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it('keeps the tones in order, each lighter than the last on the light theme', () => {
    const l = TEXT.map((t) => luminance(NEUTRALS.light[t]))
    expect(l).toEqual([...l].sort((a, b) => a - b))
  })
})

describe('every accent, in every mode', () => {
  for (const accent of ACCENT_IDS) {
    for (const mode of MODES) {
      const label = `${accent} / ${mode}`

      it(`${label}: text on the primary fill clears 4.5:1, resting and hovered`, () => {
        const t = accentTokens(accent, mode)
        expect(contrast(t['on-primary'], t.primary), 'resting').toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['on-primary'], t['primary-dark']), 'hovered').toBeGreaterThanOrEqual(4.5)
      })

      it(`${label}: the accent as text reads on the card and on its own tint`, () => {
        const t = accentTokens(accent, mode)
        const card = NEUTRALS[mode].card
        expect(contrast(t.primary, card), 'on card').toBeGreaterThanOrEqual(4.5)
        expect(
          contrast(t.primary, flatten(t['primary-light'], card)),
          'on tint',
        ).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

/** The declarations of the block whose selector line is exactly `selector`. */
function declarationsOf(css: string, selector: string): string {
  const open = css.indexOf(`${selector} {`)
  if (open < 0) throw new Error(`no block for ${selector}`)
  const body = css.slice(css.indexOf('{', open) + 1, css.indexOf('}', open))
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .sort()
    .join(';')
}

describe('the generated stylesheet', () => {
  const css = tokensCss()

  it('has a rule for every accent in all three ways a mode is reached', () => {
    for (const accent of ACCENT_IDS) {
      expect(css, `${accent} light`).toContain(`:root[data-accent='${accent}'] {`)
      expect(css, `${accent} system dark`).toContain(
        `:root:not([data-theme='light'])[data-accent='${accent}'] {`,
      )
      expect(css, `${accent} chosen dark`).toContain(
        `[data-theme='dark'][data-accent='${accent}'] {`,
      )
    }
  })

  /*
   * The dark theme is written twice — once for a dark OS, once for an explicit
   * choice. Nothing but this keeps the copies the same.
   */
  it('declares each accent identically for a dark OS and for a chosen dark', () => {
    for (const accent of ACCENT_IDS) {
      expect(
        declarationsOf(css, `:root:not([data-theme='light'])[data-accent='${accent}']`),
        accent,
      ).toBe(declarationsOf(css, `[data-theme='dark'][data-accent='${accent}']`))
    }
    expect(declarationsOf(css, ":root:not([data-theme='light'])")).toBe(
      declarationsOf(css, "[data-theme='dark']"),
    )
  })

  it('orders the rules so an equal-specificity rule for dark follows the one for light', () => {
    const light = css.indexOf(`:root[data-accent='${DEFAULT_ACCENT}'] {`)
    const dark = css.indexOf(`[data-theme='dark'][data-accent='${DEFAULT_ACCENT}'] {`)
    expect(light).toBeGreaterThan(-1)
    expect(dark).toBeGreaterThan(light)
  })

  it('makes the default accent the one with no attribute at all', () => {
    const base = declarationsOf(css, ':root')
    const expected = Object.entries(accentTokens(DEFAULT_ACCENT, 'light')).map(
      ([k, v]) => `--c-${k}: ${v}`,
    )
    for (const line of expected) expect(base).toContain(line)
  })

  /*
   * The page's choice has to reach the browser's own controls: a select's open
   * list is drawn by the browser, in whichever scheme `color-scheme` names.
   */
  it('names the scheme for the browser’s own controls, in every way a mode is reached', () => {
    expect(declarationsOf(css, ':root')).toContain('color-scheme: light')
    expect(declarationsOf(css, "[data-theme='dark']")).toContain('color-scheme: dark')
    expect(declarationsOf(css, ":root:not([data-theme='light'])")).toContain('color-scheme: dark')
  })

  it('never names dark for light, or light for dark', () => {
    expect(declarationsOf(css, ':root')).not.toContain('color-scheme: dark')
    expect(declarationsOf(css, "[data-theme='dark']")).not.toContain('color-scheme: light')
  })

  it('declares the three durations and the one easing curve', () => {
    expect(css).toContain(`--motion-fast: ${MOTION.fast};`)
    expect(css).toContain(`--motion-base: ${MOTION.base};`)
    expect(css).toContain(`--motion-enter: ${MOTION.enter};`)
    expect(css).toContain(`--ease: ${MOTION.ease};`)
  })

  it('declares both typefaces', () => {
    expect(css).toContain(`--font-ui: ${FONTS.ui};`)
    expect(css).toContain(`--font-mono: ${FONTS.mono};`)
  })
})

describe('index.html', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('has the marker the palette is built into, exactly once', () => {
    expect(html.split(TOKENS_MARKER).length - 1).toBe(1)
  })

  it('does not carry a hand-written palette any more', () => {
    expect(html).not.toMatch(/--c-[\w-]+:\s*(#|rgba)/)
  })

  it('refuses to build without the marker rather than shipping a page with no colours', () => {
    const hook = tokensPlugin().transformIndexHtml as (html: string) => string
    expect(() => hook('<style></style>')).toThrow(/palette/)
    expect(hook(`<style>${TOKENS_MARKER}</style>`)).toContain('--c-primary:')
  })

  it('stamps a stored accent before first paint', () => {
    expect(html).toContain("localStorage.getItem('rd_accent')")
  })
})

/*
 * What the Appearance control will call. A minimal document stands in for the
 * browser: the point is the attribute and the storage key, not the DOM.
 */
describe('mode and accent', () => {
  const attrs = new Map<string, string>()
  const store = new Map<string, string>()

  beforeEach(() => {
    attrs.clear()
    store.clear()
    vi.stubGlobal('document', {
      documentElement: {
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
        removeAttribute: (k: string) => void attrs.delete(k),
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads nothing stamped as the system setting, not as light', async () => {
    const { currentMode } = await import('../src/theme')
    expect(currentMode()).toBe('system')
  })

  it('stamps and stores a chosen mode, and system removes both', async () => {
    const { setMode, currentMode } = await import('../src/theme')
    setMode('dark')
    expect([currentMode(), store.get('rd_theme')]).toEqual(['dark', 'dark'])
    setMode('system')
    expect([currentMode(), store.has('rd_theme'), attrs.has('data-theme')]).toEqual([
      'system',
      false,
      false,
    ])
  })

  it('falls back to the default accent for a missing or unknown name', async () => {
    const { currentAccent } = await import('../src/theme')
    expect(currentAccent()).toBe(DEFAULT_ACCENT)
    attrs.set('data-accent', 'magenta')
    expect(currentAccent()).toBe(DEFAULT_ACCENT)
  })

  it('stamps and stores a chosen accent', async () => {
    const { setAccent, currentAccent } = await import('../src/theme')
    for (const accent of ACCENT_IDS satisfies readonly Accent[]) {
      setAccent(accent)
      expect([currentAccent(), store.get('rd_accent')]).toEqual([accent, accent])
    }
  })
})

/**
 * The two results written as text rather than drawn as marks: the trend's
 * newest-run figure was the status green on white, 2.27:1. Both themed colours
 * have to be read on every background the page puts them on.
 */
describe('results as text', () => {
  for (const mode of MODES) {
    for (const text of ['pass', 'danger'] as const) {
      it(`${mode}: ${text} clears 4.5:1 on every background`, () => {
        for (const bg of BACKGROUNDS) {
          const [fg, back] = [NEUTRALS[mode][text], NEUTRALS[mode][bg]]
          expect(contrast(fg, back), `${text} ${fg} on ${bg} ${back}`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }
})

/**
 * The status colours are marks — icons, bars, the trend's columns — and the same in both themes
 * (decision 10). Found by the UX review of the live site: #22c55e on white was 2.27:1, under the 3:1
 * SC 1.4.11 asks of a graphic that carries meaning. And green against red is the pair colour
 * blindness flattens hardest (decision 17), so the replacement is held to both.
 */
describe('the status colours', () => {
  const marks = { pass: status.pass, fail: status.fail }
  for (const mode of MODES) {
    for (const [name, colour] of Object.entries(marks)) {
      it(`${mode}: ${name} clears 3:1 as a mark on every background`, () => {
        for (const bg of BACKGROUNDS) {
          const back = NEUTRALS[mode][bg]
          expect(
            contrast(colour, back),
            `${name} ${colour} on ${bg} ${back}`,
          ).toBeGreaterThanOrEqual(3)
        }
      })
    }
  }

  it('are measured by the method decision 17 used: the old pair comes out at its recorded 7.4', () => {
    expect(separation('#22c55e', '#ef4444', DEUTERANOPIA)).toBeCloseTo(7.4, 1)
  })

  it('stay apart for someone without red or green cones: ΔE over 8 in both simulations', () => {
    expect(separation(status.pass, status.fail, DEUTERANOPIA)).toBeGreaterThan(8)
    expect(separation(status.pass, status.fail, PROTANOPIA)).toBeGreaterThan(8)
  })
})
