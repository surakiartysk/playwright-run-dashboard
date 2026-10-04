import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { api, SUITES, SUITE_LABELS, type Role, type RolePolicy, type Suite } from '../api'
import { c, mono, status } from '../theme'
import { pausedReason } from '../gate-form'
import { stepOption } from '../appearance'
import {
  SUITE_SERVICES,
  SUITE_TAGS,
  clampWorkers,
  effectiveTags,
  initialForm,
  refLocked,
  scopeLocked,
  stepWorkers,
  submitRun,
  withSuite,
  type RunForm,
} from '../run-form'
import { useCompact } from '../use-compact'
import { Icon, type IconName } from './Icon'

/**
 * The form that starts a run.
 *
 * Options are constrained to what the current role may actually do — the ref
 * list and the worker ceiling come from the same policy table the API
 * enforces. Offering a choice the server will reject is a worse experience
 * than not offering it, and re-deriving the rules here would let the two drift.
 *
 * The server still validates. This is a convenience, not a control.
 *
 * Laid out as a command bar rather than a form: a row of choices that reads
 * left to right as the sentence it sends ("API, items, all, main, 2 workers")
 * and ends in the button. A choice that is not available stays on screen
 * locked, with the reason as its tooltip, rather than disappearing — the
 * form is the same shape whatever the role or the service.
 */

const SUITE_ICON: Record<Suite, IconName> = { api: 'braces', ui: 'monitor' }

export function RunTrigger({
  policy,
  role,
  simulates,
  onStarted,
  initial,
}: {
  policy: RolePolicy
  role: Role
  /** Whether a run started here is simulated — said before Run, not after. */
  simulates: boolean
  onStarted: () => void
  /** What the form opens on, where it should not be the API suite's `items`. */
  initial?: Partial<RunForm>
}) {
  const compact = useCompact()
  const [form, setForm] = useState<RunForm>(() => initialForm(policy.maxWorkers, initial))
  const { suite, service, tags, ref, workers } = form
  const set = (change: Partial<RunForm>) => setForm((f) => ({ ...f, ...change }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<string | null>(null)
  const [gate, setGate] = useState<{ opensAt: string | null; updatedBy: string | null } | null>(
    null,
  )

  /**
   * The gate, read up front rather than discovered by pressing Run.
   *
   * The server refuses either way — this only decides whether the reader finds
   * out before or after they try. A disabled button with a reason beside it is
   * the difference between "paused until 14:00" and "the button is broken".
   *
   * Keyed on the role: switching from a gated role to an ungated one has to
   * re-read it, or QA inherits the warning a developer was shown. That is not
   * hypothetical — it is what this did before the role was a dependency.
   */
  useEffect(() => {
    api
      .gate()
      .then((g) =>
        setGate(
          g.appliesToYou && g.state === 'closed'
            ? { opensAt: g.opensAt, updatedBy: g.updatedBy }
            : null,
        ),
      )
      .catch(() => setGate(null))
  }, [role])

  // Branches of the SUITE, not of the product under test — `main` is the
  // reviewed suite, `develop` is the one QA is still writing. Labelled
  // "Suite branch" for that reason: "Branch" alone reads as the caller's own
  // branch, which this has never been.
  //
  // `*` means any branch; offer the common ones rather than a free-text field
  // nobody wants to type into.
  const refs = policy.allowedRefs.includes('*')
    ? ['main', 'develop', 'release', 'feature/example']
    : policy.allowedRefs

  async function start() {
    setBusy(true)
    setError(null)
    setStarted(null)
    try {
      // Said in words: before this, the only sign anything happened was a
      // count in the list going up by one.
      setStarted(await submitRun(form, api.createRun))
      onStarted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run')
    } finally {
      setBusy(false)
    }
  }

  const scopeIsLocked = scopeLocked(service)
  const refIsLocked = refLocked(refs)
  const blocked = busy || gate !== null

  return (
    <section style={s.card} aria-label="New run">
      <header style={s.head}>
        <h2 style={s.title}>New run</h2>
        <span style={s.hint}>
          {simulates
            ? 'Simulated here: no workflow runs, and Report opens a shared sample'
            : 'Runs the published suites on GitHub Actions'}
        </span>
      </header>

      <div style={s.row}>
        <SuiteChoice
          fill={compact}
          value={suite}
          onChange={(next) => setForm((f) => withSuite(f, next))}
        />

        {!compact && <span aria-hidden style={s.sep} />}

        <PillSelect
          icon="box"
          label="Service"
          fill={compact}
          value={service}
          options={SUITE_SERVICES[suite]}
          onChange={(service) => set({ service })}
        />

        <PillSelect
          icon="tag"
          label="Scope"
          fill={compact}
          mono
          // Shows the tag that will be sent, not the one last picked: a
          // locked control reading `smoke` above a note saying "all" is the
          // form contradicting itself.
          value={effectiveTags(service, tags)}
          options={SUITE_TAGS[suite]}
          onChange={(tags) => set({ tags })}
          locked={scopeIsLocked}
          lockedReason="Scope is all while one service is picked — the suite filters by service or by tag, not both."
        />

        <PillSelect
          icon="branch"
          label="Suite branch"
          fill={compact}
          mono
          value={ref}
          options={refs}
          onChange={(ref) => set({ ref })}
          locked={refIsLocked}
          lockedReason={`Suite branch: the branch of the test code, not of the app under test. ${role} may only use ${refs[0] ?? 'main'}.`}
        />

        <Workers
          fill={compact}
          value={workers}
          max={policy.maxWorkers}
          onChange={(workers) => set({ workers })}
        />

        <button
          type="button"
          onClick={() => void start()}
          disabled={blocked}
          style={{
            ...s.run,
            ...(blocked ? s.runDisabled : null),
            ...(compact ? s.runCompact : null),
          }}
        >
          {busy ? (
            <>
              <Icon name="running" size={16} style={{ animation: 'spin 1.1s linear infinite' }} />
              Starting…
            </>
          ) : (
            <>
              <Icon name="play" size={16} />
              Run
            </>
          )}
        </button>
      </div>

      {/*
        Said here as well as in the locked control's tooltip: a tooltip is a
        hover layer, and there is no hover on a phone. Naming the constraint is
        what stops someone picking a service, seeing their tag lock, and
        assuming the form lost it.
      */}
      {scopeIsLocked && (
        <p style={s.fieldNote}>
          <Icon name="info" size={14} />
          <span>
            Scope is <span style={mono}>all</span> while one service is picked — the suite filters
            by service or by tag, not both.
          </span>
        </p>
      )}

      {/* Built by `pausedReason` rather than inline, so what it says is
          testable without rendering — see gate-form.ts. */}
      {gate && (
        <Banner tone="wait" icon="pause">
          {pausedReason(gate)}
        </Banner>
      )}
      {error && (
        <Banner tone="bad" icon="alert" alert>
          {error}
        </Banner>
      )}
      {started && (
        <Banner tone="ok" icon="check">
          {started}
        </Banner>
      )}
    </section>
  )
}

/**
 * API or UI, as two buttons that behave as one control.
 *
 * Two options do not need a menu: both are visible, one press chooses, and the
 * arrow keys move between them the way they do in a radio group — one stop for
 * Tab, which is what a keyboard reader expects of a pair of mutually exclusive
 * choices.
 */
function SuiteChoice({
  value,
  onChange,
  fill,
}: {
  value: Suite
  onChange: (next: Suite) => void
  fill: boolean
}) {
  const refs = useRef(new Map<Suite, HTMLButtonElement>())

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = stepOption(SUITES, value, e.key)
    if (next === value) return
    e.preventDefault()
    onChange(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Suite"
      style={{ ...s.suite, ...(fill ? s.fillWide : null) }}
      onKeyDown={onKeyDown}
    >
      {SUITES.map((id) => {
        const on = id === value
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(id, el)
              else refs.current.delete(id)
            }}
            onClick={() => onChange(id)}
            style={{
              ...s.suiteOption,
              ...(on ? s.suiteOptionOn : null),
              ...(fill ? s.suiteOptionFill : null),
            }}
          >
            <Icon name={SUITE_ICON[id]} size={17} />
            {SUITE_LABELS[id]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A native `<select>` dressed as one option of the command bar.
 *
 * Native, because it is the control a phone knows how to open and a screen
 * reader knows how to read; only the chrome is drawn here, with the arrow
 * replaced by a lock when the choice is not available. Locked is `disabled`,
 * not hidden, and the reason is its tooltip and part of its name.
 */
function PillSelect({
  icon,
  label,
  value,
  options,
  onChange,
  locked = false,
  lockedReason,
  mono: useMono = false,
  fill = false,
}: {
  icon: IconName
  label: string
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  locked?: boolean
  lockedReason?: string
  mono?: boolean
  fill?: boolean
}) {
  return (
    <span
      style={{ ...s.pill, ...(locked ? s.pillLocked : null), ...(fill ? s.fillHalf : null) }}
      title={locked ? lockedReason : label}
    >
      <Icon name={icon} size={17} style={s.pillIcon} />
      <select
        aria-label={locked && lockedReason ? `${label}: ${value} (locked). ${lockedReason}` : label}
        value={value}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...s.select, ...(useMono ? mono : null), ...(fill ? s.selectFill : null) }}
      >
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <Icon name={locked ? 'lock' : 'down'} size={locked ? 14 : 15} style={s.pillEnd} />
    </span>
  )
}

/** The worker count as − 2 / 8 +, so it can only ever be a number the API takes. */
function Workers({
  value,
  max,
  onChange,
  fill,
}: {
  value: number
  max: number
  onChange: (next: number) => void
  fill: boolean
}) {
  const shown = clampWorkers(value, max)
  return (
    <span
      role="group"
      aria-label={`Workers, ${shown} of at most ${max}`}
      title={`Workers · max ${max}`}
      style={{ ...s.workers, ...(fill ? s.fillHalf : null) }}
    >
      <Icon name="cpu" size={17} style={s.pillIcon} />
      <button
        type="button"
        aria-label="Fewer workers"
        disabled={shown <= 1}
        onClick={() => onChange(stepWorkers(shown, -1, max))}
        style={s.step}
      >
        <Icon name="minus" size={14} />
      </button>
      <span style={s.workerCount}>
        <span style={mono}>{shown}</span>
        <small style={s.workerMax}>/{max}</small>
      </span>
      <button
        type="button"
        aria-label="More workers"
        disabled={shown >= max}
        onClick={() => onChange(stepWorkers(shown, 1, max))}
        style={s.step}
      >
        <Icon name="plus" size={14} />
      </button>
    </span>
  )
}

/**
 * A line that says what happened, in the colour of what it is.
 *
 * Text stays a theme colour with the tone on the tint and the icon: the green
 * that marks a pass is too light to be text on white, and the icon and the
 * words say the same thing so the colour is never carrying it alone. An error
 * is an alert so it is read out when it appears; the rest are polite.
 */
function Banner({
  tone,
  icon,
  alert = false,
  children,
}: {
  tone: 'wait' | 'bad' | 'ok'
  icon: IconName
  alert?: boolean
  children: React.ReactNode
}) {
  const look = BANNER[tone]
  return (
    <div
      role={alert ? 'alert' : 'status'}
      style={{ ...s.banner, background: look.bg, color: look.text }}
    >
      <Icon name={icon} size={17} style={{ color: look.icon }} />
      <span>{children}</span>
    </div>
  )
}

const BANNER = {
  wait: { bg: status.pendingBg, text: c.warn, icon: c.warn },
  bad: { bg: c.dangerBg, text: c.danger, icon: c.danger },
  ok: { bg: status.passBg, text: c.t2, icon: status.pass },
} as const

const control: CSSProperties = { height: 44, borderRadius: 10, border: `1px solid ${c.border}` }

const s: Record<string, CSSProperties> = {
  card: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    padding: '2px 4px 0',
  },
  title: { fontSize: 15, fontWeight: 650, margin: 0 },
  hint: { fontSize: 12, color: c.t5 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  sep: { width: 1, height: 24, background: c.border, margin: '0 2px' },

  suite: {
    ...control,
    display: 'inline-flex',
    alignItems: 'stretch',
    padding: 3,
    gap: 3,
    background: c.input,
  },
  suiteOption: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 14px',
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: c.t4,
    font: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  suiteOptionOn: { background: c.card, color: c.t1, boxShadow: `0 0 0 1px ${c.border}` },

  pill: {
    ...control,
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    background: c.input,
  },
  pillLocked: { background: c.surface },
  pillIcon: { position: 'absolute', left: 12, color: c.t4, pointerEvents: 'none' },
  pillEnd: { position: 'absolute', right: 11, color: c.t5, pointerEvents: 'none' },
  select: {
    appearance: 'none',
    WebkitAppearance: 'none',
    height: '100%',
    padding: '0 34px 0 38px',
    background: 'transparent',
    border: 'none',
    borderRadius: 10,
    color: c.t1,
    font: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },

  workers: {
    ...control,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: '0 4px 0 38px',
    position: 'relative',
    background: c.input,
  },
  step: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: c.t3,
    cursor: 'pointer',
  },
  workerCount: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 2,
    minWidth: 34,
    justifyContent: 'center',
    fontSize: 15,
    fontWeight: 600,
    color: c.t1,
  },
  workerMax: { fontSize: 11.5, color: c.t5, fontWeight: 500 },

  run: {
    ...control,
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 22px',
    background: c.primary,
    border: 'none',
    color: c.onPrimary,
    font: 'inherit',
    fontSize: 15,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  // On a phone the button is the whole row: the thing most pressed is the
  // thing easiest to hit.
  // Narrow: each choice takes a share of the row instead of its own width, so
  // the rows come out even rather than ragged.
  fillWide: { flex: '1 1 100%' },
  fillHalf: { flex: '1 1 calc(50% - 4px)', minWidth: 0 },
  suiteOptionFill: { flex: 1, justifyContent: 'center' },
  selectFill: { width: '100%' },
  runCompact: { flex: '1 1 100%', marginLeft: 0 },
  runDisabled: { background: c.surface, color: c.t4, cursor: 'not-allowed' },

  fieldNote: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    padding: '0 4px',
    fontSize: 12,
    color: c.t4,
    lineHeight: 1.45,
  },
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.4,
  },
}
