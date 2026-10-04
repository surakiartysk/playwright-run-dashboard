import { useState, type CSSProperties } from 'react'
import { api, type Role } from '../api'
import { optionsCurl, runCurl } from '../curl'
import type { RunForm } from '../run-form'
import { c, mono } from '../theme'
import { CopyButton } from './CopyButton'

/**
 * The form's request as a command, for anyone who would rather script it.
 *
 * What it shows is what pressing Run would send, so changing a dropdown above
 * changes the command. A demo visitor can mint a sandbox key here, copy it from
 * its own field, and paste a command into a terminal — the one part of the
 * product that is not a page. The key is the demo role's own: it can only
 * simulate, it expires after a day, and it is rate limited. Once it exists it is
 * written into the commands, so a copy of either runs as it is.
 *
 * Everyone else uses a key an admin issued, which this does not touch.
 */

type Sandbox = Awaited<ReturnType<typeof api.createSandboxKey>>

export function ApiSnippet({
  form,
  role,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
}: {
  form: RunForm
  role: Role
  origin?: string
}) {
  const [sandbox, setSandbox] = useState<Sandbox | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function mint() {
    setBusy(true)
    setError(null)
    try {
      setSandbox(await api.createSandboxKey())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make a key')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SnippetView
      form={form}
      role={role}
      origin={origin}
      sandbox={sandbox}
      busy={busy}
      error={error}
      onMint={() => void mint()}
    />
  )
}

/** The panel for a given state, apart from the request that changes it, so each state can be rendered. */
export function SnippetView({
  form,
  role,
  origin,
  sandbox,
  busy,
  error,
  onMint,
}: {
  form: RunForm
  role: Role
  origin: string
  sandbox: Sandbox | null
  busy: boolean
  error: string | null
  onMint: () => void
}) {
  const run = runCurl(form, origin, sandbox?.key)
  const options = optionsCurl(origin, sandbox?.key)

  return (
    <details style={s.box}>
      <summary style={s.summary}>Run this from a script</summary>

      <div style={s.body}>
        {role === 'demo' ? (
          sandbox ? (
            <>
              <KeyField value={sandbox.key} />
              <p style={s.note}>
                <strong style={{ color: c.t2 }}>It is shown once.</strong> {limitsLine(sandbox)}{' '}
                Runs started with it appear below, marked “via key”.
              </p>
            </>
          ) : (
            <p style={s.note}>
              The key is yours to try: simulated runs only, never a real workflow.{' '}
              <button type="button" onClick={onMint} disabled={busy} style={s.mint}>
                {busy ? 'Making a key…' : 'Get a sandbox key'}
              </button>
            </p>
          )
        ) : (
          <p style={s.note}>
            Use a key from the admin panel’s API keys, as <code style={mono}>$RUN_KEY</code>.
          </p>
        )}

        {error && (
          <p role="alert" style={s.error}>
            {error}
          </p>
        )}

        <Command title="Start this run" text={run} />
        <Command title="See what you can ask for" text={options} />
      </div>
    </details>
  )
}

/** What the key may do, in one line a reader can check against what happens. */
export function limitsLine(key: {
  expiresAt: string
  limits: { runsPerHour: number; maxWorkers: number; refs: string[] }
}): string {
  const { runsPerHour, maxWorkers, refs } = key.limits
  return (
    `Simulated only · ${runsPerHour} runs an hour · up to ${maxWorkers} workers · ` +
    `${refs.join(', ')} only · expires ${key.expiresAt.slice(0, 16).replace('T', ' ')} UTC.`
  )
}

/** The key on its own, selectable, with a button: copy it into whatever will use it. */
function KeyField({ value }: { value: string }) {
  return (
    <div style={s.keyRow}>
      <label style={s.keyLabel} htmlFor="sandbox-key">
        Sandbox key
      </label>
      <input
        id="sandbox-key"
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        style={s.keyInput}
      />
      <CopyButton text={value} label="Copy key" />
    </div>
  )
}

function Command({ title, text }: { title: string; text: string }) {
  return (
    <div style={s.command}>
      <div style={s.commandHead}>
        <span style={s.commandTitle}>{title}</span>
        <CopyButton text={text} label="Copy" />
      </div>
      <pre style={s.pre}>{text}</pre>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  box: { borderTop: `1px solid ${c.divider}`, paddingTop: 10 },
  summary: { cursor: 'pointer', fontSize: 13, fontWeight: 600, color: c.t3, padding: '2px 4px' },
  body: { display: 'grid', gap: 10, marginTop: 10 },
  note: { margin: 0, fontSize: 12.5, color: c.t4, lineHeight: 1.5 },
  mint: {
    padding: '3px 10px',
    background: 'transparent',
    border: `1px solid ${c.border}`,
    borderRadius: 7,
    color: c.t1,
    font: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: { margin: 0, fontSize: 12.5, color: c.danger },
  keyRow: { display: 'flex', alignItems: 'center', gap: 8 },
  keyLabel: { fontSize: 12, color: c.t4, flexShrink: 0 },
  keyInput: {
    ...mono,
    flex: 1,
    minWidth: 0,
    padding: '6px 10px',
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    color: c.t2,
    fontSize: 12,
    textOverflow: 'ellipsis',
  },
  command: {
    background: c.input,
    border: `1px solid ${c.border}`,
    borderRadius: 9,
    overflow: 'hidden',
  },
  commandHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    borderBottom: `1px solid ${c.divider}`,
  },
  commandTitle: { fontSize: 11.5, color: c.t4 },
  pre: {
    ...mono,
    margin: 0,
    padding: '10px 12px',
    fontSize: 12,
    lineHeight: 1.55,
    color: c.t2,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
}
