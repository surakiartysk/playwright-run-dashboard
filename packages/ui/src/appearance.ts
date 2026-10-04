import { ACCENT_IDS, ACCENT_LABELS, type Accent } from './tokens'
import type { ThemeMode } from './theme'

/**
 * What the Appearance control offers, as data.
 *
 * The component draws these and nothing more, so the words a screen reader
 * hears and the order a keyboard moves through are decided — and tested — here
 * rather than inside markup.
 *
 * `system` is called "Auto" on screen and "Follow the device" to a screen
 * reader: three short words fit a segmented control, and the long form is the
 * one that says what the setting does.
 */
export const MODE_OPTIONS: readonly { id: ThemeMode; label: string; description: string }[] = [
  { id: 'light', label: 'Light', description: 'Light' },
  { id: 'dark', label: 'Dark', description: 'Dark' },
  { id: 'system', label: 'Auto', description: 'Follow the device' },
] as const

export const MODE_HINT = 'Auto follows the device. Light or Dark overrides it.'

export const ACCENT_OPTIONS: readonly { id: Accent; label: string }[] = ACCENT_IDS.map((id) => ({
  id,
  label: ACCENT_LABELS[id],
}))

/**
 * The next option when an arrow key is pressed inside a group of options.
 *
 * A group of choices is one stop for Tab and the arrows move within it, which
 * is how a radio group behaves and what a keyboard user expects of these two
 * rows. Wraps at both ends; any other key leaves the choice where it is.
 */
export function stepOption<T>(options: readonly T[], current: T, key: string): T {
  const at = options.indexOf(current)
  if (at < 0 || options.length === 0) return current
  if (key === 'ArrowRight' || key === 'ArrowDown') return options[(at + 1) % options.length] as T
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return options[(at - 1 + options.length) % options.length] as T
  }
  if (key === 'Home') return options[0] as T
  if (key === 'End') return options[options.length - 1] as T
  return current
}

/**
 * The line a screen reader hears for the trigger button, saying what is
 * currently chosen. A button labelled only "Appearance" would hide the answer
 * the viewer opened it to check.
 */
export function triggerLabel(mode: ThemeMode, accent: Accent): string {
  const modeText = MODE_OPTIONS.find((m) => m.id === mode)?.description ?? mode
  return `Appearance: ${modeText}, ${ACCENT_LABELS[accent]}`
}
