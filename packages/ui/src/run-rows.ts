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

/**
 * A link to one run: `#run=<id>`.
 *
 * In the fragment, not a path or a query: the dashboard is a single page behind
 * a Worker whose routes are set in the Cloudflare dashboard, so a path would be
 * answered by the SPA only until someone forgot a route, and a fragment never
 * reaches the server at all.
 */
export const runHash = (id: string): string => `#run=${encodeURIComponent(id)}`

/** The run a fragment names, or null for anything that is not a run link. */
export function runFromHash(hash: string): string | null {
  const match = /^#run=(.+)$/.exec(hash)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    // A malformed escape is not a run link, and is not worth an error.
    return null
  }
}

/** The list as it should open: on the run the address names, if it names one. */
export const initialRows = (hash: string): RowState => ({
  open: runFromHash(hash),
  confirmingDelete: null,
})
