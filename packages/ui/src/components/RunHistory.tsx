import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  RUNS_PER_PAGE,
  SUITE_LABELS,
  SUITE_REPOS,
  api,
  isPending,
  type Role,
  type Run,
  type RunOptions,
  type Suite,
} from '../api'
import { RunFilters, applyFilter, type StatusFilter } from './RunFilters'
import { RunActions } from './RunActions'
import { StatusIcon } from './StatusIcon'
import { runTag } from '../run-form'
import { TABLE_NEEDS, useCompact } from '../use-compact'
import {
  askDelete,
  cancelDelete,
  initialRows,
  linkNotice,
  runFromHash,
  runHash,
  toggleRow,
  type RowState,
} from '../run-rows'
import { CopyButton } from './CopyButton'
import { RunProblem } from './RunProblem'
import { AdvancedFilters } from './AdvancedFilters'
import { activeCount, type HistoryFilters } from '../run-query'
import { STATUS_LOOK, pendingNote } from '../run-status'
import { c, mono, status as sc } from '../theme'

/**
 * The run list — a table, with the rest of each run one click away.
 *
 * This was a card per run, on the argument that a run carries more than a row
 * can hold: an id, what it covered, a branch, a result split three ways,
 * timing, and two actions. That is true, and it was still the wrong call. The
 * job of a run list is comparison — which run went red first, whether a branch
 * fails more than others — and comparison is exactly what cards prevent: the
 * eye has to jump between blocks instead of running down a column. Cards read
 * well at five runs and stop working at fifty.
 *
 * So the row carries what is compared (status, what ran, result, when), and
 * everything else — full id, worker count, suite provenance, actions — lives in
 * a detail row the reader opens. Nothing the cards showed was dropped.
 *
 * Which runs appear is decided by the server, not filtered here — a `dev` is
 * sent only main-branch runs. Filtering client-side would mean the browser
 * receives rows it may not see, which is not a restriction at all.
 */

/**
 * Exported for its own tests.
 *
 * Both of these are pure and both have edges worth pinning — a boundary
 * between units, and a total of zero that would divide by zero one line
 * later. Neither is reachable from a component test without rendering a whole
 * card to read one string out of it.
 */
export const relative = (iso: string) => {
  // Clamped at zero. `startedAt` is the Worker's clock and `Date.now()` the
  // browser's; a browser a few seconds behind used to render "-2s ago", and
  // one five minutes behind "-300s ago" — every negative value lands in the
  // seconds branch. A run cannot have started in the future, so it started
  // "0s ago".
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

/**
 * When a run started, for a column that is read by scanning.
 *
 * "27d ago" is a poor answer to "which run was that": past a day, nobody can
 * place a run by counting days back. Within a day it stays relative ("2h ago" is
 * what a person watching the list wants); beyond that it is the date, with the
 * year only when it is not this one. The full local time is the cell's tooltip
 * (`startedTitle`).
 *
 * `timeZone` is for tests; leaving it out shows the reader's own.
 */
export function startedLabel(iso: string, now: number = Date.now(), timeZone?: string): string {
  const started = Date.parse(iso)
  if (Math.max(0, now - started) < 86_400_000) return relative(iso)
  const then = zoned(started, timeZone)
  const sameYear = then.year === zoned(now, timeZone).year
  return `${then.day} ${MONTHS[then.month - 1]}${sameYear ? '' : ` ${then.year}`}`
}

/** The exact time, in the reader's own zone, for a tooltip: `4 Sep 2026, 14:03:09`. */
export function startedTitle(iso: string, timeZone?: string): string {
  const p = zoned(Date.parse(iso), timeZone)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${two(p.hour)}:${two(p.minute)}:${two(p.second)}`
}

/**
 * Month names written out rather than asked of `Intl`: the short form of
 * September is "Sep" in one version of the locale data and "Sept" in another,
 * and a column that reads differently on two machines is a column nobody can
 * rely on a screenshot of.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The parts of an instant in a zone — numbers only, so nothing depends on locale wording. */
function zoned(ms: number, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * The branch, and what it was when the run happened.
 *
 * "main" says which branch and nothing about what was on it: the suite behind
 * `main` changes weekly and a run in last month's list ran last month's tests.
 * The version is what a person quotes and the commit is what identifies the
 * tree, and they arrive at different times — the commit is noted when the run is
 * dispatched, the version comes with the result — so the label shows the
 * version once it has one, the commit until then, and the branch alone for a
 * run that has neither (every simulated run).
 */
export function refLabel(run: Pick<Run, 'ref' | 'suiteVersion' | 'suiteSha'>): string {
  if (run.suiteVersion) return `${run.ref} · v${run.suiteVersion}`
  if (run.suiteSha) return `${run.ref} · ${run.suiteSha.slice(0, 7)}`
  return run.ref
}

export const duration = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)}s`)

/**
 * Who started a run, in words.
 *
 * A key's run has no name — nobody signed in to start it — so without this the
 * line would read as a bare role and a script's run would look like a person's.
 */
export const triggeredLabel = (run: Pick<Run, 'triggeredBy' | 'startedBy' | 'viaKey'>) =>
  run.viaKey
    ? `${run.triggeredBy} · API key`
    : run.startedBy
      ? `${run.startedBy} · ${run.triggeredBy}`
      : run.triggeredBy

/**
 * "Started" and "Took" as one line, for the narrow layout where they are no
 * longer columns. A run still in flight has no duration to give, so it gives
 * only when it started rather than a trailing separator.
 */
export const rowMeta = (run: Pick<Run, 'startedAt' | 'durationMs'>) =>
  [startedLabel(run.startedAt), duration(run.durationMs)].filter(Boolean).join(' · ')

/**
 * What the visibility scoping actually means for the signed-in role, in
 * words. Table-driven rather than a `role === 'dev' ? … : …` — that ternary
 * was silently wrong for `demo`, whose scope is neither "main only" nor
 * "every branch": it is every branch, but only the runs it started itself.
 */
const SCOPE_LABEL: Record<Role, string> = {
  // Shared by every demo visitor: `triggered_by` holds the role, not the
  // person, so "you" would promise a separation the query does not make.
  demo: 'runs started as demo — main branch only',
  dev: 'main branch only — your role’s scope',
  qa: 'every branch',
  admin: 'every branch',
}

/**
 * Pass/fail as a proportional bar.
 *
 * "112 / 118" needs arithmetic before it means anything; a bar that is almost
 * entirely green with a sliver of red is read instantly. The numbers stay
 * beside it for anyone who wants the exact figure.
 */
/**
 * The proportions the bar is drawn from, separated so they can be asserted.
 *
 * A run reporting zero tests is unusual but not impossible — a tag filter that
 * matches nothing produces one. Dividing by that total gives NaN widths, and
 * the obvious guard (`total || 1`) trades NaN for something worse: the
 * remainder becomes 100 and the bar renders full grey, which reads as "all of
 * something" rather than "nothing ran".
 *
 * So zero returns zero. An empty bar beside a literal `0 / 0` is the honest
 * rendering, and it is the case a reader is most likely to misread if the bar
 * is filled.
 */
export function resultShares(run: Run): { passed: number; failed: number; other: number } {
  const total = run.total ?? 0
  if (total <= 0) return { passed: 0, failed: 0, other: 0 }

  const passed = run.passed ?? 0
  const failed = run.failed ?? 0
  const other = Math.max(0, total - passed - failed)

  return {
    passed: (passed / total) * 100,
    failed: (failed / total) * 100,
    other: (other / total) * 100,
  }
}

/**
 * The commit a run's suite sha names, in the repository of the suite that ran.
 *
 * Exported for its own test: a wrong repository here is a link that renders
 * perfectly and goes to a 404, which nothing on the page would show.
 */
export const suiteCommitUrl = (suite: Suite, sha: string) => `${SUITE_REPOS[suite]}/commit/${sha}`

/**
 * Which suite produced a result, and a way back to the exact tree.
 *
 * Two facts rather than one because they answer different questions. The
 * version is what someone quotes — "it broke in 0.2.0" — and it moves only on
 * release, so most runs in a fortnight share one. The sha is the only thing
 * that identifies what actually ran, which is what you need when the answer to
 * "was this the same code?" has to be yes or no.
 *
 * Falls back to the version alone when there is no sha: a callback from a
 * workflow older than that field sends one and not the other, and a chip that
 * vanished for those runs would hide the version it does have.
 */
function SuiteChip({ suite, version, sha }: { suite: Suite; version: string; sha: string | null }) {
  const label = `suite ${version}`
  if (!sha) return <span style={s.chip}>{label}</span>

  return (
    <a
      href={suiteCommitUrl(suite, sha)}
      target="_blank"
      rel="noreferrer"
      style={s.suiteChip}
      title={sha}
    >
      {label} · {sha.slice(0, 7)}
    </a>
  )
}

function ResultBar({ run }: { run: Run }) {
  if (isPending(run.status)) {
    // No counts exist yet, so no counts are drawn: the API reports nothing
    // about progress until the callback, and a filling bar would be invented.
    // The moving bar says "in flight"; the words say for how long.
    return (
      <div style={{ minWidth: 130 }}>
        <div style={{ ...s.resultNumbers, color: c.t4, fontSize: 12.5 }}>{pendingNote(run)}</div>
        <div style={s.bar} role="progressbar" aria-label={`${run.status}, no progress figure yet`}>
          {run.status === 'running' && <div style={s.indeterminate} />}
        </div>
      </div>
    )
  }

  if (run.total === null) {
    return <span style={{ color: c.t5, fontSize: 13 }}>—</span>
  }

  const passed = run.passed ?? 0
  const failed = run.failed ?? 0
  const share = resultShares(run)

  return (
    <div style={{ minWidth: 130 }}>
      <div style={s.resultNumbers}>
        {/*
          The passed count is a number, not a verdict: it was bold red on a
          failed run, so the loudest thing in the row was how many passed,
          while the failure count sat small in a red that fails AA on white
          (3.76:1). The row's edge and icon carry the result; the failures
          are named in the AA red made for text.
        */}
        <strong style={{ color: c.t1, fontSize: 15 }}>{passed}</strong>
        <span style={{ color: c.t5, fontSize: 13 }}>/ {run.total}</span>
        {failed > 0 && (
          <span style={{ color: c.danger, fontSize: 12, fontWeight: 600 }}>· {failed} failed</span>
        )}
      </div>
      <div style={s.bar}>
        {share.passed > 0 && (
          <div style={{ ...s.barPart, width: `${share.passed}%`, background: sc.pass }} />
        )}
        {share.failed > 0 && (
          <div style={{ ...s.barPart, width: `${share.failed}%`, background: sc.fail }} />
        )}
        {share.other > 0 && (
          <div style={{ ...s.barPart, width: `${share.other}%`, background: sc.neutral }} />
        )}
      </div>
    </div>
  )
}

export function RunHistory({
  runs,
  role,
  canDelete,
  onChanged,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  options,
  filters,
  onFilters,
  listed = true,
}: {
  runs: Run[]
  role: Role
  canDelete: boolean
  onChanged: () => void
  /** Every run the caller may see — not the number loaded. */
  total: number
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  /** What the caller may run — the lists the filters offer. Null while it loads. */
  options: RunOptions | null
  filters: HistoryFilters
  onFilters: (next: HistoryFilters) => void
  /** Whether the list has answered at least once this session. */
  listed?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [rows, setRows] = useState<RowState>(() =>
    initialRows(typeof window === 'undefined' ? '' : window.location.hash),
  )
  const compact = useCompact()
  const { open, confirmingDelete } = rows

  /**
   * The button is shown whenever the *previewed* role may delete, so a demo
   * session previewing admin can see that the control exists — but the server
   * still refuses it, because deleting is authorised by the real signed-in
   * role. Surfacing that refusal is the point: silently swallowing it would
   * make a working guard look like a broken button.
   */
  async function remove(id: string) {
    setError(null)
    try {
      await api.deleteRun(id)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that run')
    }
  }

  const shown = applyFilter(runs, filter)

  // A run link opens its row; scroll to it once, when the row exists. Only for
  // the row the address named — opening a row by hand must not move the page.
  const linked = useRef(runFromHash(typeof window === 'undefined' ? '' : window.location.hash))
  useEffect(() => {
    const id = linked.current
    if (!id || !shown.some((r) => r.id === id)) return
    linked.current = null
    document.getElementById(`run-${id}`)?.scrollIntoView({ block: 'center' })
  }, [shown])

  /*
   * A link pasted into this tab changes only the fragment, so the page does not
   * load again and the hash above is never re-read; the row stayed shut until a
   * reload. Followed here as the first load would have.
   */
  const [linkedId, setLinkedId] = useState(linked.current)
  useEffect(() => {
    const follow = () => {
      const id = runFromHash(window.location.hash)
      if (!id) return
      linked.current = id
      setLinkedId(id)
      setRows({ open: id, confirmingDelete: null })
    }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  // Looked up once the list has answered, and only if it does not hold the run.
  const missing = listed && linkedId !== null && !runs.some((r) => r.id === linkedId)
  // `found` decides the way out: Load more cannot reach a run the role cannot see.
  const [notice, setNotice] = useState<{ text: string; found: boolean } | null>(null)
  useEffect(() => {
    if (!missing || !linkedId) return setNotice(null)
    let live = true
    api
      .run(linkedId)
      .then(
        (run) =>
          live && setNotice({ text: linkNotice(run, activeCount(filters) > 0), found: true }),
      )
      .catch(() => live && setNotice({ text: linkNotice(null, false), found: false }))
    return () => {
      live = false
    }
  }, [missing, linkedId, filters])

  return (
    <section>
      <header style={s.head}>
        <h2 style={s.title}>Recent runs</h2>
        <span style={s.scope}>{SCOPE_LABEL[role]}</span>
      </header>

      {options && (
        <AdvancedFilters options={options} filters={filters} viewing={role} onChange={onFilters} />
      )}

      {/* Only worth offering once there is more than one row to narrow. */}
      {runs.length > 1 && (
        <div style={s.filters}>
          <RunFilters runs={runs} value={filter} onChange={setFilter} />
        </div>
      )}

      {error && <div style={s.deleteError}>{error}</div>}

      {missing && notice && (
        <div role="status" style={s.linkNotice}>
          {notice.text}{' '}
          {!notice.found ? null : activeCount(filters) > 0 ? (
            <button onClick={() => onFilters({})} style={s.clearFilter}>
              Clear filters
            </button>
          ) : (
            hasMore && (
              <button onClick={onLoadMore} disabled={loadingMore} style={s.clearFilter}>
                Load more
              </button>
            )
          )}
        </div>
      )}

      {runs.length === 0 ? (
        activeCount(filters) > 0 ? (
          // Distinct from "no runs yet": the filters are what is hiding them, and
          // the way out is in the message rather than left to be guessed.
          <div style={s.empty}>
            No runs match these filters.{' '}
            <button onClick={() => onFilters({})} style={s.clearFilter}>
              Clear filters
            </button>
          </div>
        ) : (
          <div style={s.empty}>No runs yet. Start one above.</div>
        )
      ) : shown.length === 0 ? (
        // Distinct from "no runs at all": the filter is what is hiding them,
        // and the way out is in the message rather than left to be guessed.
        <div style={s.empty}>
          No {filter} runs.{' '}
          <button onClick={() => setFilter('all')} style={s.clearFilter}>
            Show all {runs.length}
          </button>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={compact ? s.tableCompact : s.table}>
            {!compact && (
              <thead>
                <tr>
                  <th style={{ ...s.th, ...s.thStatus }} aria-label="Status" />
                  <th style={s.th}>Run</th>
                  <th style={s.th}>Result</th>
                  <th style={{ ...s.th, ...s.thRight }}>Started</th>
                  <th style={{ ...s.th, ...s.thRight }}>Took</th>
                  <th style={s.th} aria-label="Details" />
                </tr>
              </thead>
            )}
            <tbody style={compact ? s.block : undefined}>
              {shown.map((run) => {
                const look = STATUS_LOOK[run.status]
                const expanded = open === run.id

                return (
                  <Fragment key={run.id}>
                    <tr
                      id={`run-${run.id}`}
                      onClick={() => setRows((r) => toggleRow(r, run.id))}
                      style={{
                        ...s.tr,
                        ...(expanded ? s.trOpen : null),
                        ...(compact ? s.trCompact : null),
                      }}
                    >
                      {/*
                        The edge is the status colour drawn down the row's left
                        side, so a column of rows reads as a column of results
                        before any of it is read. An inset shadow rather than a
                        border: a border would shift the cell by its width.
                      */}
                      <td
                        style={{
                          ...s.td,
                          ...s.tdStatus,
                          ...(compact ? cellSpan(1) : null),
                          boxShadow: `inset 4px 0 0 ${look.color}`,
                        }}
                      >
                        <StatusIcon status={run.status} />
                      </td>

                      <td style={{ ...s.td, ...(compact ? cellTop(2) : null) }}>
                        <div style={s.runCell}>
                          {/*
                            In the existing cell rather than a column of its
                            own: the table already carries six, and a seventh
                            for a two-value field would cost width on every
                            screen to answer a question asked once.
                          */}
                          <span style={s.runSuite}>{SUITE_LABELS[run.suite]}</span>
                          <span style={s.runService}>{run.service}</span>
                          {runTag(run.tags) && <span style={s.runTags}>{runTag(run.tags)}</span>}
                          <span style={s.runRef} title={run.suiteSha ?? undefined}>
                            {refLabel(run)}
                          </span>
                          {run.simulated && (
                            <span
                              style={s.runSimulated}
                              title="No workflow ran: these numbers come from the simulator, and Report opens a shared sample."
                            >
                              simulated
                            </span>
                          )}
                          {run.viaKey && (
                            <span
                              style={s.runSimulated}
                              title="Started with an API key, not from this page."
                            >
                              via key
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={{ ...s.td, ...(compact ? cellBottom(2) : null) }}>
                        <ResultBar run={run} />
                        {compact && <div style={s.meta}>{rowMeta(run)}</div>}
                      </td>

                      {!compact && (
                        <>
                          <td style={{ ...s.td, ...s.tdRight, ...mono }}>
                            <span title={startedTitle(run.startedAt)}>
                              {startedLabel(run.startedAt)}
                            </span>
                          </td>

                          <td style={{ ...s.td, ...s.tdRight, ...mono }}>
                            {duration(run.durationMs) ?? '—'}
                          </td>
                        </>
                      )}

                      <td style={{ ...s.td, ...s.tdRight, ...(compact ? cellSpan(3) : null) }}>
                        {/*
                          A button, because the row is not one. The row takes
                          a click, but a <tr> cannot take focus, so with only
                          the row to open it the detail — and the report link
                          and Delete inside it — could not be reached from a
                          keyboard at all. The caret was already the thing
                          that looked like a control; now it is one.
                        */}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} details for run ${run.id}`}
                          onClick={(e) => {
                            // The row would toggle it straight back.
                            e.stopPropagation()
                            setRows((r) => toggleRow(r, run.id))
                          }}
                          style={s.caretButton}
                        >
                          <span
                            aria-hidden
                            style={{
                              ...s.caret,
                              transform: expanded ? 'rotate(90deg)' : 'none',
                            }}
                          >
                            ›
                          </span>
                        </button>
                      </td>
                    </tr>

                    {expanded && (
                      <tr style={{ ...s.detailRow, ...(compact ? s.block : null) }}>
                        <td colSpan={6} style={{ ...s.detailCell, ...(compact ? s.block : null) }}>
                          <div style={s.detailGrid}>
                            <Detail label="Run id">
                              <span style={{ ...mono, color: c.t2 }}>{run.id}</span>{' '}
                              <span style={s.copies}>
                                <CopyButton text={run.id} label="Copy id" />
                                <CopyButton
                                  text={`${window.location.origin}${window.location.pathname}${runHash(run.id)}`}
                                  label="Copy link"
                                />
                              </span>
                            </Detail>

                            {/*
                              The role always; the name only when someone gave
                              one. A team sharing a password would otherwise see
                              every row saying the same thing — which is the
                              whole reason the name exists.
                            */}
                            <Detail label="Triggered by">{triggeredLabel(run)}</Detail>

                            {run.workers !== null && run.workers !== undefined && (
                              <Detail label="Workers">
                                <span style={mono}>{run.workers}</span>
                              </Detail>
                            )}

                            {/*
                              Shown only once the callback has arrived: a queued
                              or simulated run has no suite to name, and a field
                              reading "suite —" would be noise on most rows.
                            */}
                            {run.suiteVersion && (
                              <Detail label="Suite">
                                <SuiteChip
                                  suite={run.suite}
                                  version={run.suiteVersion}
                                  sha={run.suiteSha}
                                />
                              </Detail>
                            )}
                          </div>

                          <RunProblem run={run} />

                          <RunActions
                            run={run}
                            canDelete={canDelete}
                            confirming={confirmingDelete === run.id}
                            onAskDelete={() => setRows((r) => askDelete(r, run.id))}
                            onCancel={() => setRows(cancelDelete)}
                            onConfirm={() => {
                              setRows(cancelDelete)
                              void remove(run.id)
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        The list used to stop at 25 with nothing said about it — not below the
        fold, but unreachable. The count is always shown once there is more than
        a page, so "showing 25 of 91" is a fact on screen rather than something
        a reader has to infer from a list that simply ends.
      */}
      {runs.length > 0 && (total > runs.length || hasMore) && (
        <div style={s.more}>
          <span style={s.moreCount}>
            Showing <strong style={{ color: c.t2 }}>{runs.length}</strong> of {total}
          </span>
          {hasMore && (
            <button onClick={onLoadMore} disabled={loadingMore} style={s.moreButton}>
              {loadingMore
                ? 'Loading…'
                : `Load ${Math.min(RUNS_PER_PAGE, total - runs.length)} more`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** One labelled fact in the expanded row. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={s.detailLabel}>{label}</div>
      <div style={s.detailValue}>{children}</div>
    </div>
  )
}

// Both lines of a row are pinned to a column and a grid line, because the cells
// are not in source order: Started and Took are gone in the narrow layout.
const cellSpan = (column: number): CSSProperties => ({
  gridColumn: column,
  gridRow: '1 / 3',
  // Stretched, so the status edge runs the full height of the two-line row,
  // and centred by hand: a grid item is not a table cell, so vertical-align
  // no longer centres what is in it.
  alignSelf: 'stretch',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})
const cellTop = (column: number): CSSProperties => ({
  gridColumn: column,
  gridRow: 1,
  paddingBottom: 2,
})
const cellBottom = (column: number): CSSProperties => ({
  gridColumn: column,
  gridRow: 2,
  paddingTop: 0,
})

const s: Record<string, CSSProperties> = {
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  title: { fontSize: 15, fontWeight: 600, color: c.t1 },
  scope: { fontSize: 12.5, color: c.t5 },
  filters: { marginBottom: 12 },
  clearFilter: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: c.primary,
    font: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  empty: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: '28px 20px',
    color: c.t4,
    fontSize: 14,
    textAlign: 'center',
  },

  deleteError: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.danger}`,
    borderRadius: 10,
    padding: '10px 14px',
    marginBottom: 10,
    color: c.danger,
    fontSize: 13,
  },

  // Neutral, not red: a link to a run outside the view is not a failure.
  linkNotice: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 10,
    padding: '10px 14px',
    marginBottom: 10,
    color: c.t2,
    fontSize: 13,
  },

  tableWrap: {
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    overflowX: 'auto',
    background: c.card,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    // Below this the columns stop being readable and the wrapper scrolls
    // instead of squeezing them — a table that reflows into three-word columns
    // is harder to scan than one you push sideways.
    minWidth: TABLE_NEEDS,
  },
  // The narrow layout. A row is a grid: the status takes the first column over
  // both lines, the caret the last, and what ran sits above its result.
  tableCompact: { width: '100%', display: 'block' },
  block: { display: 'block' },
  trCompact: {
    display: 'grid',
    gridTemplateColumns: '52px minmax(0, 1fr) 44px',
    alignItems: 'center',
  },
  meta: { ...mono, fontSize: 12, color: c.t5, marginTop: 5 },
  th: {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: c.t5,
    padding: '10px 14px',
    borderBottom: `1px solid ${c.border}`,
    whiteSpace: 'nowrap',
  },
  thStatus: { width: 56, paddingLeft: 18, paddingRight: 4 },
  thRight: { textAlign: 'right' },
  tr: {
    cursor: 'pointer',
    borderBottom: `1px solid ${c.divider}`,
  },
  trOpen: { background: c.surface },
  td: {
    padding: '11px 14px',
    fontSize: 13,
    color: c.t2,
    verticalAlign: 'middle',
  },
  tdStatus: { width: 56, paddingLeft: 18, paddingRight: 4 },
  tdRight: { textAlign: 'right', color: c.t4, fontSize: 12.5, whiteSpace: 'nowrap' },
  // Service is the identity of the row; the tag and branch qualify it, so they
  // are present but recede.
  // Wraps in the table too, not only in cards. Unwrapped, a long service with a
  // tag, a ref and two chips held this cell at 332px, and between 640 and 767px
  // the table outgrew its box and cut off Started, Took and the caret.
  runCell: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 4,
    minWidth: 0,
  },
  runSuite: {
    ...mono,
    fontSize: 10.5,
    letterSpacing: '0.04em',
    color: c.t4,
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '1px 5px',
  },
  runService: { color: c.t1, fontWeight: 600, fontSize: 13.5 },
  runTags: { ...mono, fontSize: 11.5, color: c.t4 },
  runRef: { ...mono, fontSize: 11.5, color: c.t5 },
  // Dashed rather than filled: it qualifies the row, it is not a status.
  runSimulated: {
    fontSize: 11,
    color: c.t4,
    border: `1px dashed ${c.border}`,
    borderRadius: 5,
    padding: '0 5px',
  },
  caretButton: {
    background: 'none',
    border: 'none',
    padding: '2px 6px',
    margin: '-2px -6px',
    cursor: 'pointer',
    borderRadius: 4,
    lineHeight: 1,
  },
  caret: {
    display: 'inline-block',
    color: c.t5,
    fontSize: 15,
    transition: 'transform 0.15s ease',
  },

  detailRow: { background: c.surface },
  detailCell: {
    padding: '14px 16px 16px',
    borderBottom: `1px solid ${c.border}`,
  },
  copies: { display: 'inline-flex', gap: 6, marginLeft: 6, verticalAlign: 'middle' },
  detailGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px 32px',
  },
  detailLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: c.t5,
    marginBottom: 4,
  },
  detailValue: { fontSize: 13, color: c.t2 },

  more: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  moreCount: { fontSize: 12.5, color: c.t5 },
  moreButton: {
    padding: '7px 15px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t2,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },

  chip: {
    ...mono,
    fontSize: 11,
    color: c.t4,
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '2px 7px',
  },
  // A chip that is also a link: same shape as its neighbours so the row stays
  // even, but coloured so it reads as clickable rather than as another label.
  suiteChip: {
    ...mono,
    fontSize: 11,
    color: c.primary,
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '2px 7px',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },

  resultNumbers: {
    ...mono,
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 6,
  },
  bar: {
    height: 5,
    background: c.divider,
    borderRadius: 3,
    overflow: 'hidden',
    display: 'flex',
    // Segments are separated rather than butted together. Where a green run
    // meets a red one the boundary was carried by hue alone, and that is the
    // pair colour-vision deficiency flattens — a sliver of failures could read
    // as part of the pass bar. The gap is the boundary; the colour is the
    // label on it.
    gap: 2,
  },
  // A segment that travels the length of the bar. Colour is the pending amber;
  // reduced motion cuts the animation to one frame (index.html) and leaves it
  // as a short bar at the start, still distinct from an empty one.
  indeterminate: {
    height: '100%',
    width: '38%',
    borderRadius: 3,
    background: sc.pending,
    animation: 'indeterminate 1.4s ease-in-out infinite',
  },
  barPart: { height: '100%', flexShrink: 0, transition: 'width 0.5s ease' },
}
