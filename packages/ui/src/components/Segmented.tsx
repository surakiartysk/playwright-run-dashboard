import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { stepOption } from '../appearance'
import { c } from '../theme'

/**
 * One way to choose one of a few things, used everywhere the page does.
 *
 * There were six: the suite (a radio group with arrow keys), the appearance's
 * mode and accent (the same, written again), the status filter and the gate's
 * mode (buttons with `aria-pressed`, each its own Tab stop, no arrow keys), the
 * role preview (buttons that did not say which was chosen at all) and the admin
 * panel's tabs (tabs with no arrow keys). Each looked different too: a track, a
 * row of filled buttons, a row of outlined pills.
 *
 * Now every one is a group that is a single Tab stop, whose arrow keys, Home
 * and End move the choice (skipping what is disabled), and which says what is
 * chosen: `radio` and `aria-checked`, or for the admin panel, which switches what
 * is shown below it, `tab` and `aria-selected`. They share a track and a chosen
 * state; `bare` leaves the drawing to the caller, for the accent swatches.
 */

const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/**
 * Where a key moves the choice among the options that may be chosen, or null
 * when it does not move it: another key, nothing enabled, or a move that lands
 * where it is. From the chosen option when it is enabled, else from the first.
 */
export function nextChoice<T>(enabled: readonly T[], value: T, key: string): T | null {
  if (!MOVES.has(key) || enabled.length === 0) return null
  const from = enabled.includes(value) ? value : (enabled[0] as T)
  const next = stepOption(enabled, from, key)
  return next === value ? null : next
}

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  title?: string
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  kind = 'radio',
  panelId,
  look = 'track',
  size = 'md',
  fill = false,
  disabled = false,
  busy = false,
  style,
}: {
  /** What the group is called, for a screen reader. */
  label: string
  options: readonly Segment<T>[]
  value: T
  onChange: (next: T) => void
  /** `tab` where choosing changes what is shown below, with `panelId` naming it. */
  kind?: 'radio' | 'tab'
  panelId?: (value: T) => string
  look?: 'track' | 'bare'
  /** `lg` is a 44px control, beside the run form's other controls. */
  size?: 'md' | 'lg'
  /** Take the row's width, the options sharing it. */
  fill?: boolean
  disabled?: boolean
  /** Waiting for a choice to land; nothing can be chosen meanwhile, and the focus stays put. */
  busy?: boolean
  /** Added to the group: its layout in the caller, never its look. */
  style?: CSSProperties
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const enabled = options.filter((o) => !o.disabled && !disabled && !busy).map((o) => o.value)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = nextChoice(enabled, value, e.key)
    if (next === null) return
    e.preventDefault()
    onChange(next)
    refs.current.get(next)?.focus()
  }

  const tab = kind === 'tab'

  return (
    <div
      role={tab ? 'tablist' : 'radiogroup'}
      aria-label={label}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      style={{
        ...(look === 'track' ? s.track : s.bare),
        ...(look === 'track' && size === 'lg' ? s.trackLg : null),
        ...(fill ? s.fill : null),
        ...style,
      }}
    >
      {options.map((option) => {
        const on = option.value === value
        const off = disabled || !!option.disabled
        return (
          <button
            key={option.value}
            type="button"
            role={tab ? 'tab' : 'radio'}
            {...(tab
              ? { 'aria-selected': on, 'aria-controls': panelId?.(option.value) }
              : { 'aria-checked': on })}
            tabIndex={on ? 0 : -1}
            disabled={off}
            // Busy is not `disabled`: disabling the focused option drops the
            // focus to the page, and a keyboard reader would lose their place.
            aria-disabled={busy && !off ? true : undefined}
            title={option.title}
            ref={(el) => {
              if (el) refs.current.set(option.value, el)
              else refs.current.delete(option.value)
            }}
            onClick={() => {
              if (!on && !busy) onChange(option.value)
            }}
            style={
              look === 'bare'
                ? s.bareOption
                : {
                    ...s.option,
                    ...(size === 'lg' ? s.optionLg : null),
                    ...(fill ? s.optionFill : null),
                    ...(on ? s.optionOn : null),
                    // Faint for an option with nothing behind it; a whole group that
                    // is read-only stays legible, since it is there to be read.
                    ...((option.disabled || busy) && !on ? s.optionOff : null),
                    ...(disabled ? s.optionLocked : null),
                  }
            }
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  track: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 3,
    padding: 3,
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 9,
  },
  trackLg: { height: 44, borderRadius: 10 },
  bare: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  fill: { display: 'flex', width: '100%' },
  option: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '5px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: c.t4,
    font: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  optionLg: { gap: 7, padding: '0 12px', borderRadius: 7, fontSize: 14, fontWeight: 600 },
  optionFill: { flex: 1 },
  optionOn: {
    background: c.card,
    color: c.t1,
    fontWeight: 600,
    boxShadow: `0 0 0 1px ${c.border}`,
  },
  optionOff: { cursor: 'default', color: c.t6 },
  optionLocked: { cursor: 'default' },
  bareOption: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    display: 'block',
  },
}
