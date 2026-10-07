import type { Run, RunDetails, RunStatus } from './api'

/**
 * What to say about a run that did not pass — apart from drawing it.
 *
 * Three different things hide behind a red row. A test failed, and the callback
 * says which. The run errored, which means the dashboard could not dispatch it
 * or the workflow died before reporting. Or nothing was reported at all in the
 * time allowed, and the dashboard stopped waiting. They need different words:
 * "failed" for all three sends a reader looking for a failing test where there
 * is none.
 */

/** Only a run that failed can have named tests; the other two have no list to fetch. */
export const hasFailureList = (status: RunStatus): boolean => status === 'failed'

/** Whether the row has anything to explain at all. */
export const needsExplaining = (status: RunStatus): boolean =>
  status === 'failed' || status === 'error' || status === 'timeout'

/**
 * The sentence for a run that has no list of failing tests, or null when the
 * list is the explanation.
 */
export function problemNote(run: Pick<Run, 'status' | 'simulated'>): string | null {
  if (run.status === 'error') {
    return 'No tests ran. The run could not be dispatched, it errored before it reported a result, or its scope and tag matched no tests.'
  }
  if (run.status === 'timeout') {
    return 'No result was reported within thirty minutes, so the dashboard stopped waiting. The workflow may have been cancelled or lost its runner; if it did report, its result replaces this.'
  }
  return null
}

/** The line above the list: how many are shown, and how many are not. */
export function failureSummary(
  details: Pick<RunDetails, 'failures' | 'omitted'>,
  failed: number | null,
): string {
  const shown = details.failures.length
  if (details.omitted > 0) {
    return `${shown} of ${shown + details.omitted} failures shown. The rest are in the report.`
  }
  // The run counts a test per style it ran in, and the list names one entry
  // for each, so the two agree. When they do not — an older workflow, a callback
  // trimmed in transit — say what is on screen rather than a number that conflicts.
  return failed !== null && failed !== shown
    ? `${shown} failure${shown === 1 ? '' : 's'} named. The run reports ${failed}.`
    : `${shown} failure${shown === 1 ? '' : 's'}`
}

/** `items/list.spec.ts:12`, or the file alone when no line was reported. */
export const where = (f: { file: string; line?: number }): string =>
  f.line ? `${f.file}:${f.line}` : f.file
