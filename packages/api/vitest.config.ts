import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

/**
 * Tests run inside workerd, not Node.
 *
 * The alternative — mocking D1 and R2 — would test the mocks. Half of what is
 * worth testing here exists only at the binding: that visibility is enforced in
 * SQL rather than in a handler, that deleting a run also clears its report out
 * of R2, that the simulator's `WHERE status IN (...)` guard really does refuse
 * to overwrite a finished run. A fake `prepare()` returning canned rows proves
 * none of it.
 *
 * Storage is shared across the tests in a file — the pool dropped its
 * per-test rollback, and the option for it is silently ignored rather than
 * rejected, so relying on it would have meant tests that only looked isolated.
 * Every test therefore seeds its own rows and asserts against those, never
 * against a global count. That is the same discipline the suite this dashboard
 * triggers runs under, and for the same reason: it is how a test has to behave
 * against a shared real environment.
 */

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Read by `applyD1Migrations` in the helpers. Passing the migrations in
        // rather than running them at config time is what lets each isolated
        // test start from an empty schema and build it.
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
})
