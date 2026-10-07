import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { RunActions } from '../src/components/RunActions'
import { run } from './fixtures'

/**
 * What the detail row offers, and when Delete asks first.
 *
 * Rendered to a string rather than into a DOM: the question is which controls
 * exist in which state, and that is all the markup says.
 */

const noop = () => undefined
const render = (props: { canDelete: boolean; confirming: boolean; reportUrl?: string | null }) =>
  renderToStaticMarkup(
    createElement(RunActions, {
      run: run({
        reportUrl: props.reportUrl === undefined ? 'https://r.example/1' : props.reportUrl,
      }),
      canDelete: props.canDelete,
      confirming: props.confirming,
      onAskDelete: noop,
      onCancel: noop,
      onConfirm: noop,
    }),
  )

describe('RunActions', () => {
  it('offers Delete, and no question yet, to a role that may delete', () => {
    const html = render({ canDelete: true, confirming: false })
    expect(html).toContain('>Delete</button>')
    expect(html).not.toContain('cannot be undone')
    expect(html).not.toContain('Delete run')
  })

  it('replaces the button with the question, a way out and the destructive choice', () => {
    const html = render({ canDelete: true, confirming: true })
    expect(html).toContain('Delete this run and its report? This cannot be undone.')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('>Delete run</button>')
    expect(html).not.toContain('>Delete</button>')
  })

  it('puts Cancel before the destructive button, so it is where focus lands and tabs first', () => {
    const html = render({ canDelete: true, confirming: true })
    expect(html.indexOf('>Cancel<')).toBeLessThan(html.indexOf('>Delete run<'))
  })

  it('shows nothing destructive to a role that may not delete', () => {
    for (const confirming of [false, true]) {
      const html = render({ canDelete: false, confirming })
      expect(html).not.toContain('Delete')
      expect(html).not.toContain('Cancel')
    }
  })

  it('keeps the report link while the question is open', () => {
    expect(render({ canDelete: true, confirming: true })).toContain('Report ↗')
  })

  it('says "Sample report" for a simulated run, and shows no link without a report', () => {
    const sim = renderToStaticMarkup(
      createElement(RunActions, {
        run: run({ simulated: true, reportUrl: 'https://r.example/sample' }),
        canDelete: false,
        confirming: false,
        onAskDelete: noop,
        onCancel: noop,
        onConfirm: noop,
      }),
    )
    expect(sim).toContain('Sample report ↗')
    expect(render({ canDelete: false, confirming: false, reportUrl: null })).not.toContain('<a ')
  })

  /**
   * An old report is removed to keep storage bounded; the run stays. The detail
   * row says so where the link was, rather than showing nothing, which reads as
   * a run whose upload failed.
   */
  describe('a report that was removed', () => {
    const renderRemoved = (props: { reportUrl: string | null; reportRemovedAt: string | null }) =>
      renderToStaticMarkup(
        createElement(RunActions, {
          run: run(props),
          canDelete: false,
          confirming: false,
          onAskDelete: noop,
          onCancel: noop,
          onConfirm: noop,
        }),
      )

    it('says it was removed, and when, in place of the link', () => {
      const html = renderRemoved({ reportUrl: null, reportRemovedAt: '2027-04-09T03:00:00.000Z' })
      expect(html).toContain('Report removed 2027-04-09')
      expect(html).not.toContain('<a ')
    })

    it('says nothing while the report is stored', () => {
      const html = renderRemoved({ reportUrl: 'https://r.example/1', reportRemovedAt: null })
      expect(html).toContain('Report ↗')
      expect(html).not.toContain('removed')
    })

    it('shows the link, not the note, if a row were ever to carry both', () => {
      const html = renderRemoved({
        reportUrl: 'https://r.example/1',
        reportRemovedAt: '2027-04-09T03:00:00.000Z',
      })
      expect(html).toContain('Report ↗')
      expect(html).not.toContain('removed')
    })

    it('says nothing for a run that never had a report', () => {
      expect(renderRemoved({ reportUrl: null, reportRemovedAt: null })).not.toContain('removed')
    })
  })
})
