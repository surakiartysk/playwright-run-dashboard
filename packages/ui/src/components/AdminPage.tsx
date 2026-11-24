import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ApiError, api, type ActivityEntry, type Me, type Member, type Role } from '../api'
import { ApiKeys } from './ApiKeys'
import { GateControl } from './GateControl'
import { Segmented } from './Segmented'
import { CopyButton } from './CopyButton'
import { c } from '../theme'

/**
 * The admin page, at `/admin` (decision 52).
 *
 * Off the main page on purpose: an admin opens the dashboard for the same
 * reason everyone else does, to see whether the last run passed, and the
 * levers that change things for everyone in the sandbox are a separate place
 * to go.
 *
 * Two locks in front of it, as on a real deployment: the account must be
 * listed as admin, and the admin key must be given. The key is shown here
 * because this is a demo — a demo whose admin page cannot be reached shows
 * nothing — and the check it goes through is the real one. The page says so.
 *
 * Every write is refused by the server to anyone who is not admin; what is
 * shown here is presentation, not enforcement.
 */

type Tab = 'gate' | 'members' | 'keys' | 'activity' | 'lockdown'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'gate', label: 'Run gate', hint: 'Pause developer runs during a release' },
  { id: 'members', label: 'Members', hint: 'Who may sign in, and as what' },
  { id: 'keys', label: 'API keys', hint: 'Credentials for pipelines' },
  { id: 'activity', label: 'Activity', hint: 'Who did what in this sandbox' },
  { id: 'lockdown', label: 'Lockdown', hint: 'Refuse everyone but admin' },
]

export function AdminPage({
  me,
  onChanged,
  onBack,
}: {
  me: Me
  onChanged: () => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('gate')

  return (
    <section style={s.page} aria-labelledby="admin-title">
      <div style={s.head}>
        <button type="button" style={s.back} onClick={onBack}>
          ← Runs
        </button>
        <h2 id="admin-title" style={s.title}>
          <span style={s.badge}>admin</span> Controls
        </h2>
      </div>

      {me.role !== 'admin' ? (
        <Unlock me={me} onUnlocked={onChanged} />
      ) : (
        <>
          <AdminHour me={me} onLocked={onChanged} />
          <Segmented
            kind="tab"
            label="Admin controls"
            options={TABS.map((t) => ({ value: t.id, label: t.label, title: t.hint }))}
            value={tab}
            onChange={setTab}
            panelId={(id) => `admin-tab-${id}`}
            style={s.tabs}
          />
          <div
            role="tabpanel"
            id={`admin-tab-${tab}`}
            aria-label={TABS.find((t) => t.id === tab)?.label}
            style={s.body}
          >
            {tab === 'gate' && <GateControl />}
            {tab === 'members' && <Members me={me} />}
            {tab === 'keys' && <ApiKeys />}
            {tab === 'activity' && <Activity />}
            {tab === 'lockdown' && <Lockdown me={me} onChanged={onChanged} />}
          </div>
        </>
      )}
    </section>
  )
}

/** The second lock: the admin key, for an account the list names as admin. */
function Unlock({ me, onUnlocked }: { me: Me; onUnlocked: () => void }) {
  const [shown, setShown] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (me.listedRole !== 'admin') return
    api
      .adminKey()
      .then((r) => setShown(r.key))
      .catch(() => setShown(null))
  }, [me.listedRole])

  if (me.listedRole !== 'admin') {
    return (
      <div style={s.card}>
        <h3 style={s.cardTitle}>Not an admin account</h3>
        <p style={s.text}>
          {me.email} is listed as <strong>{me.listedRole}</strong>. The admin page needs an account
          the list names as admin, and then the admin key. Switch account from the top of the page
          to the one listed as admin.
        </p>
      </div>
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.unlockAdmin(key)
      onUnlocked()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unlock')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form style={s.card} onSubmit={submit}>
      <h3 style={s.cardTitle}>Admin key</h3>
      <p style={s.text}>
        Listed as admin is half of it. The other half is this sandbox&rsquo;s admin key, which gives
        an hour of admin. On a real deployment it is a secret one person holds; here it is shown,
        because this is a demo.
      </p>
      {shown && (
        <p style={s.keyLine}>
          <span style={s.demoTag}>demo</span>
          <code style={s.code}>{shown}</code>
          <CopyButton text={shown} label="Copy the admin key" />
        </p>
      )}
      <label htmlFor="admin-key" style={s.label}>
        Paste the key
      </label>
      <div style={s.row}>
        <input
          id="admin-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          style={s.input}
        />
        <button type="submit" disabled={busy || key.length === 0} style={s.primary}>
          Unlock
        </button>
      </div>
      {error && (
        <p role="alert" style={s.error}>
          {error}
        </p>
      )}
    </form>
  )
}

/** How long the admin hour has left, and a way to give it up. */
function AdminHour({ me, onLocked }: { me: Me; onLocked: () => void }) {
  const minutes = me.adminUntil
    ? Math.max(0, Math.round((me.adminUntil * 1000 - Date.now()) / 60_000))
    : null
  return (
    <p style={s.hour}>
      Admin as {me.email}
      {minutes !== null && <> · {minutes} min left</>}
      <button
        type="button"
        style={s.link}
        onClick={() => void api.lockAdmin().then(onLocked, onLocked)}
      >
        Lock admin
      </button>
    </p>
  )
}

const ROLES: Role[] = ['admin', 'qa', 'dev']

function Members({ me }: { me: Me }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('qa')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .members()
      .then((r) => setMembers(r.members))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load members'))
  }, [])
  useEffect(load, [load])

  const act = async (work: Promise<unknown>) => {
    setError(null)
    try {
      await work
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work')
    }
  }

  return (
    <div>
      <p style={s.text}>
        Only these accounts may sign in to this sandbox. A change takes effect on the person&rsquo;s
        next click; the last admin cannot be removed or demoted.
      </p>
      <ul style={s.list}>
        {members?.map((m) => (
          <li key={m.email} style={s.item}>
            <span style={s.itemMain}>
              <span style={s.email}>{m.email}</span>
              {m.email === me.email && <span style={s.you}>you</span>}
            </span>
            <select
              aria-label={`Role of ${m.email}`}
              value={m.role}
              onChange={(e) => void act(api.setMember(m.email, e.target.value as Role))}
              style={s.select}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={s.danger}
              onClick={() => void act(api.removeMember(m.email))}
              aria-label={`Remove ${m.email}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        style={s.row}
        onSubmit={(e) => {
          e.preventDefault()
          void act(api.setMember(email, role)).then(() => setEmail(''))
        }}
      >
        <input
          aria-label="Email to add"
          placeholder="name@demo.testbydesign.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={s.input}
        />
        <select
          aria-label="Role to add as"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          style={s.select}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!email} style={s.primary}>
          Add
        </button>
      </form>
      {error && (
        <p role="alert" style={s.error}>
          {error}
        </p>
      )}
    </div>
  )
}

/** What the activity log calls each action, in words a reader uses. */
export const ACTION_LABELS: Record<string, string> = {
  'sign-in': 'signed in',
  'sign-in-refused': 'was refused sign-in',
  'admin-unlocked': 'unlocked admin',
  'admin-key-refused': 'was refused the admin key',
  'member-added': 'added a member',
  'member-removed': 'removed a member',
  'member-role-changed': 'changed a role',
  'key-issued': 'issued a key',
  'key-revoked': 'revoked a key',
  'gate-changed': 'set the run gate',
  'lockdown-on': 'locked the sandbox down',
  'lockdown-off': 'lifted lockdown',
  'run-deleted': 'deleted a run',
}

function Activity() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api
      .activity()
      .then((r) => setEntries(r.entries))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load activity'))
  }, [])

  if (error) return <p style={s.error}>{error}</p>
  if (!entries) return <p style={s.text}>Loading activity…</p>
  if (entries.length === 0) return <p style={s.text}>Nothing has happened in this sandbox yet.</p>
  return (
    <ol style={s.list}>
      {entries.map((entry) => (
        <li key={entry.id} style={s.item}>
          <span style={s.itemMain}>
            <span>
              <strong style={{ fontWeight: 600 }}>{entry.actor}</strong>{' '}
              {ACTION_LABELS[entry.action] ?? entry.action}
              {entry.detail && <span style={{ color: c.t4 }}> · {entry.detail}</span>}
            </span>
          </span>
          <time dateTime={entry.at} style={s.when}>
            {new Date(entry.at).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  )
}

function Lockdown({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const on = me.sandbox.lockdown
  return (
    <div>
      <p style={s.text}>
        For when something has leaked. While it is on, every account and key in this sandbox but its
        admin is refused. It is {on ? <strong>on</strong> : 'off'}.
      </p>
      <button
        type="button"
        style={on ? s.primary : s.dangerSolid}
        onClick={() =>
          void api
            .setLockdown(!on)
            .then(onChanged, (e: unknown) =>
              setError(e instanceof Error ? e.message : 'Could not change lockdown'),
            )
        }
      >
        {on ? 'Lift lockdown' : 'Lock the sandbox down'}
      </button>
      {error && (
        <p role="alert" style={s.error}>
          {error}
        </p>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: { marginBottom: 20 },
  head: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' },
  back: {
    minHeight: 40,
    padding: '7px 12px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    color: c.t3,
    font: 'inherit',
    fontSize: 14,
    cursor: 'pointer',
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 650,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: c.primary,
    background: c.primaryLight,
    border: `1px solid ${c.primaryBorder}`,
    borderRadius: 5,
    padding: '2px 7px',
  },
  tabs: { marginBottom: 16 },
  body: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: 18,
    minWidth: 0,
  },
  card: {
    background: c.card,
    border: `1px solid ${c.primaryBorder}`,
    borderRadius: 12,
    padding: 20,
    maxWidth: 560,
  },
  cardTitle: { margin: '0 0 8px', fontSize: 15, fontWeight: 650 },
  text: { margin: '0 0 12px', fontSize: 14, color: c.t2, lineHeight: 1.55, maxWidth: '68ch' },
  keyLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    margin: '0 0 14px',
  },
  demoTag: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    color: c.warn,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '1px 6px',
  },
  code: { fontSize: 13, overflowWrap: 'anywhere' },
  label: { display: 'block', fontSize: 14, fontWeight: 600, color: c.t2, marginBottom: 6 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  input: {
    flex: '1 1 220px',
    minWidth: 0,
    minHeight: 44,
    padding: '9px 12px',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    background: c.input,
    color: c.t1,
    font: 'inherit',
    // 16px: below that, iOS zooms the page when a field takes focus.
    fontSize: 16,
  },
  select: {
    minHeight: 44,
    padding: '8px 10px',
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    background: c.input,
    color: c.t1,
    font: 'inherit',
    fontSize: 14,
  },
  primary: {
    minHeight: 44,
    padding: '9px 16px',
    background: c.primary,
    border: 'none',
    borderRadius: 9,
    color: c.onPrimary,
    font: 'inherit',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  danger: {
    minHeight: 44,
    padding: '8px 12px',
    background: 'transparent',
    border: `1px solid ${c.dangerBorder}`,
    borderRadius: 9,
    color: c.danger,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
  dangerSolid: {
    minHeight: 44,
    padding: '9px 16px',
    background: c.danger,
    border: 'none',
    borderRadius: 9,
    color: c.onPrimary,
    font: 'inherit',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  error: { color: c.danger, fontSize: 13, margin: '10px 0 0' },
  hour: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    margin: '0 0 14px',
    fontSize: 13,
    color: c.t4,
  },
  link: {
    minHeight: 32,
    background: 'transparent',
    border: 'none',
    color: c.primary,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
    padding: '4px 6px',
  },
  list: { listStyle: 'none', margin: '0 0 12px', padding: 0 },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    padding: '10px 0',
    borderBottom: `1px solid ${c.divider}`,
    fontSize: 14,
  },
  itemMain: { flex: '1 1 220px', minWidth: 0, display: 'flex', gap: 8, alignItems: 'center' },
  email: { overflowWrap: 'anywhere' },
  you: {
    fontSize: 11,
    color: c.t4,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '0 5px',
  },
  when: { fontSize: 12, color: c.t4 },
}
