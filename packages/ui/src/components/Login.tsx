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
 * hunting for is a demo nobody sees. There are four of them and choosing
 * between the roles is the point, so the list earns its space.
 *
 * On a real deployment there is only `demo`, and the button above already
 * signs in with it — so the list is not printed there. It would be the same
 * instruction twice, with the second one asking the reader to type by hand
 * what the first does in a click.
 */
export function Login({ onSignedIn }: { onSignedIn: (role: Role) => void }) {
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hints, setHints] = useState<{
    passwords: Record<string, string>
  } | null>(null)

  useEffect(() => {
    api
      .devCredentials()
      .then((r) => setHints({ passwords: r.passwords }))
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
        <div style={s.rightInner}>
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

            {/*
              Nothing below the button unless there is nothing above it.

              This carried a password table, then a sentence about which
              deployment the visitor had landed on and what demo could reach.
              Both were answers to questions nobody asks at a sign-in screen:
              the button says what to press, and the limits explain themselves
              at the moment they apply — the run cap names itself in the error
              it returns, and the role's scope is on the dashboard behind it.

              The one case that still needs a line is a screen offering no way
              in at all, where silence would read as broken rather than closed.
            */}
            {!hints && <p style={s.restricted}>Access restricted to authorised team members</p>}
          </form>
        </div>
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
  /*
   * Full-bleed, deliberately.
   *
   * Capping the split and centring it looked balanced in the measurements and
   * wrong on screen: the right half shares the page background, so the only
   * thing with a distinct surface was the blue panel, and the whole page read
   * as a narrow coloured stripe with text floating beside it rather than as a
   * login screen.
   *
   * So the split fills the window, and the drift that started all of this is
   * solved where it belongs — on the content inside the right half, not by
   * shrinking the page around it. See `right`.
   */
  outer: { minHeight: '100vh', display: 'flex' },

  left: {
    /*
     * Unequal on purpose — 55/45, not an even split.
     *
     * A 50/50 split gives the two halves the same visual weight and reads as
     * two panes rather than one screen with a subject. The panel is the page's
     * identity and carries the gradient; the form is a short column of controls
     * that needs about 340px whatever the window does. Giving the panel the
     * larger share says which one leads, and the ratio stays close enough to
     * even that neither half looks starved.
     *
     * Deliberately uncapped. A 560px cap once held the panel at 30% of a wide
     * window against a 70% right half, which read as a coloured stripe beside
     * a lot of dark nothing; the empty blue that cap was guarding against is
     * handled by centring the panel's own content instead.
     */
    width: '55%',
    minWidth: 320,
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
  /*
   * The panel's text column, matched to the form's.
   *
   * Both halves were already symmetric inside themselves — 133px either side
   * of this block, 254px either side of the form — and that was the problem:
   * two different insets. The left content started much nearer its edge than
   * the right did, so the panel read as pushed left against a form that looked
   * comfortably placed, even though neither was misaligned on its own.
   *
   * Widening this column to the same 340px measure the form uses puts the two
   * text blocks at a comparable distance from their edges, which is what makes
   * the split read as one layout rather than two.
   */
  leftInner: {
    /*
     * Sized so the prose actually reaches the right edge.
     *
     * At 360px every line started on the left margin and stopped somewhere
     * different — the title 82px short of the edge, the subtitle 200px, the
     * pill 215px. Left-aligned text in a box wider than the text is a ragged
     * right edge and a column of white space down one side, which is what
     * reads as "the text is pushed left" no matter where the box itself sits.
     *
     * The form opposite is left-aligned too and does not look it, because its
     * button, input and panel are full width and all end on the same line. The
     * panel has no such element, so the measure has to do that work: at 320px
     * the note wraps to fill it and the block gains a right edge for the
     * shorter lines to be read against.
     */
    padding: '40px 0',
    position: 'relative',
    zIndex: 1,
    width: 'min(100% - 56px, 320px)',
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
    /* Clearly larger than the form's 28px heading, not a hair's breadth from
     * it: two headings a couple of pixels apart read as a tie rather than a
     * hierarchy, and this one names the product while that one labels a task. */
    fontSize: 34,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
  },
  brandSub: { margin: '10px 0 0', color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: 300 },
  /*
   * Full width, not a 48px stub.
   *
   * The panel's lines all begin on the left margin and end wherever the words
   * happen to stop, which is what makes left-aligned text read as "pushed
   * left" — there is no right edge to measure them against. The form opposite
   * has one for free: its button, input and its own `or sign in` rule are all
   * full width. This rule is the panel's equivalent, and it costs nothing
   * because the element was already there.
   */
  divider: {
    width: '100%',
    height: 1,
    background: 'rgba(255,255,255,0.16)',
    margin: '26px 0',
  },
  brandNote: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    lineHeight: 1.75,
    fontWeight: 300,
  },
  /*
   * Spans the column rather than hugging its label.
   *
   * As an `inline-flex` chip it ended 175px short of the column's right edge,
   * which — with the subtitle also stopping early — left the block's right
   * side ragged even after the rule above gave it an edge. Full width, it
   * closes the block at the bottom the way the rule opens it, and the status
   * dot stays left where the eye already is.
   *
   * `space-between` rather than centred: the dot and its label belong
   * together on the left, and centring them in a wide bar would separate the
   * pair from everything above it.
   */
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginTop: 30,
    padding: '11px 18px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
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
     * Centred within a bounded content column, not within the whole half.
     *
     * On a wide monitor the right half is enormous, and centring the form in
     * all of it pushed it far from the panel. `rightInner` caps the space the
     * form is centred in, so it sits a short, even distance from the split at
     * any width while the surface behind it still fills the window.
     */
    justifyContent: 'center',
    padding: '32px 40px',
    background: c.bg,
  },
  rightInner: { width: '100%', maxWidth: 440, display: 'flex', justifyContent: 'center' },
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

  restricted: { marginTop: 22, fontSize: 13, color: c.t5, textAlign: 'center' },
}
