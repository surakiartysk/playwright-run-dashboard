import { Icon } from './Icon'
import { STATUS_LOOK } from '../run-status'
import type { RunStatus } from '../api'

/**
 * A run's status as a shape and a word, not a colour: the word is what a
 * screen reader gets and what the tooltip says.
 *
 * Only a running run moves. `prefers-reduced-motion` stops the spin (see
 * index.html), and the shape — an open arc — still tells it from a queued one.
 */
export function StatusIcon({ status, size = 22 }: { status: RunStatus; size?: number }) {
  const look = STATUS_LOOK[status]
  return (
    <Icon
      name={look.icon}
      size={size}
      label={look.label}
      style={{
        color: look.color,
        ...(status === 'running' ? { animation: 'spin 1.1s linear infinite' } : null),
      }}
    />
  )
}
