import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ApiError, api, isPending, type Role, type RolePolicy, type Run } from './api'
import { Login } from './components/Login'
import { RoleSwitcher } from './components/RoleSwitcher'
import { RunTrigger } from './components/RunTrigger'
import { AdminPanel } from './components/AdminPanel'
import { adminPanelMode } from './admin-panel'
import { RunHistory } from './components/RunHistory'
import { RunStats } from './components/RunStats'
import { RunTrend } from './components/RunTrend'
import { Appearance } from './components/Appearance'
import { useWide } from './use-compact'
import { c } from './theme'

export function App() {
  const wide = useWide()
  const [role, setRole] = useState<Role | null>(null)
  // Differs from `role` only while a demo session is previewing another
  // role's read view — mirrors the backend's role/viewAs split exactly, so
  // the write path (RunTrigger) always uses the real `role`, never this.
  const [viewAs, setViewAs] = useState<Role | null>(null)
  const [checking, setChecking] = useState(true)
  const [runs, setRuns] = useState<Run[]>([])
  // Everything the caller may see, counted past the loaded pages — so the list
  // can say how much it is not showing rather than truncating in silence.
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [policies, setPolicies] = useState<RolePolicy[]>([])
  const [canPreview, setCanPreview] = useState(false)
  const [simulates, setSimulates] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped when an admin changes the gate, to remount RunTrigger so it re-reads it.
  const [gateTick, setGateTick] = useState(0)

  /**
   * Ends the session on this page, and forgets everything it loaded.
   *
   * Setting `role` alone left the previous session's runs in state, and the
   * next sign-in rendered them until its own `GET /runs` answered — so a `dev`
   * signing in after an `admin` on the same tab was shown runs from branches
   * the server would never send a `dev`. Visibility is enforced in the query;
   * a client holding on to another session's rows walks around it.
   */
  const endSession = useCallback(() => {
    setRole(null)
    setViewAs(null)
    setRuns([])
    setTotal(0)
    setNextCursor(null)
    setPolicies([])
    setCanPreview(false)
    setSimulates(false)
    setError(null)
  }, [])

  // Restores an existing session on load, so a refresh is not a sign-out.
  useEffect(() => {
    api
      .me()
      .then(({ role }) => setRole(role))
      .catch(() => setRole(null))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (!role) return
    api
      .roles()
      .then((r) => {
        setPolicies(r.roles)
        setCanPreview(r.canPreview)
        setSimulates(r.simulates)
      })
      .catch(() => setPolicies([]))
  }, [role])

  /**
   * Reloads from the top.
   *
   * Deliberately drops any extra pages the reader had loaded. This runs on a
   * poll while a run is in flight, and re-fetching every loaded page on a timer
   * would multiply the request count by however far someone had scrolled;
   * stitching a fresh page one onto stale later pages is worse still, because
   * a new run at the top shifts every later row by one and the seam duplicates
   * a run. Returning to the first page is the honest, cheap option — and while
   * a run is in flight, the top is what the reader is watching.
   */
  const refresh = useCallback(async () => {
    if (!role) return
    try {
      const page = await api.listRuns()
      setRuns(page.runs)
      setTotal(page.total)
      setNextCursor(page.nextCursor)
      setViewAs(page.viewAs)
      setError(null)
    } catch (e) {
      // An expired session should return to the sign-in screen rather than
      // leaving a dashboard that quietly fails every request.
      if (e instanceof ApiError && e.status === 401) {
        endSession()
        return
      }
      setError(e instanceof Error ? e.message : 'Could not load runs')
    }
  }, [role, endSession])

  /** Appends the next page. The cursor makes this safe against new runs
   *  arriving at the top: it names a row, not an offset. */
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await api.listRuns({ cursor: nextCursor })
      // Guards against a double-click racing two identical requests: a run
      // already on screen is never appended twice.
      setRuns((current) => {
        const seen = new Set(current.map((run) => run.id))
        return [...current, ...page.runs.filter((run) => !seen.has(run.id))]
      })
      setTotal(page.total)
      setNextCursor(page.nextCursor)
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        endSession()
        return
      }
      setError(e instanceof Error ? e.message : 'Could not load more runs')
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, endSession])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Polls only while something is in flight.
   *
   * A fixed interval would keep hitting the API on an idle dashboard left open
   * all afternoon. Watching for pending rows means the polling stops on its own
   * when the last run finishes.
   */
  useEffect(() => {
    if (!role || !runs.some((run) => isPending(run.status))) return
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [role, runs, refresh])

  if (checking) return <div style={s.loading}>Loading…</div>
  if (!role) return <Login onSignedIn={setRole} />

  // The write path (RunTrigger) always uses the real, authenticated role —
  // previewing another role only changes what runs are shown below, never
  // what a new run may target or how many workers it may use.
  const viewingRole = viewAs ?? role
  const policy = policies.find((p) => p.role === role)
  const viewPolicy = policies.find((p) => p.role === viewingRole)
  const panelMode = adminPanelMode(role, viewingRole)
  const pending = runs.filter((run) => isPending(run.status)).length

  const asideContent = (
    <>
      <RunStats runs={runs} total={total} />

      <RunTrend runs={runs} collapsible={!wide} />

      {canPreview && policies.length > 0 && (
        <RoleSwitcher
          collapsible={!wide}
          role={viewingRole}
          policies={policies}
          onSwitched={async (next) => {
            // Handled like every other request here. It used to be the one
            // that was not: a refused preview rejected into nothing, and the
            // buttons simply did not respond.
            try {
              if (next === role) {
                await api.stopPreview()
              } else {
                await api.previewRole(next)
              }
            } catch (e) {
              if (e instanceof ApiError && e.status === 401) {
                endSession()
                return
              }
              setError(e instanceof Error ? e.message : 'Could not switch the preview')
              return
            }
            await refresh()
          }}
        />
      )}
    </>
  )

  const mainContent = (
    <>
      {/*
        Decided on the REAL role, never `viewingRole` alone. A demo session
        previewing admin gets the read-only panel — the live gate and what keys
        are — and never the writable one the server would refuse; the same
        real-role rule RunTrigger follows. See admin-panel.ts.

        `gateTick` remounts RunTrigger after the gate changes, so its "runs are
        paused" notice reflects the new state without a reload. RunTrigger reads
        the gate on mount, so a key change is the honest way to make it re-read.
      */}
      {panelMode && (
        <AdminPanel
          readOnly={panelMode === 'readOnly'}
          onGateChanged={() => setGateTick((n) => n + 1)}
        />
      )}

      {policy && (
        <RunTrigger
          key={`${role}-${gateTick}`}
          policy={policy}
          role={role}
          simulates={simulates}
          onStarted={() => void refresh()}
        />
      )}

      <RunHistory
        runs={runs}
        role={viewingRole}
        canDelete={viewPolicy?.canDelete ?? false}
        onChanged={() => void refresh()}
        total={total}
        hasMore={nextCursor !== null}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
      />
    </>
  )

  return (
    <div style={wide ? { ...s.page, ...s.pageWide } : s.page}>
      <header style={s.top}>
        <div>
          <h1 style={s.h1}>Test Run Dashboard</h1>
          <p style={s.sub}>
            Signed in as <strong style={{ color: c.t1 }}>{role}</strong>
            {viewingRole !== role && (
              <span style={{ color: c.t4 }}> · previewing {viewingRole}</span>
            )}
            {pending > 0 && (
              <span style={{ color: c.warn }}>
                {' '}
                · {pending} run{pending > 1 ? 's' : ''} in flight
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Appearance />
          <button
            onClick={() =>
              void api
                .logout()
                .then(endSession, (e: unknown) =>
                  setError(e instanceof Error ? e.message : 'Could not sign out'),
                )
            }
            style={s.signOut}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <div style={s.error}>{error}</div>}

      {/*
        Two columns when there is room: the form that feeds the run list and
        the list itself on the left, what they add up to and who is looking on
        the right. Below that the column folds into one stack with the summary
        first. State before action: nobody opens a test dashboard to press a
        button, they open it to find out whether the last run passed.
      */}
      {wide ? (
        <div style={s.columns}>
          <div style={s.main}>{mainContent}</div>
          <aside style={s.aside}>{asideContent}</aside>
        </div>
      ) : (
        <>
          {asideContent}
          {mainContent}
        </>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  loading: { padding: 40, color: c.t4 },
  page: { maxWidth: '62rem', margin: '0 auto', padding: '30px 24px 60px' },
  // Wide enough for the list (about 620px) beside a 320px column.
  pageWide: { maxWidth: '76rem' },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: 24,
    alignItems: 'start',
  },
  main: { minWidth: 0 },
  aside: { minWidth: 0 },
  top: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 22,
  },
  h1: { fontSize: 19, fontWeight: 600, margin: 0, letterSpacing: '-0.015em' },
  sub: { margin: '5px 0 0', color: c.t4, fontSize: 13.5 },
  signOut: {
    padding: '7px 14px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t4,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
  error: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.danger}`,
    borderRadius: 12,
    padding: '12px 16px',
    marginBottom: 18,
    color: c.danger,
    fontSize: 13.5,
  },
}
