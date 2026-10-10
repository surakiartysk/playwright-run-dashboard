import { useEffect, useRef, type CSSProperties } from 'react'
import type { Run } from '../api'
import { cancelsDelete } from '../run-rows'
import { c } from '../theme'

/**
 * What a reader can do with one run, from its detail row.
 *
 * Delete asks first. It removes the run and its stored report for every viewer,
 * and there is no undo, so one stray click on a row that sits right beside the
 * report link is too cheap a way to lose something. The question replaces the
 * button where it was rather than opening a dialog: the thing being deleted
 * stays in view while it is decided.
 *
 * Controlled — the list holds which run is being asked about — so that
 * collapsing a row or opening another one drops the question instead of leaving
 * a "Delete?" waiting in a row nobody is looking at.
 */
export function RunActions({
  run,
  canDelete,
  confirming,
  onAskDelete,
  onCancel,
  onConfirm,
}: {
  run: Run
  canDelete: boolean
  confirming: boolean
  onAskDelete: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  // Focus lands on the safe answer. The button that was pressed has just been
  // replaced, so without this a keyboard user's place is lost, and landing on
  // "Delete" would make Enter-Enter a deletion.
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirming) cancel.current?.focus()
  }, [confirming])

  return (
    <div
      style={s.actions}
      onKeyDown={(e) => {
        if (cancelsDelete(confirming, e.key)) {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      {run.reportUrl && (
        <a
          href={run.reportUrl}
          target="_blank"
          rel="noreferrer"
          style={s.report}
          onClick={(e) => e.stopPropagation()}
        >
          {run.simulated ? 'Sample report ↗' : 'Report ↗'}
        </a>
      )}

      {!run.reportUrl && run.reportRemovedAt && (
        <span
          style={s.removed}
          title="Old reports are removed to keep storage bounded. The result stays."
        >
          {reportRemovedNote(run.reportRemovedAt)}
        </span>
      )}

      {run.workflowUrl && (
        <a
          href={run.workflowUrl}
          target="_blank"
          rel="noreferrer"
          style={s.workflow}
          onClick={(e) => e.stopPropagation()}
        >
          Workflow run ↗
        </a>
      )}

      {canDelete &&
        (confirming ? (
          <>
            <span role="alert" style={s.question}>
              Delete this run and its report? This cannot be undone.
            </span>
            <button
              ref={cancel}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              style={s.cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onConfirm()
              }}
              style={s.confirm}
            >
              Delete run
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAskDelete()
            }}
            style={s.delete}
          >
            Delete
          </button>
        ))}
    </div>
  )
}

/** What stands where the link was, once the report it opened has been removed. */
export const reportRemovedNote = (removedAt: string): string =>
  `Report removed ${removedAt.slice(0, 10)}`

const button: CSSProperties = {
  padding: '5px 11px',
  borderRadius: 7,
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
}

const s: Record<string, CSSProperties> = {
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  report: {
    color: c.primary,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
    padding: '5px 11px',
    background: c.primaryLight,
    border: `1px solid ${c.primaryBorder}`,
    borderRadius: 7,
  },
  removed: { color: c.t5, fontSize: 13, padding: '5px 0' },
  workflow: {
    color: c.t3,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
    padding: '5px 11px',
    border: `1px solid ${c.border}`,
    borderRadius: 7,
  },
  delete: { ...button, background: 'transparent', border: `1px solid ${c.border}`, color: c.t4 },
  question: { fontSize: 13, fontWeight: 600, color: c.t2 },
  cancel: { ...button, background: 'transparent', border: `1px solid ${c.border}`, color: c.t2 },
  // Danger as text on its own tint, not white on a fill: the dark theme's red
  // is light enough that white on it falls well short of legible.
  confirm: {
    ...button,
    background: c.dangerBg,
    border: `1px solid ${c.danger}`,
    color: c.danger,
    fontWeight: 600,
  },
}
