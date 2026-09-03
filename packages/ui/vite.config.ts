import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The proxy is what keeps the session cookie working in development.
 *
 * Vite serves on 5173 and the Worker on 8787. Calling the Worker directly
 * would make every request cross-origin, and the `HttpOnly` session cookie
 * would need `SameSite=None` to survive — which is a production-shaped
 * compromise made for a local inconvenience. Proxying keeps both sides on one
 * origin, so the cookie behaves in development exactly as it will in
 * production.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://127.0.0.1:8787',
      '/demo': 'http://127.0.0.1:8787',
      '/runs': 'http://127.0.0.1:8787',
      '/gate': 'http://127.0.0.1:8787',
      '/reports': 'http://127.0.0.1:8787',
    },
  },
})
