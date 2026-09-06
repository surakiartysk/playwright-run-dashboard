import { Fragment, useState, type CSSProperties } from 'react'
import { RUNS_PER_PAGE, api, isPending, type Role, type Run, type RunStatus } from '../api'
import { RunFilters, applyFilter, type StatusFilter } from './RunFilters'
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
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

export const duration = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)}s`)

/**
 * What the visibility scoping actually means for the signed-in role, in
 * words. Table-driven rather than a `role === 'dev' ? … : …` — that ternary
 * was silently wrong for `demo`, whose scope is neither "main only" nor
 * "every branch": it is every branch, but only the runs it started itself.
 */
const SCOPE_LABEL: Record<Role, string> = {
  demo: 'runs you started — main branch only',
  dev: 'main branch only — your role’s scope',
  qa: 'every branch',
  admin: 'every branch',
}

const STATUS: Record<RunStatus, { fg: string; bg: string; label: string }> = {
  passed: { fg: sc.pass, bg: sc.passBg, label: 'passed' },
  failed: { fg: sc.fail, bg: sc.failBg, label: 'failed' },
  error: { fg: sc.fail, bg: sc.failBg, label: 'error' },
  timeout: { fg: sc.fail, bg: sc.failBg, label: 'timeout' },
  queued: { fg: sc.pending, bg: sc.pendingBg, label: 'queued' },
  running: { fg: sc.pending, bg: sc.pendingBg, label: 'running' },
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

/** The repository the suite version links back to. */
const SUITE_REPO = 'https://github.com/surakiartysk/playwright-api-automation-patterns'

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
function SuiteChip({ version, sha }: { version: string; sha: string | null }) {
  const label = `suite ${version}`
  if (!sha) return <span style={s.chip}>{label}</span>

  return (
    <a
      href={`${SUITE_REPO}/commit/${sha}`}
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
  if (isPending(run.status) || run.total === null) {
    return <span style={{ color: c.t5, fontSize: 13 }}>—</span>
  }

  const passed = run.passed ?? 0
  const failed = run.failed ?? 0
  const share = resultShares(run)

  return (
    <div style={{ minWidth: 130 }}>
      <div style={s.resultNumbers}>
        <strong style={{ color: failed > 0 ? sc.fail : sc.pass, fontSize: 15 }}>{passed}</strong>
        <span style={{ color: c.t5, fontSize: 13 }}>/ {run.total}</span>
        {failed > 0 && <span style={{ color: sc.fail, fontSize: 12 }}>· {failed} failed</span>}
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
}) {
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [open, setOpen] = useState<string | null>(null)

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

  return (
    <section>
      <header style={s.head}>
        <h2 style={s.title}>Recent runs</h2>
        <span style={s.scope}>{SCOPE_LABEL[role]}</span>
      </header>

      {/* Only worth offering once there is more than one row to narrow. */}
      {runs.length > 1 && (
        <div style={s.filters}>
          <RunFilters runs={runs} value={filter} onChange={setFilter} />
        </div>
      )}

      {error && <div style={s.deleteError}>{error}</div>}

      {runs.length === 0 ? (
        <div style={s.empty}>No runs yet. Start one above.</div>
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
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, ...s.thStatus }}>Status</th>
                <th style={s.th}>Run</th>
                <th style={s.th}>Result</th>
                <th style={{ ...s.th, ...s.thRight }}>Started</th>
                <th style={{ ...s.th, ...s.thRight }}>Took</th>
                <th style={s.th} aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {shown.map((run) => {
                const st = STATUS[run.status]
                const expanded = open === run.id

                return (
                  <Fragment key={run.id}>
                    <tr
                      onClick={() => setOpen(expanded ? null : run.id)}
                      style={{ ...s.tr, ...(expanded ? s.trOpen : null) }}
                    >
                      <td style={{ ...s.td, ...s.tdStatus }}>
                        <span style={{ ...s.badge, color: st.fg, background: st.bg }}>
                          {isPending(run.status) && (
                            <span style={{ ...s.dot, background: st.fg }} />
                          )}
                          {st.label}
                        </span>
                      </td>

                      <td style={s.td}>
                        <div style={s.runCell}>
                          <span style={s.runService}>{run.service}</span>
                          <span style={s.runTags}>@{run.tags}</span>
                          <span style={s.runRef}>{run.ref}</span>
                        </div>
                      </td>

                      <td style={s.td}>
                        <ResultBar run={run} />
                      </td>

                      <td style={{ ...s.td, ...s.tdRight, ...mono }}>{relative(run.startedAt)}</td>

                      <td style={{ ...s.td, ...s.tdRight, ...mono }}>
                        {duration(run.durationMs) ?? '—'}
                      </td>

                      <td style={{ ...s.td, ...s.tdRight }}>
                        <span
                          aria-hidden
                          style={{
                            ...s.caret,
                            transform: expanded ? 'rotate(90deg)' : 'none',
                          }}
                        >
                          ›
                        </span>
                      </td>
                    </tr>

                    {expanded && (
                      <tr style={s.detailRow}>
                        <td colSpan={6} style={s.detailCell}>
                          <div style={s.detailGrid}>
                            <Detail label="Run id">
                              <span style={{ ...mono, color: c.t2 }}>{run.id}</span>
                            </Detail>

                            <Detail label="Triggered by">{run.triggeredBy}</Detail>

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
                                <SuiteChip version={run.suiteVersion} sha={run.suiteSha} />
                              </Detail>
                            )}
                          </div>

                          <div style={s.detailActions}>
                            {run.reportUrl && (
                              <a
                                href={run.reportUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={s.report}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Report ↗
                              </a>
                            )}
                            {canDelete && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void remove(run.id)
                                }}
                                style={s.delete}
                              >
                                Delete
                              </button>
                            )}
                          </div>
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
    borderLeft: '3px solid #dc2626',
    borderRadius: 10,
    padding: '10px 14px',
    marginBottom: 10,
    color: '#dc2626',
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
    minWidth: 620,
  },
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
  thStatus: { width: 108 },
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
  tdStatus: { width: 108 },
  tdRight: { textAlign: 'right', color: c.t4, fontSize: 12.5, whiteSpace: 'nowrap' },
  // Service is the identity of the row; the tag and branch qualify it, so they
  // are present but recede.
  runCell: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 },
  runService: { color: c.t1, fontWeight: 600, fontSize: 13.5 },
  runTags: { ...mono, fontSize: 11.5, color: c.t4 },
  runRef: { ...mono, fontSize: 11.5, color: c.t5 },
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
  detailActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },

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

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 11px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    animation: 'pulse-dot 1.4s ease-in-out infinite',
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
  barPart: { height: '100%', flexShrink: 0, transition: 'width 0.5s ease' },

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
  delete: {
    padding: '5px 11px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 7,
    color: c.t4,
    font: 'inherit',
    fontSize: 12.5,
    cursor: 'pointer',
  },
}
