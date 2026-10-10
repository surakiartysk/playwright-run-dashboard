import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunHistory } from '../src/components/RunHistory'
import { RunTrend, changeLabel } from '../src/components/RunTrend'
import { fromSearch } from '../src/run-query'
import { status } from '../src/theme'
import { run } from './fixtures'

/**
 * Green and red are kept for results (decisions 10 and 17). Three places used
 * them for something else — found by the design review:
 * the trend's change, coloured by direction; a failed run's passed count, in
 * bold red; and the gate's "Open", in green text measured at 2.05:1.
 */
const coloured = (html: string, text: RegExp) =>
  new RegExp(`color:(${status.pass}|${status.fail})[^>]*>${text.source}`).test(html)

describe("the trend's change", () => {
  it('says points in the singular and the plural', () => {
    expect(changeLabel(1)).toBe('↑ 1 pt on the oldest run')
    expect(changeLabel(-3)).toBe('↓ 3 pts on the oldest run')
  })

  it('is not coloured by its direction', () => {
    // Newest first, three being the fewest the chart draws: the rate rose from
    // 50% to 100%, so the change is shown.
    const runs = [
      run({ status: 'passed', total: 10, passed: 10 }),
      run({ status: 'passed', total: 10, passed: 10 }),
      run({ status: 'failed', total: 10, passed: 5 }),
    ]
    const html = renderToStaticMarkup(createElement(RunTrend, { runs }))

    expect(html).toMatch(/[↑↓] \d+ pts?/)
    expect(coloured(html, /[↑↓]/)).toBe(false)
  })
})

describe("a failed run's result line", () => {
  const html = renderToStaticMarkup(
    createElement(RunHistory, {
      runs: [run({ status: 'failed', total: 16, passed: 13, failed: 3 })],
      role: 'demo',
      canDelete: false,
      onChanged: () => undefined,
      total: 1,
      hasMore: false,
      loadingMore: false,
      onLoadMore: () => undefined,
      options: null,
      filters: fromSearch(''),
      onFilters: () => undefined,
    }),
  )

  it('does not shout the passed count in red', () => {
    expect(coloured(html, /13</)).toBe(false)
  })

  it('names the failures in the red made for text, not the status red', () => {
    expect(html).toMatch(/color:var\(--c-danger\)[^>]*>· 3 failed/)
  })
})

/*
 * Read from the source, as appearance.test.ts reads it, because the panel only
 * draws its pill after `GET /gate` answers and a static render never gets there.
 */
describe('the run gate panel', () => {
  it('never writes words in the pass green', () => {
    const source = readFileSync(
      new URL('../src/components/GateControl.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(/color:\s*status\.pass\b/)
  })
})
