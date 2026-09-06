import { useEffect, useState, type CSSProperties } from 'react'
import { api, type ApiKey, type Role } from '../api'
import { c, mono } from '../theme'

/**
 * Issuing and revoking the keys machines use — admin only.
 *
 * `POST /keys` and `DELETE /keys/:id` shipped with the API and nothing in the
 * UI could reach either, so the feature decision 15 describes — "we issue the
 * key and decide what it may do" — was true only for whoever had curl. That is
 * the same gap `GateControl` was built to close, repeated; it is worth naming
 * because it is clearly the shape of mistake this codebase keeps making.
 *
 * Rendered for a real admin session only. That is presentation, not
 * enforcement: `requireRole('admin')` on the routes is the control.
 */

/** A key's authority, in words, from the fields the server returns. */
function scopeOf(key: ApiKey): string {
  const refs = key.allowedRefs?.length ? key.allowedRefs.join(', ') : 'any branch'
  const workers = key.maxWorkers === null ? "the role's limit" : `${key.maxWorkers} workers`
  return `${refs} · up to ${workers}`
}

/**
 * The one moment the secret exists outside its holder's storage.
 *
 * Deliberately not a toast and not dismissable by clicking elsewhere: the
 * database holds a digest, so a panel that can be lost to a stray click costs
 * the admin a re-mint and leaves a dead key behind. It stays until it is
 * acknowledged.
 */
function MintedKey({ plaintext, onDone }: { plaintext: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  return (
    <div style={s.minted}>
      <div style={s.mintedTitle}>Copy this key now</div>
      <p style={s.mintedNote}>
        This is the only time it can be shown. Only a digest is stored, so nothing — including this
        dashboard — can show it again.
      </p>

      <div style={s.secretRow}>
        <code style={s.secret}>{plaintext}</code>
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(plaintext)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
          style={s.copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <button onClick={onDone} style={s.mintedDone}>
        I have stored it
      </button>
    </div>
  )
}

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [label, setLabel] = useState('')
  const [role, setRole] = useState<Role>('dev')
  const [refs, setRefs] = useState('')
  const [maxWorkers, setMaxWorkers] = useState('')

  const load = async () => {
    try {
      const response = await api.listKeys()
      // Defended rather than destructured. A response without `keys` — an error
      // body, a proxy's HTML, a route that is not deployed — used to reach
      // `keys.filter` below and throw, and because this renders inside the
      // dashboard rather than beside it, that took the whole page down with it.
      setKeys(Array.isArray(response?.keys) ? response.keys : [])
      setError(null)
    } catch (e) {
      setKeys([])
      setError(e instanceof Error ? e.message : 'Could not load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function mint(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const parsedWorkers = maxWorkers.trim() === '' ? undefined : Number(maxWorkers)
      const { plaintext } = await api.createKey({
        label: label.trim(),
        role,
        // An empty box means "no narrowing", which the server reads as the
        // role's own scope — not as "no branches at all".
        allowedRefs: refs.trim() === '' ? undefined : refs.split(',').map((r) => r.trim()),
        maxWorkers: parsedWorkers,
      })
      setMinted(plaintext)
      setLabel('')
      setRefs('')
      setMaxWorkers('')
      setOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that key')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(key: ApiKey) {
    setError(null)
    try {
      await api.revokeKey(key.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke that key')
    }
  }

  const live = keys.filter((k) => !k.revokedAt)

  return (
    <div>
      <div style={s.head}>
        <div>
          <h3 style={s.title}>API keys</h3>
          <p style={s.sub}>
            For pipelines that trigger runs without a person. A key may narrow what its role allows
            and can never widen it.
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} style={s.newKey}>
          {open ? 'Cancel' : 'New key'}
        </button>
      </div>

      {minted && <MintedKey plaintext={minted} onDone={() => setMinted(null)} />}

      {error && <div style={s.error}>{error}</div>}

      {open && (
        <form onSubmit={mint} style={s.form}>
          <div style={s.field}>
            <label htmlFor="key-label" style={s.label}>
              Label
            </label>
            <input
              id="key-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="deploy pipeline — checkout service"
              style={s.input}
              required
            />
            <p style={s.hint}>
              What this key is for. It is how you will know what you are revoking.
            </p>
          </div>

          <div style={s.row}>
            <div style={s.field}>
              <label htmlFor="key-role" style={s.label}>
                Role
              </label>
              {/*
                `demo` is absent because the server refuses it: a demo key can
                never dispatch for real, so it would be a credential that does
                nothing, issued with ceremony.
              */}
              <select
                id="key-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                style={s.input}
              >
                <option value="dev">dev</option>
                <option value="qa">qa</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div style={s.field}>
              <label htmlFor="key-workers" style={s.label}>
                Max workers
              </label>
              <input
                id="key-workers"
                value={maxWorkers}
                onChange={(e) => setMaxWorkers(e.target.value)}
                placeholder="role default"
                inputMode="numeric"
                style={s.input}
              />
            </div>
          </div>

          <div style={s.field}>
            <label htmlFor="key-refs" style={s.label}>
              Branches
            </label>
            <input
              id="key-refs"
              value={refs}
              onChange={(e) => setRefs(e.target.value)}
              placeholder="main, release/*  — blank for the role’s own scope"
              style={s.input}
            />
            <p style={s.hint}>
              Comma separated. Narrowing only — listing a branch the role cannot reach does not
              grant it.
            </p>
          </div>

          <button type="submit" disabled={busy || !label.trim()} style={s.submit}>
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </form>
      )}

      {loading ? (
        <div style={s.empty}>Loading keys…</div>
      ) : keys.length === 0 ? (
        <div style={s.empty}>No keys yet. Machines use these; people sign in instead.</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Label</th>
                <th style={s.th}>Role</th>
                <th style={s.th}>Scope</th>
                <th style={s.th}>Last used</th>
                <th style={s.th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} style={key.revokedAt ? s.trRevoked : s.tr}>
                  <td style={s.td}>
                    <div style={s.keyLabel}>{key.label}</div>
                    <div style={s.keyId}>{key.id}</div>
                  </td>
                  <td style={s.td}>
                    <span style={s.roleChip}>{key.role}</span>
                  </td>
                  <td style={{ ...s.td, ...s.scopeCell }}>{scopeOf(key)}</td>
                  <td style={{ ...s.td, ...mono, fontSize: 12, color: c.t5 }}>
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'never'}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    {key.revokedAt ? (
                      // Kept in the list on purpose: "was this revoked, or did
                      // it never exist?" is asked while something is broken.
                      <span style={s.revoked}>revoked</span>
                    ) : (
                      <button onClick={() => void revoke(key)} style={s.revoke}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {keys.length > 0 && (
        <p style={s.count}>
          {live.length} active
          {keys.length > live.length && ` · ${keys.length - live.length} revoked`}
        </p>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  title: { fontSize: 14, fontWeight: 600, color: c.t1 },
  sub: { margin: '4px 0 0', fontSize: 12.5, color: c.t5, maxWidth: '46ch', lineHeight: 1.5 },
  newKey: {
    padding: '7px 14px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t2,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
    flexShrink: 0,
  },

  minted: {
    background: c.card,
    border: `1px solid ${c.primaryBorder}`,
    borderLeft: `3px solid ${c.primary}`,
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 16,
  },
  mintedTitle: { fontSize: 13.5, fontWeight: 600, color: c.t1 },
  mintedNote: { margin: '5px 0 12px', fontSize: 12.5, color: c.t4, lineHeight: 1.5 },
  secretRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  secret: {
    ...mono,
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
    whiteSpace: 'nowrap',
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 7,
    padding: '9px 11px',
    fontSize: 12.5,
    color: c.t1,
  },
  copy: {
    padding: '9px 14px',
    background: c.primary,
    border: 'none',
    borderRadius: 7,
    color: '#fff',
    font: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  },
  mintedDone: {
    marginTop: 12,
    padding: '6px 13px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    color: c.t3,
    font: 'inherit',
    fontSize: 12.5,
    cursor: 'pointer',
  },

  form: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { flex: '1 1 180px', minWidth: 0 },
  label: { display: 'block', fontSize: 12, fontWeight: 500, color: c.t2, marginBottom: 6 },
  input: {
    width: '100%',
    padding: '9px 11px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    color: c.t1,
    font: 'inherit',
    fontSize: 13,
    outline: 'none',
  },
  hint: { margin: '6px 0 0', fontSize: 11.5, color: c.t5, lineHeight: 1.45 },
  submit: {
    alignSelf: 'flex-start',
    padding: '9px 16px',
    background: c.primary,
    border: 'none',
    borderRadius: 9,
    color: '#fff',
    font: 'inherit',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
  },

  error: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: '3px solid #dc2626',
    borderRadius: 9,
    padding: '10px 13px',
    marginBottom: 14,
    color: '#dc2626',
    fontSize: 12.5,
  },
  empty: {
    padding: '18px 0',
    color: c.t5,
    fontSize: 13,
  },

  tableWrap: { border: `1px solid ${c.border}`, borderRadius: 10, overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 560 },
  th: {
    textAlign: 'left',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: c.t5,
    padding: '9px 13px',
    borderBottom: `1px solid ${c.border}`,
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: `1px solid ${c.divider}` },
  /* Still legible, visibly inactive — it has to stay readable to answer the
     question it is kept for. */
  trRevoked: { borderBottom: `1px solid ${c.divider}`, opacity: 0.55 },
  td: { padding: '10px 13px', fontSize: 13, color: c.t2, verticalAlign: 'middle' },
  keyLabel: { color: c.t1, fontWeight: 500, fontSize: 13 },
  keyId: { ...mono, fontSize: 11, color: c.t5, marginTop: 2 },
  roleChip: {
    ...mono,
    fontSize: 11,
    color: c.t3,
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '2px 7px',
  },
  scopeCell: { fontSize: 12, color: c.t4 },
  revoke: {
    padding: '5px 11px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 7,
    color: c.t4,
    font: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  },
  revoked: { fontSize: 12, color: c.t5 },
  count: { margin: '10px 0 0', fontSize: 12, color: c.t5 },
}
