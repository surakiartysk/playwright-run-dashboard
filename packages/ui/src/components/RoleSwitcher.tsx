import type { CSSProperties } from 'react'
import type { Role, RolePolicy } from '../api'
import { c } from '../theme'
import { Collapsible } from './Collapsible'

/**
 * Previews another role's read view without signing out — for a genuinely
 * authenticated `demo` session only.
 *
 * The point of the dashboard is that a `dev` and a `qa` see different things,
 * and that is invisible if seeing it costs three sign-ins. The active role's
 * limits are spelled out beside the buttons rather than left to be inferred
 * from which controls are disabled.
 *
 * This changes only what GET /runs and GET /runs/:id return — it never mints
 * a session token for the previewed role, and every write path (starting a
 * run, deleting one) still enforces the real, signed-in role regardless of
 * what is being previewed. See routes/demo.ts and decision 12.
 */
/** One line of what a role may see and do, as a label and a value. */
export interface PolicyLine {
  label: string
  value: string
}

/**
 * What a role can do, as four lines a reader takes in at a glance.
 *
 * It was a four-column grid of labelled cells, which spent a card's width on
 * four short facts and read as a form. Lines read as a sentence about the role
 * — it sees this, uses these branches, up to this many workers, may or may not
 * delete — and sit in the same order for every role, so switching changes the
 * values and nothing else moves.
 */
export function policyLines(policy: RolePolicy): PolicyLine[] {
  return [
    { label: 'Sees', value: policy.sees },
    {
      label: 'Suite branches',
      value: policy.allowedRefs.includes('*') ? 'any' : policy.allowedRefs.join(', '),
    },
    { label: 'Workers', value: `up to ${policy.maxWorkers}` },
    { label: 'Delete runs', value: policy.canDelete ? 'yes' : 'no' },
  ]
}

/**
 * What the panel says about the difference between looking and doing.
 *
 * When the role being viewed is not the one signed in, the buttons shown
 * (Delete, for a viewer of admin) are the viewed role's, and the server will
 * refuse them: authorisation is the real role's. Saying so next to the buttons
 * that cause it, naming both roles, is what keeps a refused Delete from
 * reading as a broken one.
 */
export function previewNote(viewing: Role, real: Role): string {
  return viewing === real
    ? 'This changes what you see, not what you may do.'
    : `You are signed in as ${real}. Viewing as ${viewing} changes what you see; starting or deleting a run still uses ${real}.`
}

export function RoleSwitcher({
  role,
  realRole,
  policies,
  onSwitched,
  collapsible = false,
}: {
  /** The role being viewed. */
  role: Role
  /** The role actually signed in, which is what writes are checked against. */
  realRole: Role
  policies: RolePolicy[]
  onSwitched: (role: Role) => void | Promise<void>
  /** Folded to one line until opened, for the stacked layout. */
  collapsible?: boolean
}) {
  const current = policies.find((p) => p.role === role)

  async function pick(next: Role) {
    if (next === role) return
    await onSwitched(next)
  }

  const panel = (
    <div style={s.wrap}>
      <div style={s.head}>
        <span style={s.label}>Viewing as</span>
        <div style={s.tabs}>
          {policies.map((policy) => {
            const active = policy.role === role
            return (
              <button
                key={policy.role}
                onClick={() => void pick(policy.role)}
                style={{
                  ...s.tab,
                  ...(active ? s.tabActive : null),
                }}
              >
                {policy.role}
              </button>
            )
          })}
        </div>
      </div>

      {current && (
        <dl style={s.lines}>
          {policyLines(current).map((line) => (
            <div key={line.label} style={s.line}>
              <dt style={s.lineLabel}>{line.label}</dt>
              <dd style={s.lineValue}>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p style={s.note}>{previewNote(role, realRole)}</p>
    </div>
  )

  return collapsible ? (
    <Collapsible
      title="View as another role"
      hint={role === realRole ? `Now: ${role}` : `Now: ${role} · you are ${realRole}`}
    >
      {panel}
    </Collapsible>
  ) : (
    panel
  )
}

const s: Record<string, CSSProperties> = {
  wrap: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.primary}`,
    borderRadius: 12,
    padding: '14px 16px',
    marginBottom: 18,
  },
  head: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  label: { fontSize: 13, color: c.t4, fontWeight: 500 },
  tabs: {
    display: 'inline-flex',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  tab: {
    padding: '5px 14px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: c.t4,
    font: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  tabActive: { background: c.primary, color: c.onPrimary, fontWeight: 600 },

  lines: {
    margin: '12px 0 0',
    padding: '10px 0 0',
    borderTop: `1px solid ${c.border}`,
    display: 'grid',
    gap: 4,
  },
  line: { display: 'flex', gap: 12, fontSize: 13, lineHeight: 1.4 },
  lineLabel: { flex: '0 0 6.25rem', color: c.t5 },
  lineValue: { margin: 0, color: c.t1, minWidth: 0 },

  note: { margin: '10px 0 0', fontSize: 12, color: c.t5, lineHeight: 1.5 },
}
