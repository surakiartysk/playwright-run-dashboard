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
  linkNotice,
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

/**
 * What a run link says when its run is not among the rows shown. It said
 * nothing: the row did not open and the page did not move.
 */
describe('linkNotice', () => {
  it('says the role cannot see it, or it is gone, when the lookup fails', () => {
    expect(linkNotice(null, false)).toBe(
      'That run link names a run this role cannot see, or one that no longer exists.',
    )
  })

  it('names the run and blames the filters when they are narrowing the list', () => {
    expect(linkNotice({ service: 'items', ref: 'main' }, true)).toBe(
      'The linked run (items on main) is not in the list: the filters hide it.',
    )
  })

  it('names the run and says it is further down when nothing is filtered', () => {
    expect(linkNotice({ service: 'items', ref: 'main' }, false)).toBe(
      'The linked run (items on main) is further down the list than has been loaded.',
    )
  })
})
