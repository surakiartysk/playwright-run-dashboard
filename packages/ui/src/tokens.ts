/**
 * The palette, as data — and the one place it is written.
 *
 * `index.html` used to carry it by hand, three times over: light, dark for a
 * dark OS, dark for an explicit choice. A test kept the two dark copies equal,
 * which worked for one accent and would not for four: choosing an accent
 * multiplies every block, and a hand-copied block is where a value drifts
 * without anything noticing. So the CSS is generated from this table at build
 * time (see `tokensPlugin` in vite.config.ts) and the tests read the table.
 *
 * Two independent choices, kept apart on purpose:
 *
 * - **Mode** — light, dark, or follow the device — decides the neutral
 *   surfaces and text.
 * - **Accent** — one colour for buttons, the active item and highlights —
 *   decides only the `--c-primary*` and `--c-brand-*` tokens.
 *
 * The default accent is graphite, a neutral. Decision 10's reason survives the
 * change of colour: on a page whose job is showing pass and fail, the accent
 * must not compete with red and green. Blue, teal and indigo are offered
 * because that reasoning rules out red, green and amber, not every colour.
 *
 * Status colours are not here. They are literals in theme.ts, and stay so:
 * someone scanning a list reads colour before text.
 */

export type Accent = 'graphite' | 'blue' | 'teal' | 'indigo'
export type Mode = 'light' | 'dark'

export const ACCENT_IDS: readonly Accent[] = ['graphite', 'blue', 'teal', 'indigo'] as const
export const DEFAULT_ACCENT: Accent = 'graphite'

export const ACCENT_LABELS: Record<Accent, string> = {
  graphite: 'Graphite',
  blue: 'Blue',
  teal: 'Teal',
  indigo: 'Indigo',
}

/** Typefaces, as variables so changing one is one line and no component edit. */
export const FONTS = {
  ui: "'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const

/** Neutral surfaces and text for one mode. Names are the CSS variables, minus `--c-`. */
export interface Neutrals {
  bg: string
  card: string
  surface: string
  input: string
  hover: string
  border: string
  divider: string
  t1: string
  t2: string
  t3: string
  t4: string
  t5: string
  t6: string
  danger: string
  'danger-bg': string
  'danger-border': string
  warn: string
}

export const NEUTRALS: Record<Mode, Neutrals> = {
  light: {
    bg: '#f5f6f8',
    card: '#ffffff',
    surface: '#e9ebf0',
    input: '#ffffff',
    hover: '#f1f3f7',
    border: '#dfe2e8',
    divider: '#e6e8ec',
    t1: '#0f172a',
    t2: '#334155',
    t3: '#475569',
    t4: '#52607a',
    t5: '#5b667a',
    t6: '#c2cad3',
    // #dc2626 measured 4.45:1 here and 3.9:1 on the dark background, both
    // short of AA for 13px text.
    danger: '#b91c1c',
    'danger-bg': '#fff5f5',
    'danger-border': '#fca5a5',
    warn: '#b45309',
  },
  dark: {
    bg: '#0d1117',
    card: '#151b23',
    surface: '#1e2631',
    input: '#0f141a',
    hover: '#19212b',
    border: '#2f3a4b',
    divider: '#263040',
    t1: '#e6edf3',
    t2: '#c9d2dd',
    t3: '#aab5c3',
    t4: '#97a3b3',
    t5: '#8794a6',
    t6: '#3a424d',
    danger: '#f87171',
    'danger-bg': 'rgba(239, 68, 68, 0.1)',
    'danger-border': 'rgba(248, 113, 113, 0.55)',
    warn: '#f59e0b',
  },
}

/** What an accent decides, in one mode. */
export interface AccentTokens {
  primary: string
  'primary-dark': string
  'primary-light': string
  'primary-border': string
  /** Text and icons on a `primary` fill. Not always white: a light fill needs dark text. */
  'on-primary': string
  'brand-1': string
  'brand-2': string
  'brand-3': string
  'brand-glow': string
  'brand-glow-faint': string
}

interface AccentSpec {
  light: { fill: string; hover: string }
  dark: { fill: string; hover: string; on: string }
  /** The sign-in panel's two ends. Dark in both modes: the panel carries white text. */
  hero: [string, string]
}

const SPECS: Record<Accent, AccentSpec> = {
  graphite: {
    light: { fill: '#1f2937', hover: '#111827' },
    dark: { fill: '#e5e7eb', hover: '#ffffff', on: '#111827' },
    hero: ['#111827', '#374151'],
  },
  blue: {
    light: { fill: '#1d4ed8', hover: '#1e40af' },
    dark: { fill: '#60a5fa', hover: '#93c5fd', on: '#06101f' },
    hero: ['#1e3a8a', '#1d4ed8'],
  },
  teal: {
    light: { fill: '#0f766e', hover: '#115e59' },
    dark: { fill: '#2dd4bf', hover: '#5eead4', on: '#04201d' },
    hero: ['#134e4a', '#0f766e'],
  },
  indigo: {
    light: { fill: '#4338ca', hover: '#3730a3' },
    dark: { fill: '#818cf8', hover: '#a5b4fc', on: '#0b1020' },
    hero: ['#312e81', '#4338ca'],
  },
}

// ── colour arithmetic ────────────────────────────────────────────────────────────────────────

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/** `amount` of `b` mixed into `a`, as a hex colour. */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [channels(a), channels(b)]
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v * (1 - amount) + (y[i] ?? 0) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = channels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function accentTokens(accent: Accent, mode: Mode): AccentTokens {
  const spec = SPECS[accent]
  const [h1, h2] = spec.hero

  if (mode === 'light') {
    const { fill, hover } = spec.light
    return {
      primary: fill,
      'primary-dark': hover,
      'primary-light': mix('#ffffff', fill, 0.1),
      'primary-border': mix('#ffffff', fill, 0.3),
      'on-primary': '#ffffff',
      'brand-1': mix(h1, '#000000', 0.35),
      'brand-2': h1,
      'brand-3': h2,
      'brand-glow': rgba(mix(h2, '#ffffff', 0.5), 0.3),
      'brand-glow-faint': rgba(mix(h2, '#ffffff', 0.5), 0.16),
    }
  }

  const { fill, hover, on } = spec.dark
  return {
    primary: fill,
    'primary-dark': hover,
    'primary-light': rgba(fill, 0.14),
    'primary-border': rgba(fill, 0.34),
    'on-primary': on,
    'brand-1': mix(h1, '#000000', 0.55),
    'brand-2': mix(h1, '#000000', 0.2),
    'brand-3': h2,
    'brand-glow': rgba(mix(h2, '#ffffff', 0.5), 0.22),
    'brand-glow-faint': rgba(mix(h2, '#ffffff', 0.5), 0.12),
  }
}

// ── the stylesheet ───────────────────────────────────────────────────────────────────────────

const indent = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n')

const declarations = (tokens: object, indent = '  '): string =>
  Object.entries(tokens)
    .map(([name, value]) => `${indent}--c-${name}: ${value};`)
    .join('\n')

const block = (selector: string, body: string): string => `${selector} {\n${body}\n}`

/**
 * Every custom property the app reads, as a stylesheet.
 *
 * Three selectors per mode, because a mode can be reached three ways: light is
 * the default; dark arrives from the operating system (only when nothing is
 * stamped) or from an explicit choice. Accents repeat that, and the order below
 * is what makes them win: a later rule of equal specificity beats an earlier
 * one, and the system-dark rule is `:not([data-theme='light'])` so an explicit
 * light choice is never overridden by the media query.
 */
export function tokensCss(): string {
  const parts: string[] = []
  const fonts = `  --font-ui: ${FONTS.ui};\n  --font-mono: ${FONTS.mono};`

  parts.push(
    block(
      ':root',
      [
        declarations(NEUTRALS.light),
        declarations(accentTokens(DEFAULT_ACCENT, 'light')),
        fonts,
      ].join('\n'),
    ),
  )

  const dark = (accent: Accent) =>
    [declarations(NEUTRALS.dark), declarations(accentTokens(accent, 'dark'))].join('\n')

  parts.push(
    `@media (prefers-color-scheme: dark) {\n${block("  :root:not([data-theme='light'])", indent(dark(DEFAULT_ACCENT)))}\n}`,
  )
  parts.push(block("[data-theme='dark']", dark(DEFAULT_ACCENT)))

  for (const accent of ACCENT_IDS) {
    parts.push(block(`:root[data-accent='${accent}']`, declarations(accentTokens(accent, 'light'))))
  }
  for (const accent of ACCENT_IDS) {
    parts.push(
      `@media (prefers-color-scheme: dark) {\n${block(
        `  :root:not([data-theme='light'])[data-accent='${accent}']`,
        indent(declarations(accentTokens(accent, 'dark'))),
      )}\n}`,
    )
  }
  for (const accent of ACCENT_IDS) {
    parts.push(
      block(
        `[data-theme='dark'][data-accent='${accent}']`,
        declarations(accentTokens(accent, 'dark')),
      ),
    )
  }

  return parts.join('\n\n')
}
