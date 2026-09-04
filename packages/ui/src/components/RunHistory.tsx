import { useState, type CSSProperties } from 'react'
import { api, isPending, type Role, type Run, type RunStatus } from '../api'
import { RunFilters, applyFilter, type StatusFilter } from './RunFilters'
import { c, status as sc } from '../theme'

/**
 * The run list — a card per run rather than table rows.
 *
 * A run carries more than a table row wants to hold: an id, what it covered, a
 * branch, a result split three ways, timing, and two actions. Squeezed into
 * columns it becomes unreadable at the width most people have; as a card each
 * run gets room and the eye follows one block at a time.
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
}: {
  runs: Run[]
  role: Role
  canDelete: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')

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
        <div style={s.list}>
          {shown.map((run) => {
            const st = STATUS[run.status]
            return (
              <article key={run.id} style={{ ...s.card, borderLeftColor: st.fg }}>
                <div style={s.cardTop}>
                  <div style={{ minWidth: 0 }}>
                    <div style={s.runId}>{run.id}</div>
                    <div style={s.meta}>
                      <span style={s.chip}>{run.service}</span>
                      <span style={s.chip}>@{run.tags}</span>
                      <span style={s.chip}>{run.ref}</span>
                      {run.workers && <span style={s.chip}>{run.workers}w</span>}
                      {/*
                        Which suite produced this result, shown only once its
                        callback has arrived. A queued or simulated run has no
                        suite to name, and a chip reading "suite —" would be
                        noise on most rows.

                        Linked to the commit rather than the release: the
                        version is what a person quotes, the sha is what they
                        need when they go looking. `title` carries the full sha
                        so the short form is never the only copy of it.
                      */}
                      {run.suiteVersion && (
                        <SuiteChip version={run.suiteVersion} sha={run.suiteSha} />
                      )}
                    </div>
                  </div>

                  <span style={{ ...s.badge, color: st.fg, background: st.bg }}>
                    {isPending(run.status) && <span style={{ ...s.dot, background: st.fg }} />}
                    {st.label}
                  </span>
                </div>

                <div style={s.cardBottom}>
                  <ResultBar run={run} />

                  <div style={s.timing}>
                    <span>{relative(run.startedAt)}</span>
                    {duration(run.durationMs) && <span>· {duration(run.durationMs)}</span>}
                    <span>· by {run.triggeredBy}</span>
                  </div>

                  <div style={s.actions}>
                    {run.reportUrl && (
                      <a href={run.reportUrl} target="_blank" rel="noreferrer" style={s.report}>
                        Report ↗
                      </a>
                    )}
                    {canDelete && (
                      <button onClick={() => void remove(run.id)} style={s.delete}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
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

  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    background: c.card,
    border: `1px solid ${c.border}`,
    // A status stripe down the left edge, set per-card below. Colour is the
    // first thing read when scanning a list, and a red run that looks
    // identical to a green one until you reach the badge is a red run that
    // gets missed.
    borderLeftWidth: 3,
    borderLeftStyle: 'solid',
    borderRadius: 12,
    padding: '15px 18px',
    animation: 'fade-in 0.3s ease',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  runId: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13.5,
    fontWeight: 500,
    color: c.t1,
  },
  meta: { display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' },
  chip: {
    fontSize: 11.5,
    color: c.t4,
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '2px 7px',
  },
  // A chip that is also a link: same shape as its neighbours so the row stays
  // even, but coloured so it reads as clickable rather than as another label.
  suiteChip: {
    fontSize: 11.5,
    color: c.primary,
    background: c.surface,
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

  cardBottom: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 14,
    paddingTop: 13,
    borderTop: `1px solid ${c.divider}`,
    flexWrap: 'wrap',
  },
  resultNumbers: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 },
  bar: {
    height: 5,
    background: c.divider,
    borderRadius: 3,
    overflow: 'hidden',
    display: 'flex',
  },
  barPart: { height: '100%', flexShrink: 0, transition: 'width 0.5s ease' },

  timing: { fontSize: 12.5, color: c.t5, display: 'flex', gap: 5, flexWrap: 'wrap' },
  actions: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
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
