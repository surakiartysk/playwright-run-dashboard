import type { Role } from './api'

/**
 * Which admin panel, if any, a session is shown.
 *
 * `full` is the real thing: the gate can be changed and keys minted. Only a
 * real admin session gets it — the server refuses everyone else, so offering
 * the controls to anyone else would be offering buttons that cannot work.
 *
 * `readOnly` is for a demo session previewing admin. Before it existed, the
 * preview showed admin's runs and nothing else, so a visitor never learned the
 * run gate or API keys existed — the two features with the most reasoning
 * behind them. The read-only panel shows the live gate and says what keys are,
 * and changes nothing: the demo password is published, so a writable panel
 * would let anyone pause runs for everyone or mint an admin key.
 *
 * Decided on the REAL role first. A demo session whose preview reads `admin`
 * must never reach `full`, whatever the preview says.
 *
 * @param role - The role the session actually signed in as
 * @param viewingRole - The role it is currently previewing, or its own
 */
export function adminPanelMode(role: Role, viewingRole: Role): 'full' | 'readOnly' | null {
  if (role === 'admin') return 'full'
  if (role === 'demo' && viewingRole === 'admin') return 'readOnly'
  return null
}
