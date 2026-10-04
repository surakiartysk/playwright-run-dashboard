import type { RunForm } from './run-form'

/**
 * The commands that do from a terminal what the form does with a button.
 *
 * Built from what the form currently holds, so the snippet is the request that
 * pressing Run would send — copy it, paste it, get the same run. With no key to
 * show, the header reads `$RUN_KEY` from the environment. With one — a visitor's
 * sandbox key — the key is written into the command, so a copy runs as it is.
 * That puts it in a shell history, which is acceptable for this key alone: it
 * can only simulate, it expires within a day and it is rate limited.
 */

export const KEY_VARIABLE = 'RUN_KEY'

/** A value as one shell word, safe whatever is in it. */
export const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** The Authorization header: the key itself if there is one, else the variable. */
const authHeader = (key?: string): string =>
  key ? quote(`Authorization: Bearer ${key}`) : `"Authorization: Bearer $${KEY_VARIABLE}"`

/** `POST /runs` for the form's current selection. */
export function runCurl(form: RunForm, origin: string, key?: string): string {
  const body = JSON.stringify({
    suite: form.suite,
    service: form.service,
    tags: form.tags,
    ref: form.ref,
    workers: form.workers,
  })
  return [
    `curl -X POST ${quote(`${origin}/runs`)} \\`,
    `  -H ${authHeader(key)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${quote(body)}`,
  ].join('\n')
}

/** What is there to ask for: the services, tags and branches this key may use. */
export function optionsCurl(origin: string, key?: string): string {
  return [`curl ${quote(`${origin}/runs/options`)} \\`, `  -H ${authHeader(key)}`].join('\n')
}
