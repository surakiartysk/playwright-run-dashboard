import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ACCENT_OPTIONS, MODE_HINT, MODE_OPTIONS, triggerLabel } from '../appearance'
import { accentTokens, type Accent } from '../tokens'
import { Segmented } from './Segmented'
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
            <Segmented
              label="Mode"
              fill
              options={MODE_OPTIONS.map((m) => ({
                value: m.id,
                title: m.description,
                label: (
                  <>
                    {MODE_ICON[m.id]}
                    {m.label}
                  </>
                ),
              }))}
              value={mode}
              onChange={(next) => {
                setMode(next)
                setModeState(next)
              }}
            />
            <span style={s.hint}>{MODE_HINT}</span>
          </div>

          <div style={s.section}>
            <span style={s.label}>Accent</span>
            <Segmented
              label="Accent"
              look="bare"
              options={ACCENT_OPTIONS.map((a) => {
                const t = accentTokens(a.id, shown)
                const checked = a.id === accent
                return {
                  value: a.id,
                  label: (
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
                      <span style={s.swatchName}>{a.label}</span>
                    </span>
                  ),
                }
              })}
              value={accent}
              onChange={(next) => {
                setAccent(next)
                setAccentState(next)
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
