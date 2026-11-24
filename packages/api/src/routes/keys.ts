import { Hono } from 'hono'
import type { HonoEnv, Role } from '../types'
import { actorFor, refuseKeys, requireRole, requireSession } from '../auth'
import { DEV_TOKEN_SECRET } from '../config'
import { mintKey, type ApiKeyRow } from '../apiKeys'
import { ROLES } from '../auth'
import { matchesRef, policyFor } from '../policy'
import { liveSandbox } from '../sandboxes'
import { record } from '../audit'

export const keyRoutes = new Hono<HonoEnv>()

/**
 * Issuing and revoking machine credentials — admin only, and people only.
 *
 * Deliberately not delegated further. Handing out a credential is the decision
 * this whole feature exists to keep deliberate; a `qa` who could mint a
 * `qa`-level key has effectively been given the power to hand their own access
 * to anything that can hold a string. See decision 15.
 *
 * `refuseKeys` is the other half of that, and it is not implied by the line
 * above it: a key carries a role, so `requireRole('admin')` admitted an
 * admin-level key to this entire router. That let a key mint another key —
 * the one failure that outlives revocation, because revoking the leaked key
 * leaves whoever took it holding the one it issued. See decision 25.
 *
 * Applied to the router rather than to POST alone. Listing the inventory and
 * revoking someone else's key have no automated use case either, and a surface
 * where two of three verbs are refused invites the assumption that the third
 * was considered and allowed.
 */
keyRoutes.use('*', requireSession)
keyRoutes.use('*', requireRole('admin'))
keyRoutes.use('*', refuseKeys('manage API keys'))

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
  expiresAt: row.expires_at,
  selfServe: row.sandbox === 1,
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
  // This sandbox's keys, the ones its members minted for themselves included:
  // in a sandbox they are few, and an admin reviewing access should see all of
  // them.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM api_keys WHERE sandbox_id = ?1 ORDER BY created_at DESC`,
  )
    .bind(c.get('sandboxId'))
    .all<ApiKeyRow>()

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

  if (
    body.maxWorkers !== undefined &&
    (!Number.isInteger(body.maxWorkers) || body.maxWorkers < 1)
  ) {
    return c.json({ error: 'maxWorkers must be a positive integer' }, 422)
  }

  /*
   * A key may narrow its role and never widen it; `effectivePolicy` makes sure
   * of that when the key is used. But the key was stored as asked, so the list
   * showed a dev key as able to run `develop`, which every run with it was
   * then refused — the admin was told one thing and the key did another.
   * Asking for more than the role has is refused here, where it can be fixed.
   */
  const role = body.role as Role
  const rolePolicy = policyFor(role)
  const wider = (body.allowedRefs ?? []).filter((ref) => !matchesRef(rolePolicy.allowedRefs, ref))
  if (wider.length > 0) {
    return c.json(
      {
        error: `${role} may not run ${wider.join(', ')}; a ${role} key may run: ${rolePolicy.allowedRefs.join(', ')}`,
      },
      422,
    )
  }
  if (body.maxWorkers !== undefined && body.maxWorkers > rolePolicy.maxWorkers) {
    return c.json(
      { error: `${role} may use up to ${rolePolicy.maxWorkers} workers, so a ${role} key may too` },
      422,
    )
  }

  const { row, plaintext } = await mintKey(c.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET, {
    label,
    role,
    allowedRefs: body.allowedRefs,
    maxWorkers: body.maxWorkers,
    // The account that issued it. 0005 calls this "the admin who issued it".
    createdBy: actorFor(c),
  })
  // A key dies with its sandbox: nothing is left for it to act on afterwards.
  const sandbox = await liveSandbox(c.env.DB, c.get('sandboxId'))
  const expiresAt = sandbox?.expires_at ?? new Date().toISOString()

  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, hash, label, role, allowed_refs, max_workers, created_by, created_at,
                           expires_at, sandbox, sandbox_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)`,
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
      expiresAt,
      c.get('sandboxId'),
    )
    .run()
  await record(c.env.DB, c.get('sandboxId'), actorFor(c), 'key-issued', `${label} (${role})`)

  return c.json(
    { key: toView({ ...row, expires_at: expiresAt, sandbox_id: c.get('sandboxId') }), plaintext },
    201,
  )
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
    `UPDATE api_keys SET revoked_at = ?2 WHERE id = ?1 AND sandbox_id = ?3 AND revoked_at IS NULL`,
  )
    .bind(id, new Date().toISOString(), c.get('sandboxId'))
    .run()

  if (result.meta.changes === 0) {
    const exists = await c.env.DB.prepare(
      `SELECT id FROM api_keys WHERE id = ?1 AND sandbox_id = ?2`,
    )
      .bind(id, c.get('sandboxId'))
      .first()

    if (!exists) return c.json({ error: 'No such key' }, 404)
    return c.json({ ok: true, alreadyRevoked: true })
  }
  await record(c.env.DB, c.get('sandboxId'), actorFor(c), 'key-revoked', id)

  return c.json({ ok: true })
})
