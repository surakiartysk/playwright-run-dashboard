import { useState, type CSSProperties } from 'react'
import { api } from '../api'
import { c } from '../theme'
import { ProjectLinks } from './ProjectLinks'
import { AccountChooser } from './AccountChooser'

/**
 * Sign in — one column, centred, nothing beside it (decision 52).
 *
 * Two ways in, and both are the demo. "Log in to demo" is the one most
 * visitors want: a sandbox of their own, signed in, one click. "Sign in with
 * Google" is a concept and says so — it is not connected to Google. It opens
 * the account chooser a real deployment would put in front of a company's
 * Google Workspace, and the whitelist check behind it is real: the account
 * that is on no list is refused.
 *
 * There are no passwords, so there is nothing here to type and nothing to
 * leak.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)

  async function demo() {
    setBusy(true)
    setError(null)
    try {
      await api.demo()
      onSignedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the demo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={s.page}>
      <div style={s.form}>
        <div style={s.mark}>
          <FlaskIcon size={28} colour="var(--c-on-primary)" />
        </div>

        <h1 style={s.title}>Test Run Dashboard</h1>
        <p style={s.sub}>Run a suite on a branch, then read its report.</p>
        <ProjectLinks style={{ textAlign: 'center', margin: '-14px 0 24px' }} />

        <div style={s.card}>
          <button type="button" onClick={() => void demo()} disabled={busy} style={s.demo}>
            {busy ? 'Making your sandbox…' : 'Log in to demo →'}
          </button>
          <p style={s.note}>
            A sandbox of your own for a day. Every run is simulated; the real runs from the
            suites&rsquo; CI are shown beside yours.
          </p>

          <div style={s.or}>
            <span style={s.orLine} />
            <span style={s.orText}>or</span>
            <span style={s.orLine} />
          </div>

          <button
            type="button"
            onClick={() => setChoosing(true)}
            disabled={busy}
            style={s.google}
            aria-haspopup="dialog"
          >
            <GoogleMark /> Sign in with Google
            <span style={s.concept}>concept</span>
          </button>
          <p style={s.note}>
            Not connected to Google. It shows how a company sign-in would look: pick an account, and
            only the ones on the list get in.
          </p>

          {error && (
            <p role="alert" style={s.error}>
              {error}
            </p>
          )}
        </div>
      </div>

      {choosing && (
        <AccountChooser
          onClose={() => setChoosing(false)}
          onSignedIn={() => {
            setChoosing(false)
            onSignedIn()
          }}
        />
      )}
    </main>
  )
}

/** Four colours, no logo file: a mark that reads as Google without copying it. */
export const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
    <circle
      cx="8"
      cy="8"
      r="7"
      fill="none"
      stroke="#4285F4"
      strokeWidth="2"
      strokeDasharray="11 33"
    />
    <circle
      cx="8"
      cy="8"
      r="7"
      fill="none"
      stroke="#EA4335"
      strokeWidth="2"
      strokeDasharray="11 33"
      strokeDashoffset="-11"
    />
    <circle
      cx="8"
      cy="8"
      r="7"
      fill="none"
      stroke="#FBBC05"
      strokeWidth="2"
      strokeDasharray="11 33"
      strokeDashoffset="-22"
    />
    <circle
      cx="8"
      cy="8"
      r="7"
      fill="none"
      stroke="#34A853"
      strokeWidth="2"
      strokeDasharray="11 33"
      strokeDashoffset="-33"
    />
  </svg>
)

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
    fontSize: 22,
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
  },
  google: {
    width: '100%',
    minHeight: 46,
    padding: '10px 16px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 10,
    color: c.t1,
    font: 'inherit',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  concept: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: c.t4,
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    padding: '1px 6px',
  },
  note: { margin: '8px 2px 0', color: c.t4, fontSize: 13, lineHeight: 1.45 },
  or: { display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' },
  orLine: { flex: 1, height: 1, background: c.border },
  orText: { fontSize: 13, color: c.t4, fontWeight: 600 },
  error: { color: c.danger, fontSize: 13, marginTop: 12 },
}
