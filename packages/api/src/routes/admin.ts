import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { actorFor, refuseKeys, requireRole, requireSession } from '../auth'
import {
  MEMBERS_MAX,
  adminCount,
  isMemberRole,
  listMembers,
  listedRole,
  normalizeEmail,
} from '../members'
import { readAudit, record } from '../audit'

/**
 * The admin page's own endpoints: members, activity and lockdown (decision 52).
 *
 * Admin only, and people only. None of these has an automated use case, and
 * each is a way to change who may do what — exactly what a leaked key must not
 * be able to reach (non-negotiable 4). Every write is to the caller's own
 * sandbox, and every one is recorded.
 *
 * Mounted under `/demo/admin` rather than `/admin`: the Worker answers only the
 * paths its routes claim at the edge, and `/demo/*` is already one of them.
 */
export const adminRoutes = new Hono<HonoEnv>()

adminRoutes.use('*', requireSession)
adminRoutes.use('*', requireRole('admin'))
adminRoutes.use('*', refuseKeys('use the admin page'))

// ── Members ────────────────────────────────────────────────────────────────

adminRoutes.get('/members', async (c) =>
  c.json({ members: await listMembers(c.env.DB, c.get('sandboxId')) }),
)

/** Add an account, or change the role of one already listed. */
adminRoutes.put('/members', async (c) => {
  const sandboxId = c.get('sandboxId')
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null
  const email = normalizeEmail(body?.email)
  if (!email) return c.json({ error: 'email must be one plain address' }, 422)
  if (!isMemberRole(body?.role))
    return c.json({ error: 'role must be one of: admin, qa, dev' }, 422)
  const role = body.role

  const current = await listedRole(c.env.DB, sandboxId, email)
  if (current === role) return c.json({ ok: true, unchanged: true })

  // The last admin may not stop being one: a sandbox nobody can administer is
  // one whose lockdown nobody can lift.
  if (current === 'admin' && (await adminCount(c.env.DB, sandboxId)) <= 1) {
    return c.json({ error: 'This is the last admin; make another admin first' }, 409)
  }

  if (current === null) {
    const all = await listMembers(c.env.DB, sandboxId)
    if (all.length >= MEMBERS_MAX) {
      return c.json({ error: `A sandbox lists at most ${MEMBERS_MAX} accounts` }, 409)
    }
    await c.env.DB.prepare(
      `INSERT INTO members (sandbox_id, email, role, added_at, added_by) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(sandboxId, email, role, new Date().toISOString(), actorFor(c))
      .run()
    await record(c.env.DB, sandboxId, actorFor(c), 'member-added', `${email} as ${role}`)
    return c.json({ ok: true }, 201)
  }

  await c.env.DB.prepare(`UPDATE members SET role = ?3 WHERE sandbox_id = ?1 AND email = ?2`)
    .bind(sandboxId, email, role)
    .run()
  await record(
    c.env.DB,
    sandboxId,
    actorFor(c),
    'member-role-changed',
    `${email}: ${current} → ${role}`,
  )
  return c.json({ ok: true })
})

adminRoutes.delete('/members/:email', async (c) => {
  const sandboxId = c.get('sandboxId')
  const email = normalizeEmail(decodeURIComponent(c.req.param('email')))
  if (!email) return c.json({ error: 'email must be one plain address' }, 422)

  const current = await listedRole(c.env.DB, sandboxId, email)
  if (current === null) return c.json({ error: 'No such member' }, 404)
  if (current === 'admin' && (await adminCount(c.env.DB, sandboxId)) <= 1) {
    return c.json({ error: 'This is the last admin; make another admin first' }, 409)
  }

  await c.env.DB.prepare(`DELETE FROM members WHERE sandbox_id = ?1 AND email = ?2`)
    .bind(sandboxId, email)
    .run()
  await record(c.env.DB, sandboxId, actorFor(c), 'member-removed', email)
  return c.json({ ok: true })
})

// ── Activity ───────────────────────────────────────────────────────────────

adminRoutes.get('/activity', async (c) => {
  const rows = await readAudit(c.env.DB, c.get('sandboxId'))
  return c.json({
    entries: rows.map((row) => ({
      id: row.id,
      at: row.at,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
    })),
  })
})

// ── Lockdown ───────────────────────────────────────────────────────────────

/**
 * One switch for when something has leaked: while it is on, every account and
 * key in the sandbox but its admin is refused (auth.ts). Reading it is open to
 * the admin page only; everyone else learns of it from the refusal.
 */
adminRoutes.put('/lockdown', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { on?: unknown } | null
  if (typeof body?.on !== 'boolean') return c.json({ error: 'on must be true or false' }, 422)
  const sandboxId = c.get('sandboxId')

  await c.env.DB.prepare(`UPDATE sandboxes SET lockdown = ?2 WHERE id = ?1`)
    .bind(sandboxId, body.on ? 1 : 0)
    .run()
  await record(c.env.DB, sandboxId, actorFor(c), body.on ? 'lockdown-on' : 'lockdown-off')
  return c.json({ lockdown: body.on })
})
