import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KeyAction, lastUsedLabel } from '../src/components/ApiKeys'

/**
 * Revoking a key, which cannot be undone and stops whatever uses it. It took
 * one click; deleting a run, the other irreversible action, already asked.
 * Found by the real-user review.
 */
const render = (over: Partial<Parameters<typeof KeyAction>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(KeyAction, {
      revoked: false,
      confirming: false,
      onAsk: () => undefined,
      onCancel: () => undefined,
      onConfirm: () => undefined,
      ...over,
    }),
  )

describe('revoking a key', () => {
  it('asks first: the first press offers only the question', () => {
    const html = render()
    expect(html).toContain('>Revoke<')
    expect(html).not.toContain('Revoke key')
  })

  it('says what revoking does, beside a way back and the real button', () => {
    const html = render({ confirming: true })
    expect(html).toContain('Anything using this key stops at once')
    expect(html).toContain('>Cancel<')
    expect(html).toContain('>Revoke key<')
  })

  it('offers nothing on a key already revoked', () => {
    expect(render({ revoked: true, confirming: true })).not.toContain('<button')
  })
})

describe('when a key was last used', () => {
  it('names the month, so the date cannot be read two ways', () => {
    const label = lastUsedLabel('2026-10-05T03:00:00Z', 'UTC')
    expect(label).toMatch(/Oct/)
    expect(label).not.toMatch(/\d+\/\d+\/\d+/)
  })

  it('says never for a key that has not been used', () => {
    expect(lastUsedLabel(null)).toBe('never')
  })
})
