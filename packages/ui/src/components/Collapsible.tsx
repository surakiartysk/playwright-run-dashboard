import { useState, type CSSProperties, type ReactNode } from 'react'
import { c } from '../theme'
import { Icon } from './Icon'

/**
 * A card that is one line until asked.
 *
 * For the stacked layout, where the side column's panels sit above the form
 * and on a phone pushed it two screens down. Collapsed they cost one row each
 * and say what is inside (`hint`), so closing them hides detail, not the fact
 * that it exists.
 *
 * A native `<details>`, so it opens from the keyboard and is announced as
 * expandable with no ARIA written here; the state is mirrored only to turn the
 * chevron, which CSS cannot do from inline styles.
 */
export function Collapsible({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={s.box}
      data-collapsible=""
    >
      <summary style={{ ...s.summary, ...(open ? s.summaryOpen : null) }}>
        <span style={s.title}>{title}</span>
        <span style={s.hint}>{hint}</span>
        <Icon
          name="down"
          size={16}
          style={{ ...s.chevron, transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </summary>
      {open && children}
    </details>
  )
}

const s: Record<string, CSSProperties> = {
  box: { marginBottom: 18 },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    padding: '10px 16px',
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    cursor: 'pointer',
    listStyle: 'none',
  },
  // Joined to the panel it opens rather than floating above it.
  summaryOpen: { marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 600, color: c.t1, whiteSpace: 'nowrap' },
  hint: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: c.t5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chevron: { color: c.t5, transition: 'transform var(--motion-fast) var(--ease)' },
}
