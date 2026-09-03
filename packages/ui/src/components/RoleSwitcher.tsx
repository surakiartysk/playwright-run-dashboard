import type { CSSProperties } from 'react'
import type { Role, RolePolicy } from '../api'
import { c } from '../theme'

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
export function RoleSwitcher({
  role,
  policies,
  onSwitched,
}: {
  role: Role
  policies: RolePolicy[]
  onSwitched: (role: Role) => void | Promise<void>
}) {
  const current = policies.find((p) => p.role === role)

  async function pick(next: Role) {
    if (next === role) return
    await onSwitched(next)
  }

  return (
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
        <div style={s.facts}>
          <Fact
            label="Branches"
            value={current.allowedRefs.includes('*') ? 'any' : current.allowedRefs.join(', ')}
          />
          <Fact label="Max workers" value={String(current.maxWorkers)} />
          <Fact label="Sees" value={current.sees} />
          <Fact label="Delete runs" value={current.canDelete ? 'yes' : 'no'} />
        </div>
      )}

      <p style={s.note}>
        Previewing changes what you see, not what you may do — starting or deleting a run still uses
        your real, signed-in role, on this deployment or any other.
      </p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={s.factLabel}>{label}</div>
      <div style={s.factValue}>{value}</div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.primary}`,
    borderRadius: 12,
    padding: '16px 18px',
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
  tabActive: { background: c.primary, color: '#fff', fontWeight: 600 },

  facts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
    gap: 14,
    marginTop: 16,
    paddingTop: 14,
    borderTop: `1px solid ${c.border}`,
  },
  factLabel: {
    fontSize: 11,
    color: c.t5,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 3,
  },
  factValue: { fontSize: 13.5, color: c.t1 },

  note: { margin: '14px 0 0', fontSize: 12, color: c.t5, lineHeight: 1.6 },
}
