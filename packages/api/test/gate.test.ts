import { describe, expect, it } from 'vitest'
import { gateApplies, resolveGate, type GateRow } from '../src/gate'

/**
 * The gate resolves from a row and a clock, both passed in, so every branch is
 * reachable without waiting for a particular hour.
 */
const row = (overrides: Partial<GateRow> = {}): GateRow => ({
  mode: 'open',
  opens_at: null,
  closes_at: null,
  updated_at: null,
  updated_by: null,
  ...overrides,
})

const at = (iso: string) => new Date(iso)

describe('which roles the gate applies to', () => {
  it('gates dev', () => {
    expect(gateApplies('dev')).toBe(true)
  })

  /**
   * A freeze is exactly when release verification happens, so gating QA would
   * stop the work the gate exists to protect.
   */
  it.each(['qa', 'admin'] as const)('never gates %s', (role) => {
    expect(gateApplies(role)).toBe(false)
  })
})

describe('manual modes', () => {
  it('is open when open', () => {
    expect(resolveGate(row({ mode: 'open' }), at('2026-01-01T12:00:00Z'))).toMatchObject({
      state: 'open',
      reason: 'manual',
    })
  })

  it('is closed when closed', () => {
    expect(resolveGate(row({ mode: 'closed' }), at('2026-01-01T12:00:00Z'))).toMatchObject({
      state: 'closed',
      reason: 'manual',
    })
  })
})

describe('window mode', () => {
  const window = row({
    mode: 'window',
    opens_at: '2026-01-01T09:00:00.000Z',
    closes_at: '2026-01-01T17:00:00.000Z',
  })

  it('is closed before the window, and says when it opens', () => {
    const status = resolveGate(window, at('2026-01-01T08:59:59Z'))

    expect(status).toMatchObject({ state: 'closed', reason: 'window' })
    expect(status.opensAt).toBe('2026-01-01T09:00:00.000Z')
  })

  it('is open on the opening boundary', () => {
    expect(resolveGate(window, at('2026-01-01T09:00:00.000Z')).state).toBe('open')
  })

  it('is open inside the window, and says when it closes', () => {
    const status = resolveGate(window, at('2026-01-01T12:00:00Z'))

    expect(status).toMatchObject({ state: 'open', reason: 'window' })
    expect(status.closesAt).toBe('2026-01-01T17:00:00.000Z')
  })

  /**
   * The closing instant is outside the window. Half-open avoids the ambiguity
   * of a boundary that belongs to both sides.
   */
  it('is closed on the closing boundary', () => {
    expect(resolveGate(window, at('2026-01-01T17:00:00.000Z')).state).toBe('closed')
  })

  /**
   * A window is one-off, not a daily schedule. Reopening the next morning
   * would be a different feature, and one nobody asked for by setting a window.
   */
  it('stays closed the next day rather than reopening', () => {
    expect(resolveGate(window, at('2026-01-02T12:00:00Z')).state).toBe('closed')
  })
})

/**
 * The gate is a coordination tool, not a security boundary. Bad data must not
 * become an outage — every one of these resolves open, which is the opposite of
 * how policy.ts behaves and is the point.
 */
describe('failing open', () => {
  it('is open when no row exists at all', () => {
    expect(resolveGate(null, at('2026-01-01T12:00:00Z'))).toMatchObject({
      state: 'open',
      reason: 'default',
    })
  })

  it.each([
    ['no timestamps', { opens_at: null, closes_at: null }],
    ['only an opening time', { opens_at: '2026-01-01T09:00:00Z', closes_at: null }],
    ['unparseable timestamps', { opens_at: 'tuesday', closes_at: 'later' }],
    [
      'a window that closes before it opens',
      { opens_at: '2026-01-01T17:00:00Z', closes_at: '2026-01-01T09:00:00Z' },
    ],
    [
      'a zero-length window',
      { opens_at: '2026-01-01T09:00:00Z', closes_at: '2026-01-01T09:00:00Z' },
    ],
  ])('is open for a window with %s', (_label, overrides) => {
    const status = resolveGate(row({ mode: 'window', ...overrides }), at('2026-01-01T12:00:00Z'))

    expect(status.state).toBe('open')
  })

  it('is open for a mode the code does not recognise', () => {
    expect(resolveGate(row({ mode: 'paused' as never }), at('2026-01-01T12:00:00Z')).state).toBe(
      'open',
    )
  })
})
