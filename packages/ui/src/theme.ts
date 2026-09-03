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

export const THEME_KEY = 'rd_theme'

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function toggleTheme(): 'light' | 'dark' {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
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
  radial-gradient(circle at 25% 20%, rgba(120,145,255,0.28) 0%, transparent 55%),
  radial-gradient(circle at 80% 85%, rgba(120,145,255,0.15) 0%, transparent 50%),
  linear-gradient(165deg, #0a1030 0%, #1a2358 45%, #2b3781 100%)
`
