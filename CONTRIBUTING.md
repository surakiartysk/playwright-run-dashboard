# Contributing

Conventions here are enforced rather than described, so most of this page is
about what runs and when.

For the _why_ behind any convention, see [docs/decisions.md](docs/decisions.md).

## Setup

```bash
pnpm install
pnpm db:migrate
```

No Cloudflare account, no GitHub token, no `.env`. D1 becomes a SQLite file
under `.wrangler/` and R2 becomes a directory; every secret has an obviously
fake development default. `pnpm install` also installs the git hooks via
`prepare`.

```bash
pnpm dev
```

Starts the Worker on `:8787` and the UI on `:5173` together. Sign in as `demo`,
`dev`, `qa`, or `admin` — the passwords are printed on the login screen.

If the local database ends up in a state you do not want, `pnpm db:reset`
deletes `.wrangler/` and re-migrates. It is the only destructive command here,
and it only touches local state.

## Running tests

| Command             | Runs                                                         |
| ------------------- | ------------------------------------------------------------ |
| `pnpm test`         | Both packages — 264 Worker tests, then 77 UI tests           |
| `pnpm verify`       | Everything CI runs: format, lint, types, leak, tests, claims |
| `pnpm check:leak`   | The vocabulary and branding tripwire alone                   |
| `pnpm check:claims` | Fails if the docs advertise a count that has gone stale      |

Inside a package, the vitest CLI works as usual:

```bash
cd packages/api
pnpm exec vitest run test/routes-runs.test.ts   # one file
pnpm exec vitest run -t "visibility"            # tests matching a name
pnpm exec vitest                                # watch mode
```

### Where a test belongs

The Worker's tests split by what they need, not by which file they mirror.

| File                    | Covers                                            | Needs a binding? |
| ----------------------- | ------------------------------------------------- | ---------------- |
| `crypto.test.ts`        | HMAC, report tokens                               | no               |
| `auth.test.ts`          | Session tokens, password → role, cookie parsing   | no               |
| `policy.test.ts`        | The policy table, `mayUseRef`, `visibilityClause` | no               |
| `deployability.test.ts` | `assertDeployable` — the secrets fence            | no               |
| `routes-*.test.ts`      | One endpoint each, through its middleware         | yes              |
| `simulate.test.ts`      | The simulator, including its overwrite guard      | yes              |

`test/helpers.ts` holds the shared setup: `migrate`, `request`, `as(role, …)`,
`postWebhook`, `seedRun`, `uniqueService`.

Two helpers are easy to confuse:

- **`request`** returns as soon as the handler responds. Use this by default.
- **`settle`** also waits for `waitUntil`. `POST /runs` schedules the simulator
  there, and the simulator sleeps for several seconds on purpose — a test that
  waits for it without meaning to just times out. Only reach for `settle` when
  you are asserting on what the background work produced.

### Isolation

**Storage is shared across the tests in a file.** The pool's per-test rollback
was removed in the version used here, and the option for it is silently
accepted and ignored rather than rejected — so relying on it would produce
tests that only _look_ isolated.

Every test therefore seeds its own rows and asserts against those:

```ts
const service = uniqueService()
const visible = await seedRun({ service, ref: 'main' })
const hidden = await seedRun({ service, ref: 'develop' })

const ids = (await listFor('dev', service)).map((run) => run.id)
expect(ids).toContain(visible)
expect(ids).not.toContain(hidden)
```

Never assert on a global count, and never assume the table starts empty. That
is the same discipline the suite this dashboard triggers runs under, for the
same reason: it is how a test has to behave against a shared real environment.

## Every test must be proven able to fail

A green suite means nothing until you have watched it go red for the right
reason. Before claiming a test is done, break the behaviour it targets and
confirm the failure names that behaviour, then restore.

```bash
cd packages/api
cp src/policy.ts /tmp/policy.bak

# Widen dev to every branch — visibility and ref-policy tests should fail.
sed -i '' "s/dev: { allowedRefs: \['main'\]/dev: { allowedRefs: ['*']/" src/policy.ts
pnpm exec vitest run

cp /tmp/policy.bak src/policy.ts   # always restore
pnpm exec vitest run               # confirm green again
```

Eighty-one mutations have been run against this repo. The ones worth
repeating after any change to authorisation or signing:

| Mutation                                                     | Must fail                     |
| ------------------------------------------------------------ | ----------------------------- |
| Delete the `role !== 'demo'` guard in `routes/demo.ts`       | preview-role escalation tests |
| Make `POST /runs` consult the preview cookie for `mayUseRef` | `preview-role-safety.test.ts` |
| Sign the webhook over `raw` instead of `` `${ts}.${raw}` ``  | webhook replay tests          |
| Drop the age window in `routes/webhook.ts`                   | stale-timestamp tests         |
| Make `visibilityClause` return `{ sql: '' }` for `dev`       | visibility tests              |
| Remove `AND status IN (...)` from `simulate.ts`              | the overwrite-guard test      |
| Remove the run-scope check in `routes/reports.ts`            | cross-run token test          |
| Let `demo` obey `SIMULATE_DISPATCH` in `dispatchWorkflow`    | `demo-role-safety.test.ts`    |
| Point `DEMO_REPORT_PREFIX` somewhere nothing was uploaded    | the simulator's report test   |
| Make the report entry point cacheable again                  | the asset-cookie cache test   |
| Resolve a report's prefix to anything but `report_path`      | the cross-repo contract test  |
| Narrow the "Failed" filter to `status === 'failed'` alone    | the filter-reachability tests |
| Drop `.reverse()` from the trend, so it reads newest-first   | the trend-direction tests     |
| Stop inverting y, so a high pass rate sits at the bottom     | the trend y-axis test         |
| Remove the trend's minimum window, letting a wobble fill it  | the trend-domain test         |

One of these caught a **vacuous test**. The simulator's report test originally
interpolated `DEMO_REPORT_PREFIX` on both sides — seeding R2 with it and
asserting against it — so renaming the constant renamed the expectation too and
the mutation passed, while every deployed report link would have 404'd. The
prefix is now written as a literal in that test, which is what makes the
mutation fail. **When a test and the code it guards read the same constant,
the test agrees with the code by construction and proves nothing.**

Three of these were not exercises. Both bugs in
[decision 9](docs/decisions.md#9-the-bugs-the-tests-actually-found) were found
this way, and one — the simulator overwriting real results — was only
reachable by testing a _correctly signed_ webhook. Checking that bad signatures
are rejected is the easy half.

The third was the trend chart's axis. Its minimum-window test failed on first
run against code that looked right: padding each end of the range and _then_
clamping to 0–100 means whichever end hits the limit loses its padding, so two
runs at 99.5% and 100% got a two-point window rather than the ten intended — a
half-point wobble drawn as a collapse. Fixed by computing a target width and
shifting it inside the limits rather than padding and clipping.

**A chart is the easiest place to ship a confident lie.** Nothing about an
inverted axis or an exaggerated scale _looks_ broken; it simply says the
opposite of what the data says. That is why the trend's arithmetic is extracted
and tested rather than left inline in the markup.

**When you assert a filter, seed both a match and a non-match.** A visibility
test that only checks the visible row passes with no scoping at all.

## Quality gates

### Local, on commit

| Hook         | Runs                                              | Why                                                     |
| ------------ | ------------------------------------------------- | ------------------------------------------------------- |
| `pre-commit` | `lint-staged` — eslint + prettier on staged files | Under a second. Keeps mechanical noise out of the diff. |
| `commit-msg` | `commitlint`                                      | The history is part of what this repo demonstrates.     |

The pre-commit hook deliberately does **not** run the tests. The Worker suite
boots workerd and the simulator sleeps on purpose, so a full run is closer to a
minute — and a hook that slow gets bypassed with `--no-verify` the first time
someone is in a hurry. A hook people routinely skip is worse than no hook.
Correctness is CI's job.

### Commit format

```
<type>(<scope>): <subject>
```

Scopes are a closed list in
[`commitlint.config.mjs`](commitlint.config.mjs) — `api`, `ui`, the route names
(`auth`, `runs`, `webhook`, `reports`, `demo`), `policy`, `crypto`, `db`,
`core`, `ci`, `deps`. An open list drifts into near-synonyms; adding one should
be a decision.

The body is where the reasoning goes. Commits here explain _why_, because that
is the part a future reader cannot reconstruct from the diff.

### CI

| Workflow  | Trigger                | Runs                                          |
| --------- | ---------------------- | --------------------------------------------- |
| `pr-gate` | pull request           | `pnpm verify` on one Node version             |
| `ci`      | push to `main`, manual | `pnpm verify` on Node 22 + 24, and a UI build |

`verify` is the same command you run locally — one definition of green, so CI
cannot drift from the laptop.

The UI build is a separate job because **type-checking is not building**. Vite
catches an unresolvable import or a bad asset reference that `tsc` does not, and
this repo is meant to be cloned and run, so a broken build is a broken front
door.

There is deliberately no scheduled workflow. This repo is the thing that
_triggers_ runs, not the thing that gets run on a timer; the suite it dispatches
has its own schedule.

## Two gates worth understanding before you trip them

### `check:leak`

Fails on vocabulary and branding from the source material this repo restates —
the original's domain words, its brand red in hex, `rgb()`, or bare component
form, and invented account handles.

If it fires on innocent code, **narrow the pattern in
[`scripts/check-leak.mjs`](scripts/check-leak.mjs)** rather than renaming the
code around it. A check nobody trusts gets disabled.

### `check:claims`

Fails when the docs advertise a test count that no longer matches reality, or
when the three documents stating the mutation count disagree.

This exists because the mistake happened twice in a week — the docs here said
132 tests after the suite reached 140, and the companion repo said 82 after it
reached 83. A number written in prose has no way to notice it has gone stale.

Add a test and this gate will fail. That is the point: update the number in
`README.md`, or the claim stops being true.

## Adding an endpoint

1. **Decide the policy first.** If the endpoint is role-sensitive, the rule
   belongs in [`src/policy.ts`](packages/api/src/policy.ts) — not in the
   handler. Answer all three questions: may this role call it, against what, and
   what may it then see.
2. **Write the route** in `src/routes/`, and mount it in `src/index.ts`. Put it
   behind `requireSession`, and `requireRole` if it needs one.
3. **Return the right status.** A malformed request is `422`; a well-formed one
   the caller may not make is `403`. A resource the caller may not _see_ is
   `404`, not `403` — telling someone a thing exists but is off-limits leaks
   what they were scoped away from.
4. **Test it through the handler**, in a new `routes-<name>.test.ts`. Use
   `as(role, …)` so the middleware chain actually runs; importing the handler
   from underneath its middleware skips the part most worth testing.
5. **Mutate it.** Delete the authorisation check and watch the test fail. If
   nothing fails, the test is not testing what you think.
6. `pnpm verify`.

## Adding a migration

Migrations are numbered and applied in order; they are never edited once
committed. Add `migrations/000N_<what>.sql`, then `pnpm db:migrate`.

A column added later needs a default that is true of every row that already
exists — see `0002_add_ref.sql`, which defaults to `main` because every run
predating that column was a main-branch run.

The test pool applies the same files, so a migration that works locally works
in tests. There is nothing to update in the test setup.

## Working style

Propose an approach and say what it costs, not just what it does. Several
decisions in `docs/` came from arguing one down.

Do not report work as complete without running `pnpm verify` — and do not
describe a test as passing without having seen it fail first.
