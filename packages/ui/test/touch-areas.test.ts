import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type * as Compact from '../src/use-compact'
import { SnippetView } from '../src/components/ApiSnippet'
import { GateWindow } from '../src/components/GateControl'
import { RunFilters } from '../src/components/RunFilters'
import { initialForm } from '../src/run-form'
import { run, runOptions } from './fixtures'

/**
 * Three things a touch screen and a screen reader met that the rest of the page did not.
 *
 * Measured in Chrome with touch at 375 and 320px, by asking what a tap 2px inside each
 * edge of a button's 44px area hits: the Copy buttons of "Run this from a script" lost the
 * top of theirs to the command box's `overflow: hidden`; "All" lost the bottom of its own
 * to "Running", whose area covered it when the tabs wrapped (and which, disabled at 0, did
 * nothing). And axe found the scheduled gate's two time fields unnamed, at every width.
 */
const media = vi.hoisted(() => ({ coarse: false }))
vi.mock('../src/use-compact', async (original) => ({
  ...(await original<typeof Compact>()),
  useMedia: (query: string) => (query === '(pointer: coarse)' ? media.coarse : false),
}))

describe('the Copy buttons of a command', () => {
  it('sit in a box that does not clip what reaches past it', () => {
    const html = renderToStaticMarkup(
      createElement(SnippetView, {
        form: initialForm(runOptions()),
        role: 'demo',
        origin: 'https://runs.example',
        sandbox: {
          key: 'rdk_abcdef123456_zyxwvu9876543210zyxwvu9876',
          expiresAt: '2026-10-05T12:00:00.000Z',
          limits: { runsPerHour: 10, maxWorkers: 2, refs: ['main'], simulated: true },
        },
        busy: false,
        error: null,
        onMint: () => undefined,
      }),
    )
    const boxes = [
      ...html.matchAll(/<div style="([^"]*)"><div style="[^"]*"><span[^>]*>[^<]*<\/span><button/g),
    ]
    expect(boxes.length).toBeGreaterThanOrEqual(2)
    for (const [, style] of boxes) {
      expect(style).not.toContain('overflow:hidden')
      // What let the box shrink below its longest line, and now does without clipping.
      expect(style).toContain('min-width:0')
    }
  })
})

describe('the status tabs', () => {
  const render = (coarse: boolean) => {
    media.coarse = coarse
    return renderToStaticMarkup(
      createElement(RunFilters, { runs: [run()], value: 'all', onChange: () => undefined }),
    )
  }
  const group = (html: string) =>
    /<div role="radiogroup" aria-label="Filter runs by status" style="([^"]*)">/.exec(html)?.[1] ??
    'not drawn'

  it('leave 16px between wrapped rows on a touch screen, so one tab’s 44px does not cover another’s', () => {
    expect(group(render(true))).toContain('row-gap:16px')
  })

  it('stay close together for a mouse', () => {
    const style = group(render(false))
    expect(style).toContain('gap:3px')
    expect(style).not.toContain('row-gap')
  })
})

describe('the times of a scheduled gate', () => {
  it('are each named by their label', () => {
    const html = renderToStaticMarkup(
      createElement(GateWindow, {
        opensAt: '2026-10-11T10:00',
        closesAt: '2026-10-11T12:00',
        onOpens: () => undefined,
        onCloses: () => undefined,
        readOnly: false,
      }),
    )
    expect(html).toMatch(/<label for="gate-opens"[^>]*>Opens<\/label><input id="gate-opens"/)
    expect(html).toMatch(/<label for="gate-closes"[^>]*>Closes<\/label><input id="gate-closes"/)
  })
})
