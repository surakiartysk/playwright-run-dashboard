import { useEffect, useState, type CSSProperties } from 'react'
import { api, type Run, type RunDetails } from '../api'
import { failureSummary, hasFailureList, problemNote, where } from '../run-problem'
import { c, mono, status as sc } from '../theme'

/**
 * Why a run did not pass, in the detail row.
 *
 * The row says "2 failed" and a bar; this says which two. Fetched when the row
 * is opened rather than carried by the list: a page of rows each holding twenty
 * messages is a payload the list should not become, and most rows are never
 * opened.
 */
export function RunProblem({ run }: { run: Run }) {
  const note = problemNote(run)
  if (note) return <p style={s.note}>{note}</p>
  if (!hasFailureList(run.status)) return null
  return <FailureLoader run={run} />
}

type Loaded =
  { state: 'loading' } | { state: 'failed' } | { state: 'ready'; details: RunDetails | null }

function FailureLoader({ run }: { run: Run }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    // Not applied if the row is closed, or another opened, before it answers.
    let live = true
    setLoaded({ state: 'loading' })
    api
      .run(run.id)
      .then((r) => live && setLoaded({ state: 'ready', details: r.details }))
      .catch(() => live && setLoaded({ state: 'failed' }))
    return () => {
      live = false
    }
  }, [run.id])

  return <FailureList run={run} loaded={loaded} />
}

/** The presentation, apart from the fetch, so each state can be rendered. */
export function FailureList({ run, loaded }: { run: Run; loaded: Loaded }) {
  if (loaded.state === 'loading') return <p style={s.note}>Loading the failures…</p>
  if (loaded.state === 'failed')
    return <p style={s.note}>Could not load the failures for this run.</p>
  if (!loaded.details) {
    return (
      <p style={s.note}>
        This result did not say which tests failed.
        {run.reportUrl ? ' The report has them.' : ''}
      </p>
    )
  }

  const { details } = loaded
  return (
    <section style={s.wrap} aria-label="Failures">
      <h3 style={s.heading}>{failureSummary(details, run.failed)}</h3>
      <ul style={s.list}>
        {details.failures.map((f, i) => (
          <li key={`${f.style}-${f.file}-${f.title}-${i}`} style={s.item}>
            <div style={s.title}>{f.title}</div>
            <div style={s.meta}>
              <span style={mono}>{where(f)}</span>
              {f.style && <span style={s.chip}>{f.style}</span>}
              {f.tags.map((t) => (
                <span key={t} style={s.chip}>
                  @{t}
                </span>
              ))}
            </div>
            {f.message && <div style={s.message}>{f.message}</div>}
          </li>
        ))}
      </ul>
    </section>
  )
}

const s: Record<string, CSSProperties> = {
  note: { margin: '14px 0 0', fontSize: 13, color: c.t3, lineHeight: 1.5 },
  wrap: { marginTop: 16 },
  // Text, so the themed danger colour and its 4.5:1, not the status mark's 3:1.
  heading: { margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: c.danger },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 },
  item: {
    padding: '9px 12px',
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${sc.fail}`,
    borderRadius: 8,
  },
  title: { fontSize: 13, fontWeight: 600, color: c.t1 },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    fontSize: 12,
    color: c.t4,
  },
  chip: {
    ...mono,
    fontSize: 11,
    padding: '0 6px',
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    color: c.t4,
  },
  message: {
    ...mono,
    marginTop: 6,
    fontSize: 12,
    color: c.t2,
    lineHeight: 1.45,
    overflowWrap: 'anywhere',
  },
}
