import { useEffect, useState, type CSSProperties } from 'react'
import { api, type Role } from '../api'
import { brandPanelBackground, c } from '../theme'

/**
 * Sign in — a split panel: identity on the left, the form on the right.
 *
 * The left panel does no work beyond saying what this is, which is the point:
 * a login screen that is only a centred box gives no sense of what you are
 * signing into.
 *
 * In simulation the development passwords are printed on the form. They are in
 * the source anyway, and a demo whose first screen is a password you have to go
 * hunting for is a demo nobody sees.
 */
export function Login({ onSignedIn }: { onSignedIn: (role: Role) => void }) {
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hints, setHints] = useState<{
    mode: 'full' | 'demo-only'
    passwords: Record<string, string>
  } | null>(null)

  useEffect(() => {
    api
      .devCredentials()
      .then((r) => setHints({ mode: r.mode, passwords: r.passwords }))
      .catch(() => setHints(null))
  }, [])

  async function signIn(secret: string) {
    setBusy(true)
    setError(null)
    try {
      const { role } = await api.login(secret)
      onSignedIn(role)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await signIn(password)
  }

  /*
   * The demo password is published — in this repo's README, on the landing page,
   * and in the panel below. Asking a visitor to read it and then type it back is
   * a wall that stops nobody and costs everybody: whoever came to look at the
   * work meets an empty form instead of the tool.
   *
   * So demo is a button. The password stays visible for anyone who wants to see
   * that it is real rather than a bypass, and the field below is still the way
   * in for a role that has one.
   */
  const demoPassword = hints?.passwords.demo ?? null

  return (
    <div style={s.outer} className="login-split">
      <aside style={s.left} className="login-panel">
        <div
          className="login-orb"
          style={{ ...s.circle, width: 420, height: 420, top: -120, right: -120 }}
        />
        <div
          className="login-orb"
          style={{ ...s.circle, width: 300, height: 300, bottom: -80, left: -80 }}
        />
        <div
          className="login-orb"
          style={{ ...s.circle, width: 160, height: 160, bottom: 120, right: 40 }}
        />

        <div style={s.leftInner}>
          <div style={s.brandIcon} className="login-brand-icon">
            <FlaskIcon size={34} />
          </div>

          <h1 style={s.brandTitle}>Test Run Dashboard</h1>
          <p style={s.brandSub}>Self-service test running</p>

          {/*
            Hidden in the collapsed band: stacked above the form on a phone,
            the note and pill push the password field below the fold, and the
            panel's job there is to say what this is, not to sell it.
          */}
          <div style={s.divider} className="login-panel-detail" />

          <p style={s.brandNote} className="login-panel-detail">
            Trigger the API suite against any branch and read the report — without waiting for QA or
            digging through CI artifacts.
          </p>

          <div style={s.pill} className="login-panel-detail">
            <span style={s.pulseDot} />
            Live run monitoring
          </div>
        </div>
      </aside>

      <main style={s.right} className="login-form-col">
        <form style={s.form} onSubmit={submit}>
          <div style={s.formIcon} className="login-form-icon">
            <FlaskIcon size={22} colour="var(--c-primary)" />
          </div>

          <h2 style={s.formTitle}>Run the suite</h2>
          <p style={s.formSub}>
            Pick a slice, press Run, read the report. Four roles may do different amounts of that.
          </p>

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
              autoFocus
              placeholder="Enter dashboard password"
              onChange={(e) => setPassword(e.target.value)}
              style={{
                ...s.input,
                borderColor: error ? '#fca5a5' : c.border,
                background: error ? '#fff5f5' : c.input,
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

          {error && <p style={s.error}>{error}</p>}

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

          {hints ? (
            <div style={s.hint}>
              <div style={s.hintTitle}>
                {hints.mode === 'full' ? 'Simulation mode' : 'Try it — demo role'}
              </div>
              <div style={s.hintRows}>
                {Object.entries(hints.passwords).map(([role, value]) => (
                  <div key={role} style={s.hintRow}>
                    <code style={s.code}>{value}</code>
                    <span style={{ color: c.t5 }}>→</span>
                    <span style={{ color: c.t3 }}>{role}</span>
                  </div>
                ))}
              </div>
              <p style={s.hintNote}>
                {hints.mode === 'full'
                  ? 'Each role sees and may do different things.'
                  : 'This deployment is real — demo always simulates its runs, and cannot see or affect anyone else’s.'}
              </p>
            </div>
          ) : (
            <p style={s.restricted}>Access restricted to authorised team members</p>
          )}
        </form>
      </main>
    </div>
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
  outer: { minHeight: '100vh', display: 'flex' },

  left: {
    /*
     * Capped, not just proportional. At 42% of a 1900px window the panel is
     * ~800px holding 400px of text, so a third of it is empty blue and the
     * two halves' content drifts apart as the screen grows. The cap holds the
     * panel at a width its content actually fills.
     */
    width: '42%',
    minWidth: 320,
    maxWidth: 560,
    background: brandPanelBackground,
    display: 'flex',
    alignItems: 'center',
    /* Centres the content block in the panel, the way the form is centred in
     * its own column — one alignment rule across the split rather than two. */
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  // Oversized, low-opacity circles bleeding off the edges. Barely visible on
  // their own; they stop the panel reading as a flat block.
  circle: {
    position: 'absolute',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.025)',
    pointerEvents: 'none',
  },
  leftInner: {
    /* Padding scales with the panel rather than being crushed to nothing:
     * at 900px the content block was reaching both of the panel's edges. */
    padding: '40px clamp(28px, 9%, 48px)',
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 496,
  },

  brandIcon: {
    width: 68,
    height: 68,
    background: 'rgba(255,255,255,0.14)',
    borderRadius: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  brandTitle: {
    fontSize: 30,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
  },
  brandSub: { margin: '10px 0 0', color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: 300 },
  divider: {
    width: 48,
    height: 3,
    background: 'rgba(255,255,255,0.28)',
    borderRadius: 2,
    margin: '28px 0',
  },
  brandNote: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    lineHeight: 1.75,
    fontWeight: 300,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    marginTop: 30,
    padding: '10px 18px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 999,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#4ade80',
    animation: 'pulse-dot 1.6s ease-in-out infinite',
  },

  right: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    /*
     * Left, not centre. Centring the form in an unbounded column pushes it
     * further from the panel the wider the window gets — at 1850px it sat
     * 475px out, adrift in empty space. Anchoring it to the start keeps the
     * two halves' content a fixed distance apart at every width; `padding`
     * is that distance.
     */
    justifyContent: 'flex-start',
    padding: '32px clamp(48px, 7vw, 120px)',
    background: c.bg,
  },
  form: { width: '100%', maxWidth: 340, animation: 'fade-in 0.35s ease' },

  formIcon: {
    width: 46,
    height: 46,
    background: c.primaryLight,
    border: `1px solid ${c.primaryBorder}`,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  /* The way in for anyone who came to look rather than to work. */
  demo: {
    width: '100%',
    padding: '11px 16px',
    background: c.primary,
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    font: 'inherit',
    fontSize: 14.5,
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: 18,
  },
  submitQuiet: {
    background: 'transparent',
    border: `1px solid ${c.border}`,
    color: c.t2,
  },
  or: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 },
  orLine: { flex: 1, height: 1, background: c.border },
  orText: { fontSize: 12, color: c.t5 },

  formTitle: { fontSize: 28, fontWeight: 700, color: c.t1, letterSpacing: '-0.02em' },
  formSub: { margin: '6px 0 30px', color: c.t4, fontSize: 15, fontWeight: 300 },

  label: { display: 'block', fontSize: 13, fontWeight: 500, color: c.t2, marginBottom: 8 },
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
    padding: '13px 42px 13px 38px',
    border: `1.5px solid ${c.border}`,
    borderRadius: 10,
    color: c.t1,
    font: 'inherit',
    fontSize: 14.5,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  reveal: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: c.t5,
    cursor: 'pointer',
    display: 'flex',
    padding: 4,
  },
  error: { color: '#dc2626', fontSize: 13, marginTop: 10 },

  submit: {
    width: '100%',
    marginTop: 22,
    padding: '13px 16px',
    background: c.primary,
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    font: 'inherit',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    boxShadow: '0 2px 8px rgba(79,107,237,0.28)',
  },
  spinner: {
    width: 15,
    height: 15,
    border: '2px solid rgba(255,255,255,0.35)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    display: 'inline-block',
  },

  hint: {
    marginTop: 26,
    padding: '14px 16px',
    background: c.card,
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.primary}`,
    borderRadius: 10,
  },
  hintTitle: { fontSize: 13, fontWeight: 600, color: c.t1 },
  hintRows: { display: 'flex', flexDirection: 'column', gap: 6, margin: '11px 0 0' },
  hintRow: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 },
  code: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: '2px 8px',
    color: c.t1,
    fontSize: 12.5,
    fontFamily: 'ui-monospace, monospace',
  },
  hintNote: { margin: '11px 0 0', fontSize: 12, color: c.t5 },
  restricted: { marginTop: 22, fontSize: 13, color: c.t5, textAlign: 'center' },
}
