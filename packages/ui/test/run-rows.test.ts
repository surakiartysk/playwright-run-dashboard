import { describe, expect, it } from 'vitest'
import {
  CLOSED,
  askDelete,
  cancelDelete,
  cancelsDelete,
  initialRows,
  runFromHash,
  runHash,
  toggleRow,
} from '../src/run-rows'

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

describe('run links', () => {
  it('names a run in the fragment, so it never reaches the server', () => {
    expect(runHash('20261004-1139-items-g31dv3')).toBe('#run=20261004-1139-items-g31dv3')
  })

  it('escapes what would break a fragment', () => {
    expect(runHash('a b')).toBe('#run=a%20b')
    expect(runHash('x#y')).toBe('#run=x%23y')
  })

  it('reads back what it wrote, including an id that needs escaping', () => {
    for (const id of ['20261004-1139-items-g31dv3', 'a b/c', 'x#y']) {
      expect(runFromHash(runHash(id))).toBe(id)
    }
  })

  it.each(['', '#', '#run=', '#other=abc', 'run=abc', '#run=%E0%A4%A'])(
    'does not read %j as a run link',
    (hash) => {
      expect(runFromHash(hash)).toBeNull()
    },
  )

  it('opens the list on the run the address names, with nothing being asked about', () => {
    expect(initialRows('#run=abc')).toEqual({ open: 'abc', confirmingDelete: null })
  })

  it('opens the list shut when the address names none', () => {
    expect(initialRows('')).toEqual(CLOSED)
    expect(initialRows('#something-else')).toEqual(CLOSED)
  })
})
