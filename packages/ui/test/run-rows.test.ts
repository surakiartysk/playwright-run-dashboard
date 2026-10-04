import { describe, expect, it } from 'vitest'
import { CLOSED, askDelete, cancelDelete, cancelsDelete, toggleRow } from '../src/run-rows'

/**
 * The question "delete this run?" belongs to the open row and must not outlive
 * it. These are the transitions that decide that.
 */

describe('toggleRow', () => {
  it('opens a row', () => {
    expect(toggleRow(CLOSED, 'a')).toEqual({ open: 'a', confirmingDelete: null })
  })

  it('closes the row that is open', () => {
    expect(toggleRow({ open: 'a', confirmingDelete: null }, 'a').open).toBeNull()
  })

  it('moves to another row when a different one is pressed', () => {
    expect(toggleRow({ open: 'a', confirmingDelete: null }, 'b').open).toBe('b')
  })

  it('drops a pending question when its row is closed', () => {
    expect(toggleRow({ open: 'a', confirmingDelete: 'a' }, 'a').confirmingDelete).toBeNull()
  })

  it('drops a pending question when another row is opened', () => {
    expect(toggleRow({ open: 'a', confirmingDelete: 'a' }, 'b').confirmingDelete).toBeNull()
  })
})

describe('askDelete', () => {
  it('asks about the open row', () => {
    expect(askDelete({ open: 'a', confirmingDelete: null }, 'a').confirmingDelete).toBe('a')
  })

  it('does not ask about a row that is not open', () => {
    const state = { open: 'a', confirmingDelete: null }
    expect(askDelete(state, 'b')).toEqual(state)
    expect(askDelete(CLOSED, 'a')).toEqual(CLOSED)
  })
})

describe('cancelDelete', () => {
  it('ends the question and leaves the row open', () => {
    expect(cancelDelete({ open: 'a', confirmingDelete: 'a' })).toEqual({
      open: 'a',
      confirmingDelete: null,
    })
  })
})

describe('cancelsDelete', () => {
  it('lets Escape withdraw the question', () => {
    expect(cancelsDelete(true, 'Escape')).toBe(true)
  })

  it('ignores other keys while the question is open', () => {
    for (const key of ['Enter', ' ', 'Tab', 'Esc']) expect(cancelsDelete(true, key)).toBe(false)
  })

  it('leaves Escape alone when there is no question', () => {
    expect(cancelsDelete(false, 'Escape')).toBe(false)
  })
})
