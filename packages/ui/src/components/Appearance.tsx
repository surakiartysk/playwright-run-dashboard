import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ACCENT_OPTIONS, MODE_HINT, MODE_OPTIONS, stepOption, triggerLabel } from '../appearance'
import { accentTokens, type Accent } from '../tokens'
import {
  c,
  currentAccent,
  currentMode,
  currentTheme,
  setAccent,
  setMode,
  type ThemeMode,
} from '../theme'

/**
 * Light or dark, and one accent colour.
 *
 * A button that opens a small panel, rather than a toggle: there are two
 * independent choices now — the mode and the accent — and the old sun/moon
 * button could only ever offer the first. Both rows are radio groups: one stop
 * for Tab, arrow keys move within, and what is chosen is also written in words
 * on the button for a screen reader.
 *
 * It holds its own state, read from the page on mount. The choice itself lives
 * in two attributes on `<html>` (see theme.ts), which is what the stylesheet
 * reads, so nothing above this component has to re-render when it changes.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const Palette = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="13.5" cy="6.5" r=".6" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".6" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".6" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".6" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </svg>
)

const MODE_ICON: Record<ThemeMode, JSX.Element> = {
  light: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  dark: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  ),
  system: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
}

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.6}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

/** One row of mutually exclusive choices, with the arrow-key behaviour of a radio group. */
function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
  style,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  render: (id: T, checked: boolean) => JSX.Element
  style: CSSProperties | undefined
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>())

  function onKeyDown(e: KeyboardEvent) {
    const next = stepOption(options, value, e.key)
    if (next === value) return
    e.preventDefault()
    onChange(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label} style={style} onKeyDown={onKeyDown}>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={id === value}
          tabIndex={id === value ? 0 : -1}
          ref={(el) => {
            if (el) refs.current.set(id, el)
            else refs.current.delete(id)
          }}
          onClick={() => onChange(id)}
          style={s.choice}
        >
          {render(id, id === value)}
        </button>
      ))}
    </div>
  )
}

export function Appearance() {
  const [open, setOpen] = useState(false)
  const [mode, setModeState] = useState<ThemeMode>(currentMode)
  const [accent, setAccentState] = useState<Accent>(currentAccent)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  // Closing: Escape returns focus to the button that opened the panel; a press
  // outside closes it without stealing focus from whatever was pressed.
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    const onPress = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    box.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  const shown = currentTheme()

  return (
    <div ref={box} style={s.wrap}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={triggerLabel(mode, accent)}
        title="Appearance"
        style={s.trigger}
      >
        <Palette />
      </button>

      {open && (
        <div role="group" aria-label="Appearance" style={s.panel}>
          <div style={s.section}>
            <span style={s.label}>Mode</span>
            <Choices
              label="Mode"
              options={MODE_OPTIONS.map((m) => m.id)}
              value={mode}
              onChange={(next) => {
                setMode(next)
                setModeState(next)
              }}
              style={s.modes}
              render={(id, checked) => (
                <span
                  style={{ ...s.mode, ...(checked ? s.modeOn : null) }}
                  title={MODE_OPTIONS.find((m) => m.id === id)?.description}
                >
                  {MODE_ICON[id]}
                  {MODE_OPTIONS.find((m) => m.id === id)?.label}
                </span>
              )}
            />
            <span style={s.hint}>{MODE_HINT}</span>
          </div>

          <div style={s.section}>
            <span style={s.label}>Accent</span>
            <Choices
              label="Accent"
              options={ACCENT_OPTIONS.map((a) => a.id)}
              value={accent}
              onChange={(next) => {
                setAccent(next)
                setAccentState(next)
              }}
              style={s.swatches}
              render={(id, checked) => {
                const t = accentTokens(id, shown)
                const name = ACCENT_OPTIONS.find((a) => a.id === id)?.label ?? id
                return (
                  <span style={s.swatchCell}>
                    <span
                      style={{
                        ...s.swatch,
                        background: t.primary,
                        color: t['on-primary'],
                        outline: checked ? `2px solid ${c.t1}` : '2px solid transparent',
                      }}
                    >
                      {checked && <Check />}
                    </span>
                    <span style={s.swatchName}>{name}</span>
                  </span>
                )
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  wrap: { position: 'relative' },
  // The button is the focus target and the hit area; what it looks like is
  // drawn inside it, so its own chrome is switched off.
  choice: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    display: 'block',
  },
  trigger: {
    padding: '7px 10px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t4,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
  },
  panel: {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 8px)',
    zIndex: 20,
    width: 280,
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
    transformOrigin: 'top right',
    // Defined in index.html, which also stills it for anyone who asked for
    // less motion.
    animation: 'pop-in var(--motion-fast) var(--ease)',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 13, fontWeight: 700, color: c.t4 },
  hint: { fontSize: 12, color: c.t4, lineHeight: 1.4 },
  modes: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
  mode: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    borderRadius: 9,
    border: `1px solid ${c.border}`,
    color: c.t3,
    fontSize: 13,
    fontWeight: 700,
  },
  modeOn: {
    borderColor: c.primary,
    background: c.primaryLight,
    color: c.primary,
  },
  swatches: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  swatchCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 52 },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    outlineOffset: 2,
  },
  swatchName: { fontSize: 12, color: c.t4, fontWeight: 600 },
}
