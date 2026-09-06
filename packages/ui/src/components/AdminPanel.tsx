import { useState, type CSSProperties } from 'react'
import { ApiKeys } from './ApiKeys'
import { GateControl } from './GateControl'
import { c } from '../theme'

/**
 * Everything only an admin may do, in one place.
 *
 * These controls used to be scattered: the gate sat loose between the trend and
 * the run form, mixed in with what every role sees, and key management existed
 * only as two API routes with no UI at all. Two problems in one — an admin
 * could not tell which controls were theirs, and half of them were unreachable.
 *
 * Collapsed by default. An admin opens this dashboard for the same reason
 * everyone else does — to see whether the last run passed — and the operational
 * levers are the exception, not the daily path. Open, it is unmistakably a
 * different kind of surface: an outlined region rather than another card in the
 * flow, so nobody mistakes a control that changes things for everyone for one
 * that changes their own view.
 */

type Tab = 'gate' | 'keys'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'gate', label: 'Run gate', hint: 'Pause developer runs during a release' },
  { id: 'keys', label: 'API keys', hint: 'Credentials for pipelines' },
]

export function AdminPanel({ onGateChanged }: { onGateChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('gate')

  return (
    <section style={{ ...s.panel, ...(open ? s.panelOpen : null) }}>
      <button onClick={() => setOpen((v) => !v)} style={s.header} aria-expanded={open}>
        <span style={s.headerLeft}>
          <span style={s.badge}>admin</span>
          <span style={s.headerTitle}>Controls</span>
          <span style={s.headerHint}>Run gate and API keys</span>
        </span>
        <span aria-hidden style={{ ...s.caret, transform: open ? 'rotate(90deg)' : 'none' }}>
          ›
        </span>
      </button>

      {open && (
        <div style={s.body}>
          <div style={s.tabs} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                style={{ ...s.tab, ...(tab === t.id ? s.tabActive : null) }}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={s.tabBody}>
            {tab === 'gate' ? <GateControl onChanged={onGateChanged} /> : <ApiKeys />}
          </div>
        </div>
      )}
    </section>
  )
}

const s: Record<string, CSSProperties> = {
  panel: {
    // Longhand rather than the `border` shorthand: `panelOpen` overrides the
    // colour alone, and React warns (correctly) that mixing the two across a
    // re-render is how styles end up half-applied.
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: c.border,
    borderRadius: 12,
    marginBottom: 20,
    background: c.card,
  },
  panelOpen: { borderColor: c.primaryBorder },
  header: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 16px',
    background: 'transparent',
    border: 'none',
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  },
  headerLeft: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 },
  badge: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: c.primary,
    background: c.primaryLight,
    border: `1px solid ${c.primaryBorder}`,
    borderRadius: 5,
    padding: '2px 7px',
  },
  headerTitle: { fontSize: 14, fontWeight: 600, color: c.t1 },
  headerHint: { fontSize: 12.5, color: c.t5 },
  caret: {
    color: c.t5,
    fontSize: 17,
    transition: 'transform 0.15s ease',
    flexShrink: 0,
  },

  body: { borderTop: `1px solid ${c.border}`, padding: 16 },
  tabs: { display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' },
  // Same reason as `panel`: `tabActive` changes borderColor and fontWeight, so
  // neither may be set here through the `border` or `font` shorthand.
  tab: {
    padding: '6px 13px',
    background: 'transparent',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: c.border,
    borderRadius: 999,
    color: c.t4,
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 400,
    cursor: 'pointer',
  },
  tabActive: {
    background: c.primaryLight,
    borderColor: c.primaryBorder,
    color: c.primary,
    fontWeight: 600,
  },
  tabBody: { minWidth: 0 },
}
