import type { CSSProperties } from 'react'
import { STATUS_LOOK, type StatusIconName } from '../run-status'
import type { RunStatus } from '../api'

/**
 * Lucide's icons, drawn inline: the paths are copied rather than imported so
 * the bundle carries six shapes instead of a library. Lucide is ISC-licensed.
 */
export const ICON_PATHS: Record<StatusIconName, string> = {
  pass: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  fail: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  alert:
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  timer:
    '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  running: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
}

/**
 * A run's status as a shape and a word, not a colour: the word is what a
 * screen reader gets and what the tooltip says.
 *
 * Only a running run moves. `prefers-reduced-motion` stops the spin (see
 * index.html), and the shape — an open arc — still tells it from a queued one.
 */
export function StatusIcon({ status, size = 22 }: { status: RunStatus; size?: number }) {
  const look = STATUS_LOOK[status]
  const style: CSSProperties = {
    color: look.color,
    flexShrink: 0,
    ...(status === 'running' ? { animation: 'spin 1.1s linear infinite' } : null),
  }

  return (
    <svg
      role="img"
      aria-label={look.label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      dangerouslySetInnerHTML={{ __html: `<title>${look.label}</title>${ICON_PATHS[look.icon]}` }}
    />
  )
}
