import { useState, type CSSProperties } from 'react'
import { ApiKeys } from './ApiKeys'
import { GateControl } from './GateControl'
import { c } from '../theme'

/**
 * Everything only an admin may do, in one place.
 *
 * These controls used to be scattered: the gate sat loose between the trend and
 * the run form, mixed in with what every role sees, and key management existed
 * only as three API routes with no UI at all. Two problems in one — an admin
 * could not tell which controls were theirs, and half of them were unreachable.
 *
 * Collapsed by default. An admin opens this dashboard for the same reason
 * everyone else does — to see whether the last run passed — and the operational
 * levers are the exception, not the daily path. Open, it is unmistakably a
 * different kind of surface: an outlined region rather than another card in the
 * flow, so nobody mistakes a control that changes things for everyone for one
 * that changes their own view.
 *
 * `readOnly` is the same panel for a demo session previewing admin — see
 * admin-panel.ts for who gets which. The gate shows its live state with
 * nothing to press; the keys tab explains keys instead of listing them,
 * because `GET /keys` is admin only and should stay that way: labels and
 * scopes are a map of every pipeline's credentials.
 */

type Tab = 'gate' | 'keys'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'gate', label: 'Run gate', hint: 'Pause developer runs during a release' },
  { id: 'keys', label: 'API keys', hint: 'Credentials for pipelines' },
]

export function AdminPanel({
  onGateChanged,
  readOnly = false,
}: {
  onGateChanged: () => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('gate')

  return (
    <section style={{ ...s.panel, ...(open ? s.panelOpen : null) }}>
      <button onClick={() => setOpen((v) => !v)} style={s.header} aria-expanded={open}>
        <span style={s.headerLeft}>
          <span style={s.badge}>admin</span>
          <span style={s.headerTitle}>Controls</span>
          <span style={s.headerHint}>
            {readOnly ? 'Run gate and API keys · read-only preview' : 'Run gate and API keys'}
          </span>
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
            {tab === 'gate' ? (
              <GateControl onChanged={onGateChanged} readOnly={readOnly} />
            ) : readOnly ? (
              <KeysPreview />
            ) : (
              <ApiKeys />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** What the keys tab holds, for a session that may not see the keys themselves. */
function KeysPreview() {
  return (
    <section style={s.preview}>
      <h2 style={s.previewTitle}>API keys</h2>
      <p style={s.previewText}>
        Pipelines start runs with a key instead of a password. An admin issues each one and decides
        what it may do: a role, the branches it may run, and a worker cap. The key is shown once,
        only a digest is stored, and it can be revoked at any time.
      </p>
      <p style={s.previewText}>
        A key may not issue a key, even an admin-level one, so a leaked pipeline credential cannot
        mint its own replacement.
      </p>
      <p style={s.previewNote}>
        The list itself is not shown in a preview: it names every pipeline&rsquo;s credentials.
      </p>
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

  preview: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: 20,
  },
  previewTitle: { fontSize: 15, fontWeight: 650, margin: '0 0 10px' },
  previewText: {
    margin: '0 0 10px',
    fontSize: 13.5,
    color: c.t2,
    lineHeight: 1.55,
    maxWidth: '68ch',
  },
  previewNote: {
    margin: '14px 0 0',
    paddingTop: 12,
    borderTop: `1px solid ${c.divider}`,
    fontSize: 12.5,
    color: c.t4,
  },
}
