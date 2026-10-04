import { SUITES, type Role, type RunOptions, type Suite } from './api'
import { serviceLabel, scopeLabel, type Choice } from './run-form'

/**
 * Narrowing the run list by what a run was: which suite, service, tag, branch,
 * how long ago, who started it, whether it was real.
 *
 * Done by the server, not over the rows that happen to be loaded. The list
 * shows a page of a longer history, and filtering a page answers a question
 * about twenty-five rows while the footer says there are ninety-one. These
 * narrow the *set*: the total, the pages and the summary beside the list all
 * describe what the filters select. The status buttons are the exception and
 * stay a view over what is loaded (see HistoryFilters.tsx).
 *
 * Kept in the address bar as a query string, so a filtered view can be linked
 * and survives a reload. `#run=<id>` is the fragment and does not collide.
 */

export type Since = '24h' | '7d' | '30d'
export const SINCE_OPTIONS: readonly { id: Since; label: string }[] = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
]

export type Provenance = 'real' | 'simulated'

export interface HistoryFilters {
  suite?: Suite
  service?: string
  tag?: string
  ref?: string
  since?: Since
  triggeredBy?: Role
  simulated?: Provenance
}

export const NO_FILTERS: HistoryFilters = {}

const ROLES: readonly Role[] = ['demo', 'dev', 'qa', 'admin']
const NAME = /^[a-z][a-z0-9-]*$/
const REF = /^[a-zA-Z0-9._\-/]+$/

/** How many filters are narrowing the list. */
export const activeCount = (f: HistoryFilters): number =>
  Object.values(f).filter((v) => v !== undefined).length

/** The query the API takes; only the filters that are set. */
export function toQuery(f: HistoryFilters): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [key, value] of Object.entries(f)) if (value !== undefined) q[key] = String(value)
  return q
}

/** The address-bar form, with its leading `?`, or nothing at all when there are no filters. */
export function toSearch(f: HistoryFilters): string {
  const q = new URLSearchParams(toQuery(f)).toString()
  return q ? `?${q}` : ''
}

/**
 * The filters an address names.
 *
 * A person can type or paste an address, so anything that is not one of the
 * values the form could have produced is dropped rather than sent: the API
 * refuses a bad filter with a 422, and a link that arrives as an error is a
 * worse welcome than a link that arrives unfiltered.
 */
export function fromSearch(search: string): HistoryFilters {
  const p = new URLSearchParams(search)
  const f: HistoryFilters = {}
  const suite = p.get('suite')
  if (suite && (SUITES as readonly string[]).includes(suite)) f.suite = suite as Suite
  const service = p.get('service')
  if (service && NAME.test(service)) f.service = service
  const tag = p.get('tag')
  if (tag && NAME.test(tag)) f.tag = tag
  const ref = p.get('ref')
  if (ref && REF.test(ref)) f.ref = ref
  const since = p.get('since')
  if (since && SINCE_OPTIONS.some((s) => s.id === since)) f.since = since as Since
  const by = p.get('triggeredBy')
  if (by && (ROLES as readonly string[]).includes(by)) f.triggeredBy = by as Role
  const simulated = p.get('simulated')
  if (simulated === 'real' || simulated === 'simulated') f.simulated = simulated
  return f
}

/**
 * Set one filter, or clear it with `undefined`.
 *
 * Choosing a suite clears a service the new suite does not have: `reservations`
 * is not a UI journey, and a list filtered to a service that suite has never
 * heard of is a list that is empty for a reason nobody can see.
 */
export function narrow(
  f: HistoryFilters,
  change: Partial<Record<keyof HistoryFilters, string | undefined>>,
  options: RunOptions | null,
): HistoryFilters {
  const next = { ...f, ...change } as HistoryFilters
  for (const key of Object.keys(next) as (keyof HistoryFilters)[]) {
    if (next[key] === undefined || next[key] === '') delete next[key]
  }
  if ('suite' in change && next.suite && next.service && options) {
    if (!options.suites[next.suite].services.includes(next.service)) delete next.service
  }
  return next
}

/**
 * Who a viewer may usefully filter by.
 *
 * Only the roles that see every run: for a developer (main only) or a demo
 * session (its own) the answer to "started by" is mostly one value, and a
 * control with one useful choice is clutter.
 */
export const canFilterByStarter = (viewing: Role): boolean =>
  viewing === 'qa' || viewing === 'admin'

/**
 * The choices each filter offers, from what the caller may run.
 *
 * The same source as the run form (`GET /runs/options`), so the history can be
 * filtered by exactly the slices that can be started — and, because the branches
 * are the caller's own, by nothing they could not have run. With no suite
 * chosen a name from either suite is offered, labelled in its own suite's words.
 */
export function facets(
  options: RunOptions,
  f: HistoryFilters,
): { services: Choice[]; tags: Choice[]; refs: Choice[] } {
  const suites = f.suite ? [f.suite] : SUITES
  const pick = (kind: 'services' | 'tags' | 'refs') => {
    const seen = new Map<string, Suite>()
    for (const suite of suites) {
      for (const id of options.suites[suite][kind]) if (!seen.has(id)) seen.set(id, suite)
    }
    return seen
  }
  return {
    services: [...pick('services')].map(([value, suite]) => ({
      value,
      label: serviceLabel(suite, value),
    })),
    tags: [...pick('tags')].map(([value]) => ({ value, label: scopeLabel(value) })),
    refs: [...pick('refs')].map(([value]) => ({ value, label: value })),
  }
}

/**
 * Each active filter as a word or two, to say the list is narrowed.
 *
 * Shown whether or not the panel is open: a list that is quietly narrowed to
 * "UI, last 24 hours" reads as a quiet dashboard, and the chips are what stop
 * a reader concluding that nothing has run.
 */
export function chips(f: HistoryFilters): { key: keyof HistoryFilters; label: string }[] {
  const out: { key: keyof HistoryFilters; label: string }[] = []
  if (f.suite) out.push({ key: 'suite', label: f.suite === 'ui' ? 'UI suite' : 'API suite' })
  if (f.service) {
    out.push({
      key: 'service',
      label: serviceLabel(f.suite ?? (UI_ONLY.has(f.service) ? 'ui' : 'api'), f.service),
    })
  }
  if (f.tag) out.push({ key: 'tag', label: scopeLabel(f.tag) })
  if (f.ref) out.push({ key: 'ref', label: `branch ${f.ref}` })
  if (f.since) {
    out.push({ key: 'since', label: SINCE_OPTIONS.find((s) => s.id === f.since)?.label ?? f.since })
  }
  if (f.triggeredBy) out.push({ key: 'triggeredBy', label: `started by ${f.triggeredBy}` })
  if (f.simulated) out.push({ key: 'simulated', label: f.simulated })
  return out
}

/** Journeys that only the UI suite has, so a chip with no suite chosen is worded for it. */
const UI_ONLY = new Set(['auth', 'catalogue', 'cart', 'checkout', 'defects'])
