import type { Suite } from './api'

/**
 * The request the New run form sends, built outside the component so the one
 * rule it has to keep is testable without rendering.
 *
 * The suites filter on one axis — a service or a tag, never both — and the API
 * refuses a request naming both. The form used to keep that rule by clearing
 * the tag whenever the service *changed*. Its initial state never changed: it
 * opened on `items` with `smoke` selected, so pressing Run on an untouched form
 * was refused with a 422. That is the first thing a demo visitor does.
 *
 * Deriving the tag here rather than trusting the state means no sequence of
 * selections — the initial one, a suite switch that moves the service, or one
 * not written yet — can send both.
 */
export interface RunForm {
  suite: Suite
  service: string
  tags: string
  ref: string
  workers: number
}

/**
 * The tag filter that actually applies: the selected one when running across
 * every service, `all` when a single service is named.
 *
 * @param service - The selected service, or `all`
 * @param tags - The selected tag, which only counts when service is `all`
 */
export function effectiveTags(service: string, tags: string): string {
  return service === 'all' ? tags : 'all'
}

/** The body for `POST /runs`. */
export function runRequest(form: RunForm): RunForm {
  return { ...form, tags: effectiveTags(form.service, form.tags) }
}
