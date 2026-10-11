import { useEffect, useState, type CSSProperties } from 'react'
import { api, type GateMode, type GateStatus } from '../api'
import { modeFromStatus, toLocalInput } from '../gate-form'
import { c, status } from '../theme'
import { Segmented } from './Segmented'

/**
 * The admin's control over the run gate.
 *
 * `PUT /gate` existed from the start and nothing in the UI could reach it, so
 * the one operational lever an admin has — pausing developer runs during a
 * release — was reachable only with curl. Everything else admin can do is a
 * wider version of what QA can do; this is the only thing that is theirs alone,
 * and it was the piece that was missing.
 *
 * Writable only for a real admin session. That is presentation, not
 * enforcement: `requireRole('admin')` on the route is the control, and a write
 * from anyone else is refused by the server. A demo session previewing admin
 * gets `readOnly` — the live gate, with nothing it can press — so the feature
 * is visible without offering a button that cannot work (admin-panel.ts).
 *
 * The gate deliberately affects `dev` only — QA and admin run during a freeze,
 * because a freeze is when release verification happens. The copy says so
 * rather than leaving an admin to discover it by pausing runs and finding QA
 * unaffected.
 */

const MODES: { value: GateMode; label: string; hint: string }[] = [
  { value: 'open', label: 'Open', hint: 'Anyone may start a run.' },
  { value: 'closed', label: 'Paused', hint: 'Developers are blocked until this is reopened.' },
  { value: 'window', label: 'Scheduled', hint: 'Developers may run only inside the window.' },
]

export function GateControl({ readOnly = false }: { readOnly?: boolean }) {
  const [gate, setGate] = useState<GateStatus | null>(null)
  const [mode, setMode] = useState<GateMode>('open')
  const [opensAt, setOpensAt] = useState(() => toLocalInput(null))
  const [closesAt, setClosesAt] = useState(() => toLocalInput(null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .gate()
      .then((g) => {
        setGate(g)
        setMode(modeFromStatus(g))
        if (g.opensAt) setOpensAt(toLocalInput(g.opensAt))
        if (g.closesAt) setClosesAt(toLocalInput(g.closesAt))
      })
      .catch(() => setGate(null))
  }, [])

  async function apply() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.setGate(
        mode === 'window'
          ? {
              mode,
              // `datetime-local` yields no zone; the API wants ISO-8601, and
              // sending it unqualified would be read as UTC.
              opensAt: new Date(opensAt).toISOString(),
              closesAt: new Date(closesAt).toISOString(),
            }
          : { mode },
      )
      setGate(next)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the gate')
    } finally {
      setBusy(false)
    }
  }

  const live = gate?.state === 'closed'

  return (
    <section style={s.card}>
      <header style={s.head}>
        <div style={s.titleRow}>
          <h2 style={s.title}>Run gate</h2>
          <span style={{ ...s.pill, ...(live ? s.pillClosed : s.pillOpen) }}>
            {live ? 'Paused' : 'Open'}
          </span>
        </div>
        <span style={s.hint}>
          {readOnly ? 'Admin only · read-only preview' : 'Admin only · affects developers'}
        </span>
      </header>

      <Segmented
        label="Run gate"
        options={MODES.map((m) => ({ value: m.value, label: m.label }))}
        value={mode}
        onChange={(next) => {
          setMode(next)
          setSaved(false)
        }}
        disabled={readOnly}
      />

      <p style={s.modeHint}>{MODES.find((m) => m.value === mode)?.hint}</p>

      {mode === 'window' && (
        <GateWindow
          opensAt={opensAt}
          closesAt={closesAt}
          onOpens={setOpensAt}
          onCloses={setClosesAt}
          readOnly={readOnly}
        />
      )}

      {readOnly ? (
        /*
          No Apply at all, rather than one that is disabled: a disabled button
          invites a second press and a wonder whether it is broken. This says
          why instead.
        */
        <p style={s.readOnly}>
          This is the live gate. Changing it takes a real admin sign-in: the demo password is
          published, so a writable gate here would let anyone pause runs for everyone.
        </p>
      ) : (
        <div style={s.actions}>
          <button onClick={() => void apply()} disabled={busy} style={s.apply}>
            {busy ? 'Saving…' : 'Apply'}
          </button>
          {saved && !error && <span style={s.saved}>Saved</span>}
        </div>
      )}

      {error && <p style={s.error}>{error}</p>}

      <p style={s.note}>
        QA and admin are never gated — a release freeze is when release verification happens.
      </p>
    </section>
  )
}

/**
 * The two times of a scheduled gate.
 *
 * Each is named by its label: they were drawn one above the other but not tied
 * together, so a screen reader announced two unnamed date fields (axe: label,
 * 2, at every width). One gate is drawn at a time, so the ids are fixed.
 */
export function GateWindow({
  opensAt,
  closesAt,
  onOpens,
  onCloses,
  readOnly,
}: {
  opensAt: string
  closesAt: string
  onOpens: (value: string) => void
  onCloses: (value: string) => void
  readOnly: boolean
}) {
  return (
    <div style={s.window}>
      <div>
        <label htmlFor="gate-opens" style={s.label}>
          Opens
        </label>
        <input
          id="gate-opens"
          type="datetime-local"
          value={opensAt}
          onChange={(e) => onOpens(e.target.value)}
          disabled={readOnly}
          style={s.control}
        />
      </div>
      <div>
        <label htmlFor="gate-closes" style={s.label}>
          Closes
        </label>
        <input
          id="gate-closes"
          type="datetime-local"
          value={closesAt}
          onChange={(e) => onCloses(e.target.value)}
          disabled={readOnly}
          style={s.control}
        />
      </div>
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
    marginBottom: 14,
    gap: 12,
    flexWrap: 'wrap',
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: 650, margin: 0 },
  hint: { fontSize: 12, color: c.t5 },

  pill: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 9px',
    borderRadius: 999,
    letterSpacing: '0.01em',
  },
  // The word carries the state; green text on its own tint measured 2.05:1, and
  // an open gate is not a test result (decision 10).
  pillOpen: { background: status.passBg, color: c.t2 },
  pillClosed: { background: status.pendingBg, color: status.pending },

  modeHint: { margin: '10px 0 0', fontSize: 13, color: c.t4 },
  readOnly: {
    margin: '16px 0 0',
    padding: '10px 12px',
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    color: c.t3,
    fontSize: 13,
    lineHeight: 1.5,
  },

  window: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
    gap: 12,
    marginTop: 14,
  },
  label: { display: 'block', fontSize: 12, color: c.t4, marginBottom: 6 },
  control: {
    width: '100%',
    padding: '9px 11px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t1,
    font: 'inherit',
    fontSize: 14,
  },

  actions: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 },
  apply: {
    padding: '9px 22px',
    background: c.primary,
    border: 'none',
    borderRadius: 9,
    color: c.onPrimary,
    font: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
  },
  saved: { fontSize: 13, color: c.t2 },
  error: { color: c.danger, fontSize: 13, margin: '12px 0 0' },
  note: {
    margin: '14px 0 0',
    paddingTop: 12,
    borderTop: `1px solid ${c.divider}`,
    fontSize: 13,
    color: c.t5,
  },
}
