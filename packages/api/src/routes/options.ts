import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { SUITES } from '../types'
import { requireSession } from '../auth'
import { policyFor } from '../policy'
import { simulates } from '../github'
import { suiteBranches } from '../branches'
import { SUITE_OPTIONS, refsFor } from '../options'

export const optionsRoutes = new Hono<HonoEnv>()

optionsRoutes.use('*', requireSession)

/**
 * What the caller may ask for, in the shape a request takes.
 *
 * One answer for the two things that need it: the run form, which draws its
 * dropdowns from it, and a person writing a `curl`, who has no other way to
 * learn that the UI suite's slices are `auth`, `cart`… and not services. Both
 * read the same endpoint, so the form cannot offer what the API would refuse.
 *
 * Narrowed to the caller: a key's own policy where there is one (a key may be
 * limited below its role), the role's otherwise. The branches are per suite,
 * because each suite is its own repository with its own branches.
 *
 * Reads the real role, never a previewed one. This is about what the caller may
 * *do*, and a demo session previewing admin does not gain admin's branches.
 */
optionsRoutes.get('/', async (c) => {
  const role = c.get('role')
  const policy = c.get('apiKey')?.policy ?? policyFor(role)
  const simulated = simulates(c.env, role)

  const suites = Object.fromEntries(
    await Promise.all(
      SUITES.map(async (suite) => {
        // A simulated run never reaches GitHub, so neither does asking about it.
        const existing = simulated ? null : await suiteBranches(c.env, suite)
        return [
          suite,
          {
            ...SUITE_OPTIONS[suite],
            refs: refsFor(policy.allowedRefs, existing),
            refsFrom: existing === null ? 'policy' : 'github',
          },
        ] as const
      }),
    ),
  )

  return c.json({ role, simulated, maxWorkers: policy.maxWorkers, suites })
})
