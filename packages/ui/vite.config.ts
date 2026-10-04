import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tokensCss } from './src/tokens'

/**
 * Puts the generated palette where index.html marks it.
 *
 * Throws when the marker is missing rather than carrying on: a page built
 * without it has no `--c-*` variables at all, which looks like every colour in
 * the app turning transparent and says nothing about why.
 */
export const TOKENS_MARKER = '/* @tokens */'

export function tokensPlugin(): Plugin {
  return {
    name: 'run-dashboard-tokens',
    transformIndexHtml(html) {
      if (!html.includes(TOKENS_MARKER)) {
        throw new Error(`index.html has no ${TOKENS_MARKER}; the palette would not be built`)
      }
      return html.replace(TOKENS_MARKER, tokensCss())
    },
  }
}

/**
 * The proxy is what keeps the session cookie working in development.
 *
 * Vite serves on 5173 and the Worker on 8787. Calling the Worker directly
 * would make every request cross-origin, and the `HttpOnly` session cookie
 * would need `SameSite=None` to survive — which is a production-shaped
 * compromise made for a local inconvenience. Proxying keeps both sides on one
 * origin, so the cookie behaves in development exactly as it will in
 * production.
 *
 * Every route the Worker serves has to be listed. An unlisted one is not an
 * error a developer sees: Vite falls through to the SPA index, so the fetch
 * gets HTML with a 200 and the failure surfaces much later as a component
 * reading a field that is not there. `/keys` was missing for exactly as long
 * as nothing in the UI called it.
 */
export default defineConfig({
  plugins: [react(), tokensPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://127.0.0.1:8787',
      '/demo': 'http://127.0.0.1:8787',
      '/runs': 'http://127.0.0.1:8787',
      '/gate': 'http://127.0.0.1:8787',
      '/keys': 'http://127.0.0.1:8787',
      '/reports': 'http://127.0.0.1:8787',
    },
  },
})
