/**
 * Which row of the run list is open, and whether its Delete is being asked about.
 *
 * Together because one depends on the other: the question belongs to the open
 * row, so every change of row — closing it, opening another — ends the
 * question. Leaving it standing would hand the next person to open that row a
 * "Delete this run?" they never asked, one click from a deletion.
 */
export interface RowState {
  open: string | null
  confirmingDelete: string | null
}

export const CLOSED: RowState = { open: null, confirmingDelete: null }

/** Open the row, or close it if it is the one already open. */
export function toggleRow(state: RowState, id: string): RowState {
  return { open: state.open === id ? null : id, confirmingDelete: null }
}

/** Start asking about the open row. A row that is not open cannot be asked about. */
export function askDelete(state: RowState, id: string): RowState {
  return state.open === id ? { ...state, confirmingDelete: id } : state
}

export function cancelDelete(state: RowState): RowState {
  return { ...state, confirmingDelete: null }
}

/**
 * Whether a key press withdraws the question. Escape does, but only while
 * there is a question: otherwise it belongs to whatever the reader is doing.
 */
export const cancelsDelete = (confirming: boolean, key: string) => confirming && key === 'Escape'
