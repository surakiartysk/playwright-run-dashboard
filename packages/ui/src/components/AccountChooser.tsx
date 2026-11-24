import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, type Account } from '../api'
import { c } from '../theme'

/**
 * The concept Google account chooser (decision 52).
 *
 * Not connected to Google, and the heading says so. It lists the sandbox's
 * accounts — or, before there is a sandbox, the ones a new one starts with —
 * and one account that is on no list. Picking goes through the real check:
 * a listed account is signed in with its role, the other is refused. The
 * refusal is the point of the screen, so it is shown in place rather than
 * closing the chooser.
 *
 * A native `<dialog>` opened modally: focus is held inside it and Escape closes
 * it, without a focus trap written by hand.
 */
export function AccountChooser({
  onClose,
  onSignedIn,
}: {
  onClose: () => void
  onSignedIn: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
    api
      .accounts()
      .then((r) => setAccounts(r.accounts))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Could not load the accounts'),
      )
  }, [])

  async function pick(email: string) {
    setBusy(email)
    setError(null)
    try {
      await api.account(email)
      onSignedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <dialog
      ref={dialog}
      style={s.dialog}
      aria-labelledby="chooser-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div style={s.head}>
        <h2 id="chooser-title" style={s.title}>
          Choose an account
        </h2>
        <p style={s.sub}>
          A concept of a company Google sign-in — nothing is sent to Google. Only accounts on this
          sandbox&rsquo;s list get in.
        </p>
      </div>

      <ul style={s.list}>
        {accounts === null && !error && <li style={s.loading}>Loading the accounts…</li>}
        {accounts?.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              style={s.account}
              onClick={() => void pick(account.email)}
              disabled={busy !== null}
            >
              <span style={s.avatar} aria-hidden>
                {account.email[0]!.toUpperCase()}
              </span>
              <span style={s.who}>
                <span style={s.email}>{account.email}</span>
                <span style={s.role}>
                  {account.role === null
                    ? 'not on the list'
                    : account.role === 'admin'
                      ? 'listed as admin · needs the admin key'
                      : `listed as ${account.role}`}
                </span>
              </span>
              {busy === account.email && <span style={s.role}>…</span>}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" style={s.error}>
          {error}
        </p>
      )}

      <div style={s.foot}>
        <button type="button" style={s.cancel} onClick={() => dialog.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}

const s: Record<string, CSSProperties> = {
  dialog: {
    width: 'min(420px, calc(100vw - 32px))',
    padding: 0,
    border: `1px solid ${c.border}`,
    borderRadius: 14,
    background: c.card,
    color: c.t1,
  },
  head: { padding: '18px 20px 6px' },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  sub: { margin: '6px 0 0', fontSize: 13, color: c.t4, lineHeight: 1.45 },
  list: { listStyle: 'none', margin: 0, padding: '8px 8px 0' },
  loading: { padding: '12px', color: c.t4, fontSize: 14 },
  account: {
    width: '100%',
    minHeight: 52,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 10,
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  avatar: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: '50%',
    background: c.primaryLight,
    color: c.primary,
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: 14,
  },
  who: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  email: { fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' },
  role: { fontSize: 12, color: c.t4 },
  error: { margin: '8px 20px 0', color: c.danger, fontSize: 13 },
  foot: { display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 16px' },
  cancel: {
    minHeight: 40,
    padding: '8px 14px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t3,
    font: 'inherit',
    fontSize: 14,
    cursor: 'pointer',
  },
}
