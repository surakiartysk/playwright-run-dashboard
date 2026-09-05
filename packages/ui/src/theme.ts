import type { CSSProperties } from 'react'

/**
 * Design tokens, as references to the CSS variables in index.html.
 *
 * Nothing here holds a literal colour, which is the point: light and dark are
 * two definitions of the same variable names, so a component that writes
 * `c.card` is correct in both without knowing which is active. The theme
 * toggle changes one attribute on `<html>` and the whole page follows.
 *
 * Layout, depth and spacing carry over from a dashboard I built at work; the
 * palette does not. That one's accent is a company's brand red, and brand
 * colour is identity rather than craft — reproducing it would make a public
 * portfolio recognisably theirs.
 *
 * Indigo replaces it for a reason beyond avoidance: on a dashboard whose whole
 * job is showing pass and fail, a red accent competes with the failure state.
 * A neutral accent leaves red meaning exactly one thing.
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
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: 'tabular-nums',
}

export const THEME_KEY = 'rd_theme'

/**
 * What the viewer is actually looking at.
 *
 * Three states, not two: an explicit choice stamps the root element, and the
 * default — no stamp — follows the operating system. Reading only the stamp
 * reported 'light' to someone sitting in front of a dark page, which put the
 * wrong icon on the toggle and offered to switch them to the theme they were
 * already in.
 */
export function currentTheme(): 'light' | 'dark' {
  const stamped = document.documentElement.getAttribute('data-theme')
  if (stamped === 'dark' || stamped === 'light') return stamped
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Always stamps, in both directions.
 *
 * Removing the attribute would hand the choice back to the operating system,
 * so a viewer on a dark OS who asked for light would get dark again on the
 * next paint — a toggle that appears not to work.
 */
export function toggleTheme(): 'light' | 'dark' {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  localStorage.setItem(THEME_KEY, next)
  return next
}

/**
 * The sign-in panel's backdrop.
 *
 * Four layers rather than a flat fill: faint diagonal stripes, two off-centre
 * spotlights, then the base gradient. Individually invisible; together they
 * give the panel depth, which is most of why a flat rectangle reads as
 * unfinished.
 */
export const brandPanelBackground = `
  repeating-linear-gradient(135deg, transparent 0px, transparent 80px, rgba(255,255,255,0.02) 80px, rgba(255,255,255,0.02) 81px),
  radial-gradient(circle at 25% 20%, var(--c-brand-glow) 0%, transparent 55%),
  radial-gradient(circle at 80% 85%, var(--c-brand-glow-faint) 0%, transparent 50%),
  linear-gradient(165deg, var(--c-brand-1) 0%, var(--c-brand-2) 45%, var(--c-brand-3) 100%)
`
