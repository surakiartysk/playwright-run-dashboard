import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { SUITES } from '../types'
import { requireSession } from '../auth'
import { policyFor } from '../policy'
import { DEMO_BRANCHES, SUITE_OPTIONS, refsFor } from '../options'

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
 * limited below its role), the role's otherwise. The branches are a fixed demo
 * list, narrowed by the policy: nothing is dispatched, so there is no
 * repository to read them from (decision 52).
 */
optionsRoutes.get('/', (c) => {
  const role = c.get('role')
  const policy = c.get('apiKey')?.policy ?? policyFor(role)

  const suites = Object.fromEntries(
    SUITES.map((suite) => [
      suite,
      { ...SUITE_OPTIONS[suite], refs: refsFor(policy.allowedRefs, DEMO_BRANCHES) },
    ]),
  )

  return c.json({ role, simulated: true, maxWorkers: policy.maxWorkers, suites })
})
