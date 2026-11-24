import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ApiError,
  api,
  isPending,
  type Me,
  type RolePolicy,
  type Run,
  type RunOptions,
} from './api'
import { Login } from './components/Login'
import { AccountChooser } from './components/AccountChooser'
import { RunTrigger } from './components/RunTrigger'
import { AdminPage } from './components/AdminPage'
import { onAdminPage, pathFor } from './route'
import { RunHistory } from './components/RunHistory'
import { EmptySummary, RunStats } from './components/RunStats'
import { RunTrend } from './components/RunTrend'
import { Appearance } from './components/Appearance'
import { ASIDE_WIDTH, COLUMN_GAP, useWide } from './use-compact'
import { fromSearch, toQuery, toSearch, type HistoryFilters } from './run-query'
import { pollDelay, refreshOnReturn } from './poll'
import { latestOnly } from './latest'
import { c } from './theme'

export function App() {
  const wide = useWide()
  // Who is signed in, to which sandbox, and as what (decision 52).
  const [me, setMe] = useState<Me | null>(null)
  const role = me?.role ?? null
  const [checking, setChecking] = useState(true)
  // The sandbox is locked down and this account is not its admin.
  const [locked, setLocked] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [adminOpen, setAdminOpen] = useState(() =>
    typeof window === 'undefined' ? false : onAdminPage(window.location.pathname),
  )
  const [runs, setRuns] = useState<Run[]>([])
  // Everything the caller may see, counted past the loaded pages — so the list
  // can say how much it is not showing rather than truncating in silence.
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // More than the first page is on screen: a reload would swap it for page one.
  const [loadedMore, setLoadedMore] = useState(false)
  const lastRefreshAt = useRef(0)
  const [policies, setPolicies] = useState<RolePolicy[]>([])
  // Which runs the list is narrowed to. Kept in the address bar so a filtered
  // view can be linked and survives a reload; read once, here, from wherever
  // the page was opened.
  const [filters, setFilters] = useState<HistoryFilters>(() =>
    typeof window === 'undefined' ? {} : fromSearch(window.location.search),
  )

  // What the signed-in caller may ask for: null while it loads, an error if it cannot.
  const [options, setOptions] = useState<RunOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // When the reader last came back to the tab; RunTrigger reads the gate again.
  const [returnedAt, setReturnedAt] = useState(0)
  // Whether this session's list has answered yet; until it has, a run link
  // cannot be said to be missing from it.
  const [listed, setListed] = useState(false)
  // List reads that have failed in a row; the poll backs off on them.
  const [failures, setFailures] = useState(0)
  // Every read of the run list goes through this, so only the newest is applied.
  const [lists] = useState(() => latestOnly(api.listRuns))

  /**
   * Ends the session on this page, and forgets everything it loaded.
   *
   * Setting `role` alone left the previous session's runs in state, and the
   * next sign-in rendered them until its own `GET /runs` answered — so a `dev`
   * signing in after an `admin` on the same tab was shown runs from branches
   * the server would never send a `dev`. Visibility is enforced in the query;
   * a client holding on to another session's rows walks around it.
   *
   * Clearing state was not enough on its own: a list request still in flight
   * answered after this and put the rows back. `lists.forget()` drops it.
   */
  const endSession = useCallback(() => {
    lists.forget()
    setListed(false)
    setFailures(0)
    setMe(null)
    setLocked(false)
    setRuns([])
    setTotal(0)
    setNextCursor(null)
    setPolicies([])
    setOptions(null)
    setOptionsError(null)
    setError(null)
  }, [lists])

  /**
   * Who am I — on load, so a refresh is not a sign-out, and again after
   * anything that changes the answer: a sign-in, the admin key, lockdown.
   * A 403 that says `locked` is a signed-in account the sandbox refuses; it is
   * shown as such, with a way to switch account, rather than as signed out.
   */
  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me())
      setLocked(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /locked down/.test(e.message)) {
        setMe(null)
        setLocked(true)
      } else {
        endSession()
      }
    } finally {
      setChecking(false)
    }
  }, [endSession])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  // The address follows the admin page, so it can be linked and survives a reload.
  useEffect(() => {
    const { search, hash, pathname } = window.location
    const next = pathFor(adminOpen)
    if (pathname !== next) window.history.pushState(null, '', `${next}${search}${hash}`)
  }, [adminOpen])

  useEffect(() => {
    const onPop = () => setAdminOpen(onAdminPage(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Read once per sign-in: what the form offers is a fact about the caller, and
  // it does not change while they look at it.
  useEffect(() => {
    if (!role) return
    setOptions(null)
    setOptionsError(null)
    api
      .options()
      .then(setOptions)
      .catch((e: unknown) =>
        setOptionsError(e instanceof Error ? e.message : 'Could not load what you can run'),
      )
  }, [role])

  useEffect(() => {
    if (!role) return
    api
      .roles()
      .then((r) => setPolicies(r.roles))
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
    lastRefreshAt.current = Date.now()
    try {
      const page = await lists.ask(toQuery(filters))
      if (!page) return
      setLoadedMore(false)
      setListed(true)
      setRuns(page.runs)
      setTotal(page.total)
      setNextCursor(page.nextCursor)
      setError(null)
      setFailures(0)
    } catch (e) {
      // An expired session should return to the sign-in screen rather than
      // leaving a dashboard that quietly fails every request.
      if (e instanceof ApiError && e.status === 401) {
        endSession()
        return
      }
      // Removed from the list or locked out since the page loaded: ask again.
      if (e instanceof ApiError && e.status === 403) {
        void loadMe()
        return
      }
      setFailures((n) => n + 1)
      setError(e instanceof Error ? e.message : 'Could not load runs')
    }
  }, [role, endSession, filters, lists, loadMe])

  /** Appends the next page. The cursor makes this safe against new runs
   *  arriving at the top: it names a row, not an offset. */
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await lists.ask({ ...toQuery(filters), cursor: nextCursor })
      // A filter change or a poll asked since; this page belongs to that old list.
      if (!page) return
      // Guards against a double-click racing two identical requests: a run
      // already on screen is never appended twice.
      setRuns((current) => {
        const seen = new Set(current.map((run) => run.id))
        return [...current, ...page.runs.filter((run) => !seen.has(run.id))]
      })
      setTotal(page.total)
      setNextCursor(page.nextCursor)
      setLoadedMore(true)
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
  }, [nextCursor, loadingMore, endSession, filters, lists])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The address follows the filters, replacing the entry rather than adding one:
  // narrowing the list is not a page someone will want to press Back through.
  useEffect(() => {
    const { pathname, hash } = window.location
    window.history.replaceState(null, '', `${pathname}${toSearch(filters)}${hash}`)
  }, [filters])

  /**
   * Asks again on a timer, fast while a run is in flight and slowly otherwise;
   * see poll.ts for why an idle list asks at all and when it stops.
   *
   * A hidden tab does not ask: nobody is looking, and returning to it reloads
   * the list (below).
   */
  const inFlight = runs.some((run) => isPending(run.status))
  useEffect(() => {
    if (!role) return
    const delay = pollDelay({ pending: inFlight, loadedMore, failures })
    if (delay === null) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, delay)
    return () => clearInterval(timer)
  }, [role, inFlight, loadedMore, failures, refresh])

  useEffect(() => {
    if (!role) return
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      if (refreshOnReturn(Date.now(), lastRefreshAt.current)) {
        void refresh()
        setReturnedAt(Date.now())
      }
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [role, refresh])

  // Centred and said in words, like the page's other waits; it was a bare
  // "Loading…" in the top corner, unlike anything else here.
  if (checking)
    return (
      <div style={s.loading} role="status">
        Checking whether you are signed in…
      </div>
    )
  const signedIn = () => {
    setChoosing(false)
    setChecking(true)
    void loadMe()
  }
  const chooser = choosing && (
    <AccountChooser onClose={() => setChoosing(false)} onSignedIn={signedIn} />
  )

  if (locked)
    return (
      <div style={s.loading}>
        <div style={s.lockedCard} role="alert">
          <h1 style={s.h1}>This sandbox is locked down</h1>
          <p style={s.sub}>
            Its admin turned lockdown on, so only the admin account may use it. Switch to the
            account listed as admin to lift it, or sign out for a new sandbox.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
            <button style={s.signOut} onClick={() => setChoosing(true)}>
              Switch account
            </button>
            <button style={s.signOut} onClick={() => void api.logout().then(endSession)}>
              Sign out
            </button>
          </div>
        </div>
        {chooser}
      </div>
    )
  if (!me || !role) return <Login onSignedIn={signedIn} />

  const viewPolicy = policies.find((p) => p.role === role)
  const pending = runs.filter((run) => isPending(run.status)).length
  const hoursLeft = me.sandbox.expiresAt
    ? Math.max(0, Math.round((Date.parse(me.sandbox.expiresAt) - Date.now()) / 3_600_000))
    : null

  const asideContent = (
    <>
      <RunStats runs={runs} total={total} collapsible={!wide} />

      {/* Only beside the list: stacked, an empty summary is simply absent. */}
      {wide && listed && runs.length === 0 && <EmptySummary />}

      <RunTrend runs={runs} collapsible={!wide} />
    </>
  )

  const mainContent = (
    <>
      {options ? (
        <RunTrigger
          key={role}
          options={options}
          role={role}
          returnedAt={returnedAt}
          onStarted={() => void refresh()}
        />
      ) : (
        <section style={s.optionsPending} aria-live="polite">
          {optionsError ?? 'Loading what you can run…'}
        </section>
      )}

      <RunHistory
        runs={runs}
        role={role}
        canDelete={viewPolicy?.canDelete ?? false}
        onChanged={() => void refresh()}
        total={total}
        hasMore={nextCursor !== null}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        options={options}
        filters={filters}
        onFilters={setFilters}
        listed={listed}
      />
    </>
  )

  return (
    <div style={wide ? { ...s.page, ...s.pageWide } : s.page}>
      <a href="#main" className="skip-link">
        Skip to the runs
      </a>
      <header style={s.top}>
        <div>
          <h1 style={s.h1}>Test Run Dashboard</h1>
          <p style={s.sub}>
            <strong style={{ color: c.t1, overflowWrap: 'anywhere' }}>{me.email}</strong> as{' '}
            <strong style={{ color: c.t1 }}>{role}</strong>
            {hoursLeft !== null && (
              <span style={{ color: c.t4 }}> · sandbox resets in {hoursLeft} h</span>
            )}
            {me.sandbox.lockdown && <span style={{ color: c.danger }}> · locked down</span>}
            {pending > 0 && (
              <span style={{ color: c.warn }}>
                {' '}
                · {pending} run{pending > 1 ? 's' : ''} in flight
              </span>
            )}
          </p>
        </div>
        <div style={s.actions}>
          {me.listedRole === 'admin' && !adminOpen && (
            <button style={s.signOut} onClick={() => setAdminOpen(true)}>
              Admin
            </button>
          )}
          <button style={s.signOut} onClick={() => setChoosing(true)}>
            Switch account
          </button>
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
      {chooser}

      {/*
        Two columns when there is room: the form that feeds the run list and
        the list itself on the left, what they add up to and who is looking on
        the right. Below that the column folds into one stack with the summary
        first. State before action: nobody opens a test dashboard to press a
        button, they open it to find out whether the last run passed.
      */}
      {/*
        The admin page replaces the runs rather than sitting above them: it is
        a separate place to go, and the address says so (route.ts).
      */}
      {adminOpen ? (
        <main id="main" style={s.main}>
          <AdminPage
            me={me}
            onChanged={() => {
              void loadMe()
              void refresh()
            }}
            onBack={() => setAdminOpen(false)}
          />
        </main>
      ) : wide ? (
        <div style={s.columns}>
          <main id="main" style={s.main}>
            {mainContent}
          </main>
          <aside style={s.aside}>{asideContent}</aside>
        </div>
      ) : (
        <>
          {asideContent}
          <main id="main" style={s.main}>
            {mainContent}
          </main>
        </>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  loading: { minHeight: '100vh', display: 'grid', placeItems: 'center', color: c.t4, fontSize: 14 },
  lockedCard: {
    maxWidth: 420,
    margin: '0 20px',
    textAlign: 'center',
    background: c.card,
    border: `1px solid ${c.dangerBorder}`,
    borderRadius: 14,
    padding: 22,
  },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  page: { maxWidth: '62rem', margin: '0 auto', padding: '30px 24px 60px' },
  // Wide enough for the list (about 620px) beside a 320px column.
  pageWide: { maxWidth: '76rem' },
  columns: {
    display: 'grid',
    gridTemplateColumns: `minmax(0, 1fr) ${ASIDE_WIDTH}px`,
    gap: COLUMN_GAP,
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
  h1: { fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-0.015em' },
  sub: { margin: '5px 0 0', color: c.t4, fontSize: 14 },
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
  optionsPending: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: '18px 20px',
    marginBottom: 18,
    color: c.t4,
    fontSize: 14,
  },
  error: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.danger}`,
    borderRadius: 12,
    padding: '12px 16px',
    marginBottom: 18,
    color: c.danger,
    fontSize: 14,
  },
}
