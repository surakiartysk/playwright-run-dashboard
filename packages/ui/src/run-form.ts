import type { Suite } from './api'

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
}

/*
 * What each suite can be sliced by.
 *
 * Two suites, two vocabularies: the API suite runs services, the UI suite runs
 * journey groups. Sharing one list would offer `reservations` to a suite that
 * has no such thing — the server would accept it (the column is free-form) and
 * the run would match no tests and report a green nothing.
 *
 * Duplicated from the suites rather than fetched: these change when a suite
 * gains a service, which is rare and always accompanied by a deploy. An
 * endpoint to serve them would be a network round trip to learn a constant.
 */
export const SUITE_SERVICES: Record<Suite, string[]> = {
  api: ['all', 'items', 'reservations', 'maintenance-logs', 'core'],
  ui: ['all', 'auth', 'catalogue', 'cart', 'checkout', 'defects'],
}

/**
 * `all` first, and it is not padding.
 *
 * `all` is how "no narrowing on this side" is said, and a form that opens on it
 * runs the whole of whatever the other choice names. The workflows' `scope`
 * input takes a tag or a service; their optional `tag` input narrows it by one
 * of these (decision 30).
 */
export const SUITE_TAGS: Record<Suite, string[]> = {
  api: ['all', 'smoke', 'isolated', 'flow', 'cross-service'],
  ui: ['all', 'smoke'],
}

/**
 * What the form selects after the suite changes.
 *
 * Without this, choosing UI while `reservations` is selected sends a service
 * the UI suite has never heard of. The server accepts it, the run matches
 * nothing and reports a green zero — silently passing on a slice that does not
 * exist is the worst of the available failures. So whatever the new suite does
 * not offer is replaced by what it does: the first real service (not `all`,
 * which is the one a reader picks on purpose), and its first tag.
 */
export function afterSuiteChange(
  next: Suite,
  current: { service: string; tags: string },
): { service: string; tags: string } {
  const services = SUITE_SERVICES[next]
  const tags = SUITE_TAGS[next]
  return {
    service: services.includes(current.service) ? current.service : (services[1] ?? 'all'),
    tags: tags.includes(current.tags) ? current.tags : (tags[0] ?? 'all'),
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

/** The selection the form opens on: the API suite's `items`, on `main`. */
export function initialForm(maxWorkers: number, over: Partial<RunForm> = {}): RunForm {
  return {
    suite: 'api',
    service: 'items',
    tags: 'all',
    ref: 'main',
    ...over,
    workers: clampWorkers(over.workers ?? defaultWorkers(maxWorkers), maxWorkers),
  }
}

/** The form after the suite is switched, with what that suite lacks replaced. */
export function withSuite(form: RunForm, next: Suite): RunForm {
  return { ...form, suite: next, ...afterSuiteChange(next, form) }
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

export const serviceChoices = (suite: Suite): Choice[] =>
  SUITE_SERVICES[suite].map((value) => ({ value, label: serviceLabel(suite, value) }))

export const scopeChoices = (suite: Suite): Choice[] =>
  SUITE_TAGS[suite].map((value) => ({ value, label: scopeLabel(value) }))

/**
 * How a recorded run's tag reads in the history: `@smoke`, or nothing.
 *
 * A run of a whole service stores the tag `all`, which means "no tag" and read
 * as `items @all` in every row, tooltip and newest-run line — a tag nobody
 * wrote. Now that a service and a tag are both real, the tag is shown when
 * there is one and left out when there is not.
 */
export const runTag = (tags: string): string | null => (tags === 'all' ? null : `@${tags}`)
