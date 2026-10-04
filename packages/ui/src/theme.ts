import type { CSSProperties } from 'react'
import { ACCENT_IDS, DEFAULT_ACCENT, type Accent } from './tokens'

/**
 * Design tokens, as references to the CSS variables in index.html.
 *
 * Nothing here holds a literal colour, which is the point: light and dark are
 * two definitions of the same variable names, so a component that writes
 * `c.card` is correct in both without knowing which is active. The theme
 * toggle changes one attribute on `<html>` and the whole page follows.
 *
 * The accent is a choice (src/tokens.ts) and the default is graphite, for one
 * reason: on a dashboard whose whole job is showing pass and fail, a red
 * accent would compete with the failure state. A neutral accent leaves red
 * meaning exactly one thing; blue, teal and indigo are offered because that
 * rules out red, green and amber, not every colour.
 */

export const c = {
  bg: 'var(--c-bg)',
  card: 'var(--c-card)',
  surface: 'var(--c-surface)',
  input: 'var(--c-input)',
  hover: 'var(--c-hover)',
  border: 'var(--c-border)',
  divider: 'var(--c-divider)',

  /** Text, darkest to lightest. */
  t1: 'var(--c-t1)',
  t2: 'var(--c-t2)',
  t3: 'var(--c-t3)',
  t4: 'var(--c-t4)',
  t5: 'var(--c-t5)',
  t6: 'var(--c-t6)',

  primary: 'var(--c-primary)',
  primaryDark: 'var(--c-primary-dark)',
  primaryLight: 'var(--c-primary-light)',
  primaryBorder: 'var(--c-primary-border)',

  /** Text and icons sitting on a `primary` fill. */
  onPrimary: 'var(--c-on-primary)',

  /**
   * Error messages and a field in error. Themed, unlike `status` below: that
   * red marks a run and is read before the text, while this one *is* text and
   * has to be legible on both backgrounds.
   */
  danger: 'var(--c-danger)',
  dangerBg: 'var(--c-danger-bg)',
  dangerBorder: 'var(--c-danger-border)',
  /** Amber as text, which the `pending` status colour is too light to be on white. */
  warn: 'var(--c-warn)',
} as const

/**
 * Status colours are literals rather than variables.
 *
 * Green-is-pass and red-is-fail should not shift between themes: someone
 * scanning a list of runs is reading colour before text, and a palette that
 * moves underneath them costs more than the consistency gains.
 */
export const status = {
  pass: '#22c55e',
  passBg: 'rgba(34,197,94,0.12)',
  fail: '#ef4444',
  failBg: 'rgba(239,68,68,0.12)',
  pending: '#f59e0b',
  pendingBg: 'rgba(245,158,11,0.12)',
  neutral: '#94a3b8',
} as const

/**
 * The typographic rule, as a value components can apply.
 *
 * Anything the machine produced wears it — run ids, counts, durations, refs,
 * versions. Anything a person wrote stays in the UI face. The split is
 * information design rather than decoration: a reader separates generated data
 * from prose before reading either, and columns of figures line up because
 * `tabular-nums` comes with it.
 */
export const mono: CSSProperties = {
  // The face lives in one place (--font-mono, from src/tokens.ts).
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
}

export const THEME_KEY = 'rd_theme'
export const ACCENT_KEY = 'rd_accent'

// Re-exported so a component asks theme.ts for the accents and not tokens.ts.
export { ACCENT_IDS, DEFAULT_ACCENT }
export type { Accent }

/**
 * What the viewer is actually looking at.
 *
 * Three states, not two: an explicit choice stamps the root element, and the
 * default — no stamp — follows the operating system. Reading only the stamp
 * reported 'light' to someone sitting in front of a dark page, which put the
 * wrong icon on the old toggle and offered to switch them to the theme they
 * were already in. The Appearance control still needs it, to draw the accent
 * swatches in the colours of the mode on screen.
 */
export function currentTheme(): 'light' | 'dark' {
  const stamped = document.documentElement.getAttribute('data-theme')
  if (stamped === 'dark' || stamped === 'light') return stamped
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * What the viewer asked for, which is not always what they are looking at.
 *
 * `system` is a choice, not an absence: it is the setting that follows the
 * device. `currentTheme()` answers a different question — which of the two is
 * on screen — and the Appearance control needs both.
 */
export type ThemeMode = 'light' | 'dark' | 'system'

export function currentMode(): ThemeMode {
  const stamped = document.documentElement.getAttribute('data-theme')
  return stamped === 'dark' || stamped === 'light' ? stamped : 'system'
}

/**
 * `system` is the only way back to following the device: it removes the stamp
 * and the stored choice, where `light` and `dark` stamp and store.
 */
export function setMode(mode: ThemeMode): void {
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem(THEME_KEY)
    return
  }
  document.documentElement.setAttribute('data-theme', mode)
  localStorage.setItem(THEME_KEY, mode)
}

/** Unknown or missing names are the default, matching what the stylesheet does with them. */
export function currentAccent(): Accent {
  const stamped = document.documentElement.getAttribute('data-accent')
  return ACCENT_IDS.find((id) => id === stamped) ?? DEFAULT_ACCENT
}

export function setAccent(accent: Accent): void {
  document.documentElement.setAttribute('data-accent', accent)
  localStorage.setItem(ACCENT_KEY, accent)
}
