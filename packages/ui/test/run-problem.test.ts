import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  failureSummary,
  hasFailureList,
  needsExplaining,
  problemNote,
  where,
} from '../src/run-problem'
import { FailureList, RunProblem } from '../src/components/RunProblem'
import { RunActions } from '../src/components/RunActions'
import { run } from './fixtures'
import type { RunDetails, RunFailure } from '../src/api'

/**
 * Why a run did not pass. Three different things sit behind a red row — a test
 * failed, the run errored, nothing was reported in time — and they need
 * different words: "failed" for all three sends a reader looking for a failing
 * test where there is none.
 */

const failure = (over: Partial<RunFailure> = {}): RunFailure => ({
  title: 'should list items',
  file: 'items/list.spec.ts',
  line: 12,
  style: 'class-style',
  tags: ['items', 'smoke'],
  message: 'expected 200, got 500',
  ...over,
})

describe('which runs have something to explain', () => {
  it('explains the three that did not pass, and not the others', () => {
    expect(needsExplaining('failed')).toBe(true)
    expect(needsExplaining('error')).toBe(true)
    expect(needsExplaining('timeout')).toBe(true)
    for (const s of ['passed', 'queued', 'running'] as const) expect(needsExplaining(s)).toBe(false)
  })

  it('has a list of failing tests only for a run that failed', () => {
    expect(hasFailureList('failed')).toBe(true)
    for (const s of ['passed', 'error', 'timeout', 'queued', 'running'] as const) {
      expect(hasFailureList(s)).toBe(false)
    }
  })
})

describe('problemNote', () => {
  it('says an errored run ran no tests, and does not call it a failure', () => {
    const note = problemNote({ status: 'error', simulated: false })!
    expect(note).toContain('No tests ran')
    expect(note).not.toContain('failed')
  })

  /**
   * A scope and tag the form offers can match nothing, and that now arrives as an
   * error; the sentence has to cover it, not only a run that died.
   */
  it('says a scope and tag that match nothing can be why no tests ran', () => {
    expect(problemNote({ status: 'error', simulated: false })).toContain('matched no tests')
  })

  it('says a timeout is the dashboard giving up, and that a real result would replace it', () => {
    const note = problemNote({ status: 'timeout', simulated: false })!
    expect(note).toContain('thirty minutes')
    expect(note).toContain('replaces')
  })

  /** The list is the explanation for a failure; a sentence on top would repeat it. */
  it('has no sentence for a run that failed, or one that did not', () => {
    for (const status of ['failed', 'passed', 'queued', 'running'] as const) {
      expect(problemNote({ status, simulated: false }), status).toBeNull()
    }
  })
})

describe('failureSummary', () => {
  const some = (n: number, omitted = 0): RunDetails => ({
    failures: Array.from({ length: n }, () => failure()),
    omitted,
  })

  it('counts what is shown', () => {
    expect(failureSummary(some(1), 1)).toBe('1 failure')
    expect(failureSummary(some(3), 3)).toBe('3 failures')
  })

  it('says how many are not shown, and where they are', () => {
    expect(failureSummary(some(20, 7), 27)).toBe(
      '20 of 27 failures shown. The rest are in the report.',
    )
  })

  /** A count that contradicts the run's own would read as a bug in one of them. */
  it('says so rather than contradicting the run when the two disagree', () => {
    expect(failureSummary(some(2), 5)).toBe('2 failures named. The run reports 5.')
    expect(failureSummary(some(1), 2)).toBe('1 failure named. The run reports 2.')
  })

  it('does not compare with a run that reported no count', () => {
    expect(failureSummary(some(2), null)).toBe('2 failures')
  })
})

describe('where', () => {
  it('gives the file and line', () => {
    expect(where({ file: 'items/list.spec.ts', line: 12 })).toBe('items/list.spec.ts:12')
  })
  it('gives the file alone when there is no line', () => {
    expect(where({ file: 'items/list.spec.ts' })).toBe('items/list.spec.ts')
  })
})

describe('FailureList', () => {
  const failed = run({ status: 'failed', failed: 2, reportUrl: 'https://r.example/1' })
  const html = (loaded: Parameters<typeof FailureList>[0]['loaded'], r = failed) =>
    renderToStaticMarkup(createElement(FailureList, { run: r, loaded }))

  it('names each failing test: what, where, who ran it, its tags, and why', () => {
    const out = html({
      state: 'ready',
      details: { failures: [failure(), failure({ title: 'second', line: undefined })], omitted: 0 },
    })
    expect(out).toContain('should list items')
    expect(out).toContain('items/list.spec.ts:12')
    expect(out).toContain('class-style')
    expect(out).toContain('@items')
    expect(out).toContain('@smoke')
    expect(out).toContain('expected 200, got 500')
    expect(out).toContain('second')
    expect(out).toContain('2 failures')
  })

  /*
   * The heading is text, so it is the themed danger colour and its 4.5:1. It was the status red, a
   * mark's colour; when that red was measured for 3:1 as a mark (decision 46), the heading would have
   * fallen short of 4.5 as text.
   */
  it('writes its heading in the colour meant for text, not the status mark', () => {
    const out = html({ state: 'ready', details: { failures: [failure()], omitted: 0 } })
    expect(out).toMatch(/<h3 style="[^"]*color:var\(--c-danger\)/)
  })

  it('does not draw an empty message or an empty style', () => {
    const out = html({
      state: 'ready',
      details: { failures: [failure({ message: '', style: '', tags: [] })], omitted: 0 },
    })
    expect(out).not.toContain('class-style')
    expect(out).not.toContain('expected 200')
    // No empty box where a message would be, and no empty chip where a style would.
    expect(out).not.toContain('overflow-wrap:anywhere')
    expect(out).not.toContain('border-radius:5px')
  })

  it('says when it has not loaded yet, and when it could not', () => {
    expect(html({ state: 'loading' })).toContain('Loading the failures')
    expect(html({ state: 'failed' })).toContain('Could not load the failures')
  })

  it('says the result did not name them, and points at the report only when there is one', () => {
    const none = html({ state: 'ready', details: null })
    expect(none).toContain('did not say which tests failed')
    expect(none).toContain('The report has them')
    expect(
      html({ state: 'ready', details: null }, run({ status: 'failed', reportUrl: null })),
    ).not.toContain('The report has them')
  })

  it('escapes what a test said, because it is rendered to a reader', () => {
    const out = html({
      state: 'ready',
      details: { failures: [failure({ message: '<img src=x onerror=alert(1)>' })], omitted: 0 },
    })
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })
})

describe('RunProblem', () => {
  const render = (r: ReturnType<typeof run>) =>
    renderToStaticMarkup(createElement(RunProblem, { run: r }))

  it('explains an error and a timeout in words, with nothing to fetch', () => {
    expect(render(run({ status: 'error' }))).toContain('No tests ran')
    expect(render(run({ status: 'timeout' }))).toContain('thirty minutes')
  })

  it('says nothing for a run that passed', () => {
    expect(render(run({ status: 'passed' }))).toBe('')
  })

  it('starts by saying it is loading for a run that failed', () => {
    expect(render(run({ status: 'failed' }))).toContain('Loading the failures')
  })
})

describe('the workflow link', () => {
  const html = (workflowUrl: string | null) =>
    renderToStaticMarkup(
      createElement(RunActions, {
        run: run({ workflowUrl }),
        canDelete: false,
        confirming: false,
        onAskDelete: () => undefined,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    )

  it('is offered when the callback brought one, and not otherwise', () => {
    expect(html('https://github.com/o/r/actions/runs/1')).toContain('Workflow run ↗')
    expect(html('https://github.com/o/r/actions/runs/1')).toContain('actions/runs/1')
    expect(html(null)).not.toContain('Workflow run')
  })
})
