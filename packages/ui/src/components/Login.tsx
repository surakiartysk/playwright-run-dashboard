import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, type Role } from '../api'
import { c } from '../theme'
import { ProjectLinks } from './ProjectLinks'

/**
 * Sign in — one column, centred, nothing beside it.
 *
 * This was a split panel: identity on the left, the form on the right. The
 * left half did no work beyond saying what this is, and the design that
 * replaced it says that in a line under the title instead. A plain card also
 * collapses to a phone with no special case, where the split needed a media
 * query and four `!important` overrides to stop the password field falling off
 * the screen.
 *
 * The table of what each role may do is not here either. It is served only to a
 * signed-in session (`/demo/roles` requires one), so a table on this screen
 * would have to be a hard-coded copy that can drift from `policy.ts`. After
 * sign-in, "View as" shows the real one.
 *
 * `demo` is one click rather than a password to type: a demo whose first
 * screen is a password you have to go hunting for is a demo nobody sees. The
 * other roles' passwords are not printed here, in simulation or on a real
 * deployment — the README lists the local ones, and a real deployment's are
 * not the visitor's to know.
 */
/**
 * Whether the password field should take the focus once the page knows what it
 * offers. Only where there is no demo button: there the field is the way in,
 * and where there is one the button is, and a focused field put the caret, and
 * on a phone the keyboard, in front of a visitor who came to press it. Not
 * before the check has answered, because until then the page does not know.
 */
export function focusesPassword(checked: boolean, demoPassword: string | null): boolean {
  return checked && demoPassword === null
}

export function Login({ onSignedIn }: { onSignedIn: (role: Role) => void }) {
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hints, setHints] = useState<{
    passwords: Record<string, string>
  } | null>(null)
  const [checked, setChecked] = useState(false)
  const passwordField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .devCredentials()
      .then((r) => setHints({ passwords: r.passwords }))
      .catch(() => setHints(null))
      .finally(() => setChecked(true))
  }, [])

  async function signIn(secret: string, who?: string) {
    setBusy(true)
    setError(null)
    try {
      const { role } = await api.login(secret, who)
      onSignedIn(role)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await signIn(password, name)
  }

  /*
   * The demo password is public. Asking a visitor to find it and then type it
   * back is a wall that stops nobody and costs everybody: whoever came to look
   * at the work meets an empty form instead of the tool.
   *
   * So demo is a button, and the field below is still the way in for a role
   * that has a password of its own.
   */
  const demoPassword = hints?.passwords.demo ?? null

  useEffect(() => {
    if (focusesPassword(checked, demoPassword)) passwordField.current?.focus()
  }, [checked, demoPassword])

  return (
    <main style={s.page}>
      <form style={s.form} onSubmit={submit}>
        <div style={s.mark}>
          <FlaskIcon size={28} colour="var(--c-on-primary)" />
        </div>

        <h1 style={s.title}>Test Run Dashboard</h1>
        <p style={s.sub}>Run a suite on a branch, then read its report.</p>
        <ProjectLinks style={{ textAlign: 'center', margin: '-14px 0 24px' }} />

        <div style={s.card}>
          {demoPassword && (
            <>
              <button
                type="button"
                onClick={() => void signIn(demoPassword)}
                disabled={busy}
                style={s.demo}
              >
                Look around as demo →
              </button>
              <div style={s.or}>
                <span style={s.orLine} />
                <span style={s.orText}>or sign in</span>
                <span style={s.orLine} />
              </div>
            </>
          )}

          {/*
            Optional, and above the password because it is answered first.

            The password decides what someone may do; this only says who was
            at the keyboard, so a shared role password stops producing a
            history where every run says the same role and nothing else.

            It is a claim, not an identity — anyone with the password can
            type anything — so it is never required and never blocks a
            sign-in. The hint says as much rather than implying a check that
            does not happen.
          */}
          <label htmlFor="who" style={s.label}>
            Your name <span style={s.optional}>optional</span>
          </label>

          <input
            id="who"
            value={name}
            placeholder="shown on the runs you start"
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            style={{ ...s.input, paddingLeft: 13, marginBottom: 16 }}
          />

          <label htmlFor="password" style={s.label}>
            Password
          </label>

          <div style={s.inputWrap}>
            <span style={s.lockIcon}>
              <LockIcon />
            </span>
            <input
              id="password"
              type={reveal ? 'text' : 'password'}
              value={password}
              ref={passwordField}
              /*
                Names who the field is for, rather than hinting `demo`.

                A placeholder reading "type demo" would point at the button
                directly above it — the same duplication the password table
                was removed for, reintroduced in smaller type. Anyone who
                wants demo has a one-click way in; this field exists for the
                people who were given a different password, and saying so is
                more useful than repeating the button.
              */
              placeholder={demoPassword ? 'dev, qa or admin password' : 'Dashboard password'}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                ...s.input,
                borderColor: error ? c.dangerBorder : c.border,
                background: error ? c.dangerBg : c.input,
              }}
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              style={s.reveal}
              aria-label={reveal ? 'Hide password' : 'Show password'}
            >
              <EyeIcon off={reveal} />
            </button>
          </div>

          {error && (
            <p style={s.error} role="alert">
              {error}
            </p>
          )}

          {/*
            Quieter when demo is offered above it, because then this is the
            path for the few people who hold a password, not the many who came
            to look. Where there is no demo to offer, it is the only way in and
            takes the emphasis back.
          */}
          <button
            type="submit"
            disabled={busy || !password}
            style={demoPassword ? { ...s.submit, ...s.submitQuiet } : s.submit}
          >
            {busy ? (
              <>
                <span style={s.spinner} /> Signing in…
              </>
            ) : (
              <>Sign in →</>
            )}
          </button>
        </div>

        {/*
          Nothing below the card unless there is nothing in it to press.

          This carried a password table, then a sentence about which
          deployment the visitor had landed on and what demo could reach.
          Both were answers to questions nobody asks at a sign-in screen:
          the button says what to press, and the limits explain themselves
          at the moment they apply — the run cap names itself in the error
          it returns, and the role's scope is on the dashboard behind it.

          The one case that still needs a line is a screen offering no way
          in at all, where silence would read as broken rather than closed.
        */}
        {!hints && <p style={s.restricted}>Sign-in is not available on this deployment</p>}
      </form>
    </main>
  )
}

function FlaskIcon({ size = 32, colour = 'rgba(255,255,255,0.95)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <line x1="11" y1="7" x2="21" y2="7" stroke={colour} strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M13 7v8L7 23a2 2 0 0 0 1.6 3.2h14.8A2 2 0 0 0 25 23l-6-8V7"
        stroke={colour}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="21" r="2" fill={colour} opacity="0.9" />
    </svg>
  )
}

const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
  </svg>
)

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    {off && <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="1.8" />}
  </svg>
)

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 20px',
    background: c.bg,
  },
  form: {
    width: '100%',
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    // Entering, so the longest of the three durations (src/tokens.ts).
    animation: 'fade-in var(--motion-enter) var(--ease)',
  },
  mark: {
    width: 52,
    height: 52,
    background: c.primary,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 800,
    color: c.t1,
    letterSpacing: '-0.02em',
    textAlign: 'center',
  },
  sub: { margin: '8px 0 24px', color: c.t3, fontSize: 15, textAlign: 'center' },
  card: {
    width: '100%',
    background: c.card,
    border: `1px solid ${c.divider}`,
    borderRadius: 14,
    padding: 20,
  },

  /* The way in for anyone who came to look rather than to work. */
  demo: {
    width: '100%',
    minHeight: 48,
    padding: '11px 16px',
    background: c.primary,
    border: 'none',
    borderRadius: 10,
    color: c.onPrimary,
    font: 'inherit',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 16,
  },
  or: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  orLine: { flex: 1, height: 1, background: c.border },
  orText: { fontSize: 13, color: c.t4, fontWeight: 600 },

  label: { display: 'block', fontSize: 14, fontWeight: 700, color: c.t2, marginBottom: 6 },
  optional: { color: c.t4, fontWeight: 500, fontSize: 13 },
  inputWrap: { position: 'relative' },
  lockIcon: {
    position: 'absolute',
    left: 13,
    top: '50%',
    transform: 'translateY(-50%)',
    color: c.t5,
    display: 'flex',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    minHeight: 44,
    padding: '10px 44px 10px 38px',
    border: `1px solid ${c.border}`,
    borderRadius: 10,
    // Set here, not only on the password field: the name field had no
    // background of its own and stayed browser-white in the dark theme, where
    // the text colour is near-white too.
    background: c.input,
    color: c.t1,
    font: 'inherit',
    // 16px: below that, iOS zooms the page when a field takes focus.
    fontSize: 16,
    transition: 'border-color var(--motion-fast) var(--ease)',
  },
  reveal: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 44,
    height: 44,
    background: 'none',
    border: 'none',
    color: c.t5,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: c.danger, fontSize: 13, marginTop: 10 },

  submit: {
    width: '100%',
    minHeight: 44,
    marginTop: 18,
    padding: '11px 16px',
    background: c.primary,
    border: 'none',
    borderRadius: 10,
    color: c.onPrimary,
    font: 'inherit',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  submitQuiet: {
    background: 'transparent',
    border: `1px solid ${c.border}`,
    color: c.t2,
  },
  spinner: {
    width: 15,
    height: 15,
    // currentColor, so it reads on the solid button and on the quiet one.
    border: '2px solid color-mix(in srgb, currentColor 35%, transparent)',
    borderTopColor: 'currentColor',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    display: 'inline-block',
  },

  restricted: { marginTop: 22, fontSize: 13, color: c.t4, textAlign: 'center' },
}
