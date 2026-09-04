import { Hono } from 'hono'
import type { HonoEnv, Role } from '../types'
import { requireRole, requireSession } from '../auth'
import { DEV_TOKEN_SECRET } from '../config'
import { mintKey, type ApiKeyRow } from '../apiKeys'
import { ROLES } from '../auth'

export const keyRoutes = new Hono<HonoEnv>()

/**
 * Issuing and revoking machine credentials — admin only, all of it.
 *
 * Deliberately not delegated further. Handing out a credential is the decision
 * this whole feature exists to keep deliberate; a `qa` who could mint a
 * `qa`-level key has effectively been given the power to hand their own access
 * to anything that can hold a string. See decision 15.
 */
keyRoutes.use('*', requireSession)
keyRoutes.use('*', requireRole('admin'))

/**
 * A key as anyone may read it afterwards — everything except the secret.
 *
 * There is no field here that could reconstruct the key, which is the point:
 * this endpoint is safe to leave open to an admin's browser precisely because
 * `hash` never leaves the database.
 */
const toView = (row: ApiKeyRow) => ({
  id: row.id,
  label: row.label,
  role: row.role,
  allowedRefs: row.allowed_refs?.split(',') ?? null,
  maxWorkers: row.max_workers,
  createdBy: row.created_by,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
})

// ── GET /keys ───────────────────────────────────────────────────────────────
/**
 * Revoked keys are listed too, and not as an oversight.
 *
 * "Was this key revoked, or did it never exist?" is the question asked while
 * something is broken at 02:00, and a list that silently omits revoked keys
 * answers it wrong. `revokedAt` carries the distinction.
 */
keyRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM api_keys ORDER BY created_at DESC`,
  ).all<ApiKeyRow>()

  return c.json({ keys: results.map(toView) })
})

// ── POST /keys ──────────────────────────────────────────────────────────────
/**
 * Mints a key and returns the plaintext **once**.
 *
 * The response is the only time it exists outside the caller's own storage;
 * there is no endpoint that can show it again, because the database holds a
 * digest rather than the key.
 */
keyRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    label?: string
    role?: string
    allowedRefs?: string[]
    maxWorkers?: number
  } | null

  if (!body) return c.json({ error: 'Body must be JSON' }, 400)

  const label = body.label?.trim()
  if (!label)
    return c.json(
      { error: 'label is required — a key nobody can identify is a key nobody dares revoke' },
      422,
    )

  if (!body.role || !(ROLES as readonly string[]).includes(body.role)) {
    return c.json({ error: `role must be one of: ${ROLES.join(', ')}` }, 422)
  }

  // `demo` exists to be handed out publicly and can never dispatch for real
  // (decision 12). A key for it would be a credential that does nothing, issued
  // with ceremony — worth refusing rather than explaining later.
  if (body.role === 'demo') {
    return c.json({ error: 'demo cannot dispatch for real, so a key for it would do nothing' }, 422)
  }

  if (
    body.maxWorkers !== undefined &&
    (!Number.isInteger(body.maxWorkers) || body.maxWorkers < 1)
  ) {
    return c.json({ error: 'maxWorkers must be a positive integer' }, 422)
  }

  const { row, plaintext } = await mintKey(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, {
    label,
    role: body.role as Role,
    allowedRefs: body.allowedRefs,
    maxWorkers: body.maxWorkers,
    createdBy: c.get('role'),
  })

  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, hash, label, role, allowed_refs, max_workers, created_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      row.id,
      row.hash,
      row.label,
      row.role,
      row.allowed_refs,
      row.max_workers,
      row.created_by,
      row.created_at,
    )
    .run()

  return c.json({ key: toView(row), plaintext }, 201)
})

// ── DELETE /keys/:id ────────────────────────────────────────────────────────
/**
 * Revokes rather than deletes.
 *
 * The row stays so the runs it started remain attributable — deleting it would
 * leave a history of runs pointing at a key nobody can name. Revoking twice is
 * not an error: whoever is revoking a leaked credential should not have to
 * check whether someone beat them to it.
 */
keyRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const result = await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL`,
  )
    .bind(id, new Date().toISOString())
    .run()

  if (result.meta.changes === 0) {
    const exists = await c.env.DB.prepare(`SELECT id FROM api_keys WHERE id = ?1`).bind(id).first()

    if (!exists) return c.json({ error: 'No such key' }, 404)
    return c.json({ ok: true, alreadyRevoked: true })
  }

  return c.json({ ok: true })
})
