import { useState, type CSSProperties } from 'react'
import { SUITES, SUITE_LABELS, type Role, type RunOptions } from '../api'
import {
  SINCE_OPTIONS,
  activeCount,
  canFilterByStarter,
  chips,
  facets,
  narrow,
  type HistoryFilters,
} from '../run-query'
import { c } from '../theme'
import { Icon } from './Icon'

/**
 * Narrowing the history by what a run was, behind one button.
 *
 * The status buttons answer "what happened"; these answer "which runs". They
 * are offered what the caller could have started — the same lists as the run
 * form, from `GET /runs/options` — so a developer is not offered branches they
 * cannot run and a demo visitor is not offered other people to filter by.
 *
 * Chips for what is active stay on screen with the panel shut, each removable:
 * a list narrowed without saying so reads as a quiet dashboard.
 */
export function AdvancedFilters({
  options,
  filters,
  viewing,
  onChange,
}: {
  options: RunOptions
  filters: HistoryFilters
  /** The role whose view is shown — decides whether "started by" is worth offering. */
  viewing: Role
  onChange: (next: HistoryFilters) => void
}) {
  const [open, setOpen] = useState(false)
  const active = activeCount(filters)
  const choices = facets(options, filters)
  const set = (change: Partial<Record<keyof HistoryFilters, string | undefined>>) =>
    onChange(narrow(filters, change, options))

  return (
    <div style={s.wrap}>
      <div style={s.bar}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ ...s.toggle, ...(active > 0 ? s.toggleActive : null) }}
        >
          <Icon name="down" size={14} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
          Filters{active > 0 ? ` · ${active}` : ''}
        </button>

        {chips(filters).map((chip) => (
          <span key={chip.key} style={s.chip}>
            {chip.label}
            <button
              type="button"
              aria-label={`Remove filter: ${chip.label}`}
              onClick={() => set({ [chip.key]: undefined })}
              style={s.remove}
            >
              ×
            </button>
          </span>
        ))}

        {active > 0 && (
          <button type="button" onClick={() => onChange({})} style={s.clear}>
            Clear filters
          </button>
        )}
      </div>

      {open && (
        <div style={s.panel}>
          <Field label="Suite">
            <Select
              value={filters.suite}
              any="Both suites"
              choices={SUITES.map((value) => ({ value, label: SUITE_LABELS[value] }))}
              onChange={(suite) => set({ suite })}
            />
          </Field>
          <Field label={filters.suite === 'ui' ? 'Journey' : 'Service'}>
            <Select
              value={filters.service}
              any="Any"
              choices={choices.services}
              onChange={(service) => set({ service })}
            />
          </Field>
          <Field label="Tag">
            <Select
              value={filters.tag}
              any="Any"
              choices={choices.tags}
              onChange={(tag) => set({ tag })}
            />
          </Field>
          <Field label="Suite branch">
            <Select
              value={filters.ref}
              any="Any"
              choices={choices.refs}
              onChange={(ref) => set({ ref })}
            />
          </Field>
          <Field label="When">
            <Select
              value={filters.since}
              any="Any time"
              choices={SINCE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
              onChange={(since) => set({ since })}
            />
          </Field>
          {canFilterByStarter(viewing) && (
            <Field label="Started by">
              <Select
                value={filters.triggeredBy}
                any="Anyone"
                choices={(['demo', 'dev', 'qa', 'admin'] as const).map((r) => ({
                  value: r,
                  label: r,
                }))}
                onChange={(triggeredBy) => set({ triggeredBy })}
              />
            </Field>
          )}
          <Field label="Real or simulated">
            <Select
              value={filters.simulated}
              any="Both"
              choices={[
                { value: 'real', label: 'Real runs' },
                { value: 'simulated', label: 'Simulated' },
              ]}
              onChange={(simulated) => set({ simulated })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={s.field}>
      <span style={s.label}>{label}</span>
      {children}
    </label>
  )
}

function Select({
  value,
  any,
  choices,
  onChange,
}: {
  value: string | undefined
  any: string
  choices: { value: string; label: string }[]
  onChange: (next: string | undefined) => void
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={s.select}
    >
      <option value="">{any}</option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: { marginBottom: 12 },
  bar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 12px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t3,
    font: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  toggleActive: { color: c.t1, borderColor: c.t4 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 28,
    padding: '0 4px 0 10px',
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 999,
    fontSize: 12.5,
    color: c.t2,
  },
  remove: {
    width: 22,
    height: 22,
    border: 'none',
    background: 'transparent',
    borderRadius: 999,
    color: c.t4,
    fontSize: 15,
    lineHeight: 1,
    cursor: 'pointer',
  },
  clear: {
    background: 'none',
    border: 'none',
    padding: '0 4px',
    color: c.primary,
    font: 'inherit',
    fontSize: 12.5,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  panel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
    gap: 12,
    marginTop: 10,
    padding: 14,
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 11.5, color: c.t4 },
  select: {
    height: 38,
    padding: '0 10px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t1,
    font: 'inherit',
    fontSize: 13.5,
  },
}
