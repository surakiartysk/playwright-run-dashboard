import type { RunOptions, Suite, SuiteOptions } from './api'

/**
 * What the New run form holds: which suite, the slice of it, and how to run it.
 *
 * `service` and `tags` are two independent choices that combine — the tests of
 * that service carrying that tag. `all` in either means "no narrowing on this
 * side". That is a real request now: the suites' workflows take a second input
 * for the tag (decision 30). It used to be impossible, because the suites
 * filtered on one axis and the form had to hide the other.
 */
export interface RunForm {
  suite: Suite
  service: string
  tags: string
  ref: string
  workers: number
  /**
   * What a simulated run comes back as. Held only where runs are simulated and
   * absent for a real one: the API refuses `pass` and `fail` there rather than
   * ignoring them, and a request that omits it is the one a real run takes.
   */
  outcome?: Outcome
}

/**
 * How a simulated run ends: every test passes, or a few fail. The values are
 * the API's own (`POST /runs` takes `outcome`).
 *
 * There is no third entry for "leave it to chance". The API still has one, as
 * what a caller that sends nothing gets, but nobody who opens the form wants
 * to be told that a run is a coin toss: they want to see a green run, or to see
 * what a red one shows.
 */
export type Outcome = 'pass' | 'fail'

export const OUTCOME_CHOICES: readonly { value: Outcome; label: string }[] = [
  { value: 'pass', label: 'Passes, every test' },
  { value: 'fail', label: 'Fails, 1 to 3 tests' },
]

/*
 * What each suite can be sliced by, and which branches may be picked, is the
 * API's to say (`GET /runs/options`), not the form's. The lists were written
 * out here, in the contract test and in the API; they are in the API now, and
 * what is below takes them as an argument.
 *
 * Two suites, two vocabularies: the API suite runs services, the UI suite runs
 * journey groups. Offering one the other's names sends a slice that matches
 * nothing. `all` comes first and is how "no narrowing on this side" is said.
 */

/**
 * What the form selects after the suite changes.
 *
 * Without this, choosing UI while `reservations` is selected sends a service
 * the UI suite has never heard of, and the run matches nothing. So whatever the
 * new suite does not offer is replaced by what it does: the first real service
 * (not `all`, which is the one a reader picks on purpose), its first tag, and —
 * since each suite is its own repository with its own branches — a branch it
 * has, when the one selected is not among them.
 */
export function afterSuiteChange(
  next: Suite,
  current: { service: string; tags: string; ref: string },
  catalogue: Record<Suite, SuiteOptions>,
): { service: string; tags: string; ref: string } {
  const { services, tags, refs } = catalogue[next]
  return {
    service: services.includes(current.service) ? current.service : (services[1] ?? 'all'),
    tags: tags.includes(current.tags) ? current.tags : (tags[0] ?? 'all'),
    ref: refs.includes(current.ref) ? current.ref : (refs[0] ?? current.ref),
  }
}

/** One branch on offer is not a choice. `demo` and `dev` may only use `main`. */
export const refLocked = (refs: readonly string[]): boolean => refs.length <= 1

/**
 * A worker count the API will take: a whole number from 1 to the role's limit.
 *
 * The count used to be a number field read with `Number(value)`, so clearing it
 * sent 0 and typing past the limit sent the excess to a server that refuses it.
 * A stepper cannot do either, but a count that came from anywhere else gets the
 * same treatment: anything that is not a number is the minimum, not NaN.
 */
export function clampWorkers(value: number, max: number): number {
  const ceiling = Math.max(1, Math.trunc(max))
  if (!Number.isFinite(value)) return 1
  return Math.min(ceiling, Math.max(1, Math.trunc(value)))
}

/** Move the count by one, stopping at both ends. */
export const stepWorkers = (current: number, delta: 1 | -1, max: number): number =>
  clampWorkers(current + delta, max)

/** The first count offered: four, or fewer if the role may not use four. */
export const defaultWorkers = (max: number): number => clampWorkers(4, max)

/** What the form says once a run has been accepted, before the list shows it. */
export const startedMessage = (simulated: boolean): string =>
  simulated
    ? 'Started a simulated run — it is in Recent runs below.'
    : 'Started — the run is in Recent runs below.'

/**
 * The selection the form opens on: the API suite's `items` where it has one,
 * otherwise the first real service, on `main` where the caller may use it.
 *
 * Built from what the caller was offered, so a form never opens on a choice its
 * own dropdowns do not contain.
 */
export function initialForm(options: RunOptions, over: Partial<RunForm> = {}): RunForm {
  const api = options.suites.api
  return {
    suite: 'api',
    service: api.services.includes('items') ? 'items' : (api.services[1] ?? 'all'),
    tags: 'all',
    ref: api.refs.includes('main') ? 'main' : (api.refs[0] ?? 'main'),
    // Green to start with, and only where there is a choice to make.
    ...(options.simulated ? { outcome: 'pass' as const } : null),
    ...over,
    workers: clampWorkers(over.workers ?? defaultWorkers(options.maxWorkers), options.maxWorkers),
  }
}

/** The form after the suite is switched, with what that suite lacks replaced. */
export function withSuite(
  form: RunForm,
  next: Suite,
  catalogue: Record<Suite, SuiteOptions>,
): RunForm {
  return { ...form, suite: next, ...afterSuiteChange(next, form, catalogue) }
}

/**
 * Send the form and say what happened, with `post` injected so what goes over
 * the wire is testable without a network.
 *
 * What is posted is a copy of the selection, field for field: the API takes the
 * service and the tag as two things and so does the form. A copy, not the state
 * object itself, so what was sent cannot change under a later keystroke.
 */
export async function submitRun(
  form: RunForm,
  post: (body: RunForm) => Promise<{ simulated: boolean }>,
): Promise<string> {
  const run = await post({ ...form })
  return startedMessage(run.simulated)
}

/**
 * What pressing Run will run, in a sentence.
 *
 * Two dropdowns that combine are easy to misread — "items" and "@smoke" could
 * be a union or an intersection — so the form says which. It also says the one
 * thing it cannot know: whether any test carries both. The tags live in the
 * suites' specs and the dashboard cannot see them, so a pair nothing matches
 * is a run the suite fails with "No tests found", and the sentence is where
 * that is said before the button is pressed rather than after.
 */
export function describeSelection(form: Pick<RunForm, 'suite' | 'service' | 'tags'>): string {
  const everyService = form.service === 'all'
  const everyTag = form.tags === 'all'
  const what = serviceLabel(form.suite, form.service)
  const tag = scopeLabel(form.tags)

  if (everyService && everyTag) return 'Runs every test in the suite.'
  if (everyTag) return `Runs the ${what} tests.`
  if (everyService) return `Runs every test tagged ${tag}.`
  return `Runs the ${what} tests that are also tagged ${tag}. If none carry both, the run fails with “No tests found”.`
}

/**
 * What the form calls each choice, apart from what it sends.
 *
 * The values are the suites' own names (`maintenance-logs`, `smoke`) and go to
 * the API unchanged; only the words on screen are rewritten. A hyphenated
 * identifier is how a machine names a thing, and showing it as the label
 * makes the form read like a config file.
 */
export interface Choice {
  value: string
  label: string
}

/** "maintenance-logs" as "Maintenance logs". */
const sentence = (id: string): string => {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The API suite is sliced by service and the UI suite by journey, so "all" is
 * every service in one and every journey in the other. Saying "services" of a
 * suite that has none is how the form would mislead before anyone picked.
 */
export const serviceFieldLabel = (suite: Suite): string => (suite === 'ui' ? 'Journey' : 'Service')

export const serviceLabel = (suite: Suite, id: string): string =>
  id === 'all' ? (suite === 'ui' ? 'All journeys' : 'All services') : sentence(id)

/** A tag is shown the way it is written in the specs, `@smoke`, which is also how it is searched. */
export const scopeLabel = (id: string): string => (id === 'all' ? 'All tests' : `@${id}`)

export const serviceChoices = (suite: Suite, catalogue: Record<Suite, SuiteOptions>): Choice[] =>
  catalogue[suite].services.map((value) => ({ value, label: serviceLabel(suite, value) }))

export const scopeChoices = (suite: Suite, catalogue: Record<Suite, SuiteOptions>): Choice[] =>
  catalogue[suite].tags.map((value) => ({ value, label: scopeLabel(value) }))

/**
 * How a recorded run's tag reads in the history: `@smoke`, or nothing.
 *
 * A run of a whole service stores the tag `all`, which means "no tag" and read
 * as `items @all` in every row, tooltip and newest-run line — a tag nobody
 * wrote. Now that a service and a tag are both real, the tag is shown when
 * there is one and left out when there is not.
 */
export const runTag = (tags: string): string | null => (tags === 'all' ? null : `@${tags}`)

/**
 * Why the branch cannot be changed, said so as to be true however it came about.
 *
 * One branch on offer is one of two situations: the role may only use one, or
 * the role may use more and the suite's repository has only that one. The form
 * is not told which, and a sentence naming either would be wrong in the other
 * case — so it says what is the same in both: that is the only one available to
 * this caller, here.
 */
export const refLockedReason = (role: string, refs: readonly string[]): string =>
  `Suite branch: the branch of the test code, not of the app under test. ` +
  (refs[0]
    ? `Only ${refs[0]} is available to ${role} here.`
    : `No branch is available to ${role} here.`)
