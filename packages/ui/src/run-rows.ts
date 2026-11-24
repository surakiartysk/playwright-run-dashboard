import type { Run } from './api'

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

/**
 * What to say about a run link whose run is not among the rows shown.
 *
 * It said nothing: the row did not open, the page did not move, and a link
 * that named the twenty-sixth run, or one the reader's role may not see,
 * looked the same as a link that worked and a page that did not. The run is
 * looked up on its own (`GET /runs/:id`, scoped by role like the list), and
 * the answer decides the sentence.
 *
 * @param found - the run, if the lookup returned it; null if it did not
 * @param filtered - whether any history filter is narrowing the list
 */
export function linkNotice(
  found: { service: string; ref: string } | null,
  filtered: boolean,
): string {
  if (!found) return 'That run link names a run this role cannot see, or one that no longer exists.'
  const which = `The linked run (${found.service} on ${found.ref})`
  return filtered
    ? `${which} is not in the list: the filters hide it.`
    : `${which} is further down the list than has been loaded.`
}

/**
 * Where a run's numbers came from, as the chip on its row.
 *
 * Both kinds sit in one list (decision 52), and the real ones are the point of
 * the demo: proof the dashboard is wired to suites that run. They used to carry
 * nothing while the simulated ones carried "simulated", so a page of real runs
 * looked exactly like a page of invented ones. Every row now says which it is.
 *
 * `ci` is a suite's own scheduled run reporting in. Any other real run is from
 * before the dashboard stopped dispatching, when a person started it here.
 */
export interface Origin {
  label: string
  title: string
  real: boolean
}

export function runOrigin(run: Pick<Run, 'simulated' | 'triggeredBy'>): Origin {
  if (run.simulated) {
    return {
      label: 'simulated',
      title:
        'No workflow ran: these numbers come from the simulator, and Report opens a shared sample.',
      real: false,
    }
  }
  if (run.triggeredBy === 'ci') {
    return {
      label: 'real · CI',
      title:
        "The suite's own daily CI ran this on GitHub Actions and reported it here. Every visitor sees it; nobody can change it.",
      real: true,
    }
  }
  return {
    label: 'real',
    title:
      'A real workflow on GitHub Actions, started here back when the dashboard still dispatched runs.',
    real: true,
  }
}
