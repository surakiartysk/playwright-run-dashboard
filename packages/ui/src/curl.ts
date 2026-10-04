import type { RunForm } from './run-form'

/**
 * The commands that do from a terminal what the form does with a button.
 *
 * Built from what the form currently holds, so the snippet is the request that
 * pressing Run would send — copy it, paste it, get the same run. The key is
 * `$RUN_KEY` until there is one to show, and the command reads it from the
 * environment either way, so a pasted command is never the thing that leaks it
 * into a shell history on its own line.
 */

export const KEY_VARIABLE = 'RUN_KEY'

/** A value as one shell word, safe whatever is in it. */
export const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** `POST /runs` for the form's current selection. */
export function runCurl(form: RunForm, origin: string): string {
  const body = JSON.stringify({
    suite: form.suite,
    service: form.service,
    tags: form.tags,
    ref: form.ref,
    workers: form.workers,
  })
  return [
    `curl -X POST ${quote(`${origin}/runs`)} \\`,
    `  -H "Authorization: Bearer $${KEY_VARIABLE}" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${quote(body)}`,
  ].join('\n')
}

/** What is there to ask for: the services, tags and branches this key may use. */
export function optionsCurl(origin: string): string {
  return [
    `curl ${quote(`${origin}/runs/options`)} \\`,
    `  -H "Authorization: Bearer $${KEY_VARIABLE}"`,
  ].join('\n')
}

/** The line that gives the commands their key. */
export const exportKey = (key: string): string => `export ${KEY_VARIABLE}=${quote(key)}`
