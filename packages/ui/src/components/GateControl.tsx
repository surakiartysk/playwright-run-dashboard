import { useEffect, useState, type CSSProperties } from 'react'
import { api, type GateMode, type GateStatus } from '../api'
import { modeFromStatus, toLocalInput } from '../gate-form'
import { c, status } from '../theme'

/**
 * The admin's control over the run gate.
 *
 * `PUT /gate` existed from the start and nothing in the UI could reach it, so
 * the one operational lever an admin has — pausing developer runs during a
 * release — was reachable only with curl. Everything else admin can do is a
 * wider version of what QA can do; this is the only thing that is theirs alone,
 * and it was the piece that was missing.
 *
 * Rendered only for a real admin session. That is presentation, not
 * enforcement: `requireRole('admin')` on the route is the control, and this
 * component would be refused by the server if it were somehow shown to anyone
 * else. Hiding it is about not offering a button that cannot work.
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

export function GateControl({ onChanged }: { onChanged: () => void }) {
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
      // The trigger form reads the gate on mount, so a change here has to push
      // the rest of the page to re-read rather than waiting for a reload.
      onChanged()
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
        <span style={s.hint}>Admin only · affects developers</span>
      </header>

      <div style={s.modes}>
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              setMode(m.value)
              setSaved(false)
            }}
            style={{ ...s.mode, ...(mode === m.value ? s.modeOn : null) }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p style={s.modeHint}>{MODES.find((m) => m.value === mode)?.hint}</p>

      {mode === 'window' && (
        <div style={s.window}>
          <div>
            <label style={s.label}>Opens</label>
            <input
              type="datetime-local"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              style={s.control}
            />
          </div>
          <div>
            <label style={s.label}>Closes</label>
            <input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              style={s.control}
            />
          </div>
        </div>
      )}

      <div style={s.actions}>
        <button onClick={() => void apply()} disabled={busy} style={s.apply}>
          {busy ? 'Saving…' : 'Apply'}
        </button>
        {saved && !error && <span style={s.saved}>Saved</span>}
      </div>

      {error && <p style={s.error}>{error}</p>}

      <p style={s.note}>
        QA and admin are never gated — a release freeze is when release verification happens.
      </p>
    </section>
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
  pillOpen: { background: status.passBg, color: status.pass },
  pillClosed: { background: status.pendingBg, color: status.pending },

  modes: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  mode: {
    padding: '8px 16px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t3,
    font: 'inherit',
    fontSize: 13.5,
    cursor: 'pointer',
  },
  modeOn: {
    background: c.primary,
    borderColor: c.primary,
    color: '#fff',
    fontWeight: 600,
  },
  modeHint: { margin: '10px 0 0', fontSize: 13, color: c.t4 },

  window: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
    gap: 12,
    marginTop: 14,
  },
  label: { display: 'block', fontSize: 11.5, color: c.t4, marginBottom: 6 },
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

  actions: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 },
  apply: {
    padding: '9px 22px',
    background: c.primary,
    border: 'none',
    borderRadius: 9,
    color: '#fff',
    font: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
  },
  saved: { fontSize: 13, color: status.pass },
  error: { color: '#dc2626', fontSize: 13, margin: '12px 0 0' },
  note: {
    margin: '14px 0 0',
    paddingTop: 12,
    borderTop: `1px solid ${c.divider}`,
    fontSize: 12.5,
    color: c.t5,
  },
}
