import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * What a touch screen gets that a mouse does not.
 *
 * iOS Safari zooms the page in when a field under 16px is focused, and leaves
 * it zoomed. Login sized its fields for that and nothing else did: on a phone,
 * seven fields — the run form's, the filters', the gate's and the key form's —
 * were 13–14px. Measured at 375px wide with touch: seven before, none after.
 */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

describe('fields on a touch screen', () => {
  it('are at least 16px, whatever size the component gives them', () => {
    const rule =
      /@media \(pointer: coarse\) \{\s*input,\s*select,\s*textarea \{\s*font-size: (\d+)px !important;/.exec(
        html,
      )

    expect(rule, 'no coarse-pointer rule for input, select and textarea').not.toBeNull()
    expect(Number(rule![1])).toBeGreaterThanOrEqual(16)
  })
})

describe('controls on a touch screen', () => {
  /*
   * Measured at 375px wide with touch: 43 of 47 controls took taps on less
   * than 44px. The area is invisible, so nothing is drawn bigger.
   */
  it('answer a tap at least 44px square, centred on what is drawn', () => {
    const block = /@media \(pointer: coarse\) \{([\s\S]*?)\n {6}\}/.exec(html)?.[1] ?? ''

    expect(block).toMatch(
      /button::before,\s*summary::before \{[^}]*width: max\(100%, 44px\);[^}]*height: max\(100%, 44px\);/,
    )
    expect(block).toMatch(/button,\s*summary \{\s*position: relative;/)
  })
})
