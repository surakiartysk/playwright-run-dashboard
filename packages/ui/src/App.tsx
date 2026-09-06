import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ApiError, api, isPending, type Role, type RolePolicy, type Run } from './api'
import { Login } from './components/Login'
import { RoleSwitcher } from './components/RoleSwitcher'
import { RunTrigger } from './components/RunTrigger'
import { AdminPanel } from './components/AdminPanel'
import { RunHistory } from './components/RunHistory'
import { RunStats } from './components/RunStats'
import { RunTrend } from './components/RunTrend'
import { c, currentTheme, toggleTheme } from './theme'

export function App() {
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
  const [error, setError] = useState<string | null>(null)
  // Bumped by the theme toggle so the header re-renders with the new icon.
  const [, setThemeTick] = useState(0)
  // Bumped when an admin changes the gate, to remount RunTrigger so it re-reads it.
  const [gateTick, setGateTick] = useState(0)

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
        setRole(null)
        return
      }
      setError(e instanceof Error ? e.message : 'Could not load runs')
    }
  }, [role])

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
        setRole(null)
        return
      }
      setError(e instanceof Error ? e.message : 'Could not load more runs')
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore])

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
  const pending = runs.filter((run) => isPending(run.status)).length

  return (
    <div style={s.page}>
      <header style={s.top}>
        <div>
          <h1 style={s.h1}>Test Run Dashboard</h1>
          <p style={s.sub}>
            Signed in as <strong style={{ color: c.t1 }}>{role}</strong>
            {viewingRole !== role && (
              <span style={{ color: c.t4 }}> · previewing {viewingRole}</span>
            )}
            {pending > 0 && (
              <span style={{ color: '#d97706' }}>
                {' '}
                · {pending} run{pending > 1 ? 's' : ''} in flight
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              toggleTheme()
              setThemeTick((n) => n + 1)
            }}
            style={s.signOut}
            aria-label="Toggle theme"
          >
            {currentTheme() === 'dark' ? '☀' : '☾'}
          </button>
          <button onClick={() => void api.logout().then(() => setRole(null))} style={s.signOut}>
            Sign out
          </button>
        </div>
      </header>

      {canPreview && policies.length > 0 && (
        <RoleSwitcher
          role={viewingRole}
          policies={policies}
          onSwitched={async (next) => {
            if (next === role) {
              await api.stopPreview()
            } else {
              await api.previewRole(next)
            }
            await refresh()
          }}
        />
      )}

      {error && <div style={s.error}>{error}</div>}

      {/*
        State before action.

        The order used to be gate, trigger, then the numbers — controls first,
        answers last. But nobody opens a test dashboard to press a button; they
        open it to find out whether the last run passed, and had to scroll past
        two forms to reach that. Summary, then trend, then the controls, then
        the history a reader digs into once the headline has told them whether
        they need to.
      */}
      <RunStats runs={runs} />

      <RunTrend runs={runs} />

      {/*
        Gated on the REAL role, never `viewingRole`. A demo session previewing
        admin sees admin's read view; it must not be offered write controls the
        server would refuse — the same real-role rule RunTrigger follows.

        `gateTick` remounts RunTrigger after the gate changes, so its "runs are
        paused" notice reflects the new state without a reload. RunTrigger reads
        the gate on mount, so a key change is the honest way to make it re-read.
      */}
      {role === 'admin' && <AdminPanel onGateChanged={() => setGateTick((n) => n + 1)} />}

      {policy && (
        <RunTrigger
          key={`${role}-${gateTick}`}
          policy={policy}
          role={role}
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
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  loading: { padding: 40, color: c.t4 },
  page: { maxWidth: '62rem', margin: '0 auto', padding: '30px 24px 60px' },
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
    borderLeft: `3px solid ${'#dc2626'}`,
    borderRadius: 12,
    padding: '12px 16px',
    marginBottom: 18,
    color: '#dc2626',
    fontSize: 13.5,
  },
}
