import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { requireRole, requireSession } from '../auth'
import { gateApplies, loadGate, resolveGate, type GateMode } from '../gate'

export const gateRoutes = new Hono<HonoEnv>()

gateRoutes.use('*', requireSession)

/**
 * GET /gate — the current state, for anyone signed in.
 *
 * Readable by every role, including the one it restricts. A developer who
 * presses Run and is refused should be able to see why and when it lifts,
 * rather than filing a bug about a broken button.
 */
gateRoutes.get('/', async (c) => {
  const role = c.get('role')
  const status = resolveGate(await loadGate(c.env.DB), new Date())

  return c.json({
    ...status,
    // What it means *for you*. `qa` sees a closed gate and is still unblocked.
    appliesToYou: gateApplies(role),
  })
})

const MODES: GateMode[] = ['open', 'closed', 'window']

/**
 * PUT /gate — admin only.
 *
 * Whoever changed it is recorded, so "why can I not run anything?" has an
 * answer that does not require reading a log.
 */
gateRoutes.put('/', requireRole('admin'), async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    mode?: string
    opensAt?: string
    closesAt?: string
  } | null

  if (!body || !body.mode || !MODES.includes(body.mode as GateMode)) {
    return c.json({ error: `mode must be one of: ${MODES.join(', ')}` }, 422)
  }

  const mode = body.mode as GateMode

  // Validated here rather than left to fail open at read time: a window the
  // gate would silently ignore is worse than a rejected request, because the
  // admin walks away believing they closed it.
  if (mode === 'window') {
    const opens = Date.parse(body.opensAt ?? '')
    const closes = Date.parse(body.closesAt ?? '')

    if (Number.isNaN(opens) || Number.isNaN(closes)) {
      return c.json({ error: 'window mode needs opensAt and closesAt as ISO-8601' }, 422)
    }
    if (closes <= opens) {
      return c.json({ error: 'closesAt must be after opensAt' }, 422)
    }
  }

  await c.env.DB.prepare(
    `UPDATE run_gate
        SET mode = ?1, opens_at = ?2, closes_at = ?3, updated_at = ?4, updated_by = ?5
      WHERE id = 1`,
  )
    .bind(
      mode,
      mode === 'window' ? (body.opensAt ?? null) : null,
      mode === 'window' ? (body.closesAt ?? null) : null,
      new Date().toISOString(),
      c.get('role'),
    )
    .run()

  return c.json(resolveGate(await loadGate(c.env.DB), new Date()))
})
