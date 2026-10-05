import type { CSSProperties } from 'react'
import { c } from '../theme'

/**
 * Where the code and the reasoning live.
 *
 * This is a portfolio piece, and its argument is in `docs/decisions.md` rather
 * than on the screen. A visitor arriving from the portfolio had no way from the
 * app to either: the signed-in page held one link, to a report. The repository
 * is public, so these point at it rather than at anything a clone would need to
 * change.
 */
export const SOURCE_URL = 'https://github.com/surakiartysk/playwright-run-dashboard'
export const DECISIONS_URL = `${SOURCE_URL}/blob/main/docs/decisions.md`
/** The portfolio this belongs to, which draws how it fits with both suites. */
export const PORTFOLIO_URL = 'https://testbydesign.dev'

export function ProjectLinks({ style }: { style?: CSSProperties }) {
  return (
    <p style={{ ...s.line, ...style }}>
      <a href={PORTFOLIO_URL} style={s.link} target="_blank" rel="noreferrer">
        testbydesign.dev
      </a>
      <span aria-hidden="true"> · </span>
      <a href={SOURCE_URL} style={s.link} target="_blank" rel="noreferrer">
        Source on GitHub
      </a>
      <span aria-hidden="true"> · </span>
      <a href={DECISIONS_URL} style={s.link} target="_blank" rel="noreferrer">
        Why it is built this way
      </a>
    </p>
  )
}

const s: Record<string, CSSProperties> = {
  line: { margin: 0, fontSize: 13, color: c.t4 },
  link: { color: c.t2, textUnderlineOffset: 3 },
}
