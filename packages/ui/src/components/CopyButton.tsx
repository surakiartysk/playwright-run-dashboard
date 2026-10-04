import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { c, mono } from '../theme'

/**
 * A small button that puts text on the clipboard and says it did.
 *
 * "Copied" is only claimed when the browser accepted the write: the clipboard
 * API is refused outside a secure context and without a user gesture, and a
 * button that said "Copied" and had copied nothing would be worse than none.
 * When it is refused the label says so rather than going quiet.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // Not left running if the row closes while it is showing "Copied".
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy(e: React.MouseEvent) {
    // The row beneath would toggle.
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1600)
  }

  return (
    <button type="button" onClick={(e) => void copy(e)} style={s.button}>
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : label}
      </span>
    </button>
  )
}

const s: Record<string, CSSProperties> = {
  button: {
    ...mono,
    fontSize: 11,
    padding: '2px 8px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    color: c.t4,
    cursor: 'pointer',
  },
}
