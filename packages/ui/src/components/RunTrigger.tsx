import { useEffect, useState, type CSSProperties } from 'react'
import { api, type Role, type RolePolicy } from '../api'
import { c, status } from '../theme'

/**
 * The form that starts a run.
 *
 * Options are constrained to what the current role may actually do — the ref
 * list and the worker ceiling come from the same policy table the API
 * enforces. Offering a choice the server will reject is a worse experience
 * than not offering it, and re-deriving the rules here would let the two drift.
 *
 * The server still validates. This is a convenience, not a control.
 */

const SERVICES = ['all', 'items', 'reservations', 'maintenance-logs', 'core']
const TAGS = ['smoke', 'isolated', 'flow']

export function RunTrigger({
  policy,
  role,
  onStarted,
}: {
  policy: RolePolicy
  role: Role
  onStarted: () => void
}) {
  const [service, setService] = useState('items')
  const [tags, setTags] = useState('smoke')
  const [ref, setRef] = useState('main')
  const [workers, setWorkers] = useState(Math.min(4, policy.maxWorkers))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<{ closed: boolean; opensAt: string | null } | null>(null)

  /**
   * The gate, read up front rather than discovered by pressing Run.
   *
   * The server refuses either way — this only decides whether the reader finds
   * out before or after they try. A disabled button with a reason beside it is
   * the difference between "paused until 14:00" and "the button is broken".
   *
   * Keyed on the role: switching from a gated role to an ungated one has to
   * re-read it, or QA inherits the warning a developer was shown. That is not
   * hypothetical — it is what this did before the role was a dependency.
   */
  useEffect(() => {
    api
      .gate()
      .then((g) =>
        setGate(
          g.appliesToYou && g.state === 'closed' ? { closed: true, opensAt: g.opensAt } : null,
        ),
      )
      .catch(() => setGate(null))
  }, [role])

  // Branches of the SUITE, not of the product under test — `main` is the
  // reviewed suite, `develop` is the one QA is still writing. Labelled
  // "Suite branch" for that reason: "Branch" alone reads as the caller's own
  // branch, which this has never been.
  //
  // `*` means any branch; offer the common ones rather than a free-text field
  // nobody wants to type into.
  const refs = policy.allowedRefs.includes('*')
    ? ['main', 'develop', 'release', 'feature/example']
    : policy.allowedRefs

  async function start() {
    setBusy(true)
    setError(null)
    try {
      await api.createRun({ service, tags, ref, workers })
      onStarted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={s.card}>
      <header style={s.head}>
        <h2 style={s.title}>New run</h2>
        <span style={s.hint}>Runs against the bundled suite</span>
      </header>

      <div style={s.grid}>
        <Field label="Service">
          <select style={s.control} value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICES.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field label="Scope">
          <select style={s.control} value={tags} onChange={(e) => setTags(e.target.value)}>
            {TAGS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field label="Suite branch">
          <select style={s.control} value={ref} onChange={(e) => setRef(e.target.value)}>
            {refs.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field label={`Workers · max ${policy.maxWorkers}`}>
          <input
            type="number"
            min={1}
            max={policy.maxWorkers}
            value={workers}
            onChange={(e) => setWorkers(Number(e.target.value))}
            style={s.control}
          />
        </Field>

        <button
          onClick={() => void start()}
          disabled={busy || gate !== null}
          style={{ ...s.run, ...(gate ? s.runDisabled : null) }}
        >
          {busy ? 'Starting…' : 'Run'}
        </button>
      </div>

      {gate && (
        <p style={s.paused}>
          Runs are paused for your role
          {gate.opensAt ? ` until ${new Date(gate.opensAt).toLocaleString()}` : ''}. QA and admin
          are unaffected.
        </p>
      )}

      {error && <p style={s.error}>{error}</p>}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  card: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 18,
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  title: { fontSize: 15, fontWeight: 650, margin: 0 },
  hint: { fontSize: 12, color: c.t5 },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))',
    gap: 12,
    alignItems: 'end',
  },
  label: {
    display: 'block',
    fontSize: 11.5,
    color: c.t4,
    marginBottom: 6,
    letterSpacing: '0.01em',
  },
  control: {
    width: '100%',
    padding: '9px 11px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t1,
    font: 'inherit',
    fontSize: 14,
    outline: 'none',
  },
  run: {
    padding: '9px 22px',
    background: c.primary,
    border: 'none',
    borderRadius: 9,
    color: '#fff',
    font: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
    height: 38,
  },
  error: { color: '#dc2626', fontSize: 13, margin: '14px 0 0' },
  runDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  paused: {
    margin: '14px 0 0',
    padding: '10px 12px',
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${status.pending}`,
    borderRadius: 8,
    color: c.t3,
    fontSize: 13,
  },
}
