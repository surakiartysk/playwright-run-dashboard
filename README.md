# Test Run Dashboard

Self-service test running: a developer picks a slice, presses **Run**, and gets
a link to the report — without waiting for QA or digging through CI artifacts.

Four roles see four different dashboards. A `dev` is pinned to `main` and sees
only main-branch runs; `qa` gets the release branches; `admin` gets everything
and may delete; `demo` sees only the runs it started itself and can never
trigger a real one, which is what makes its password safe to publish rather
than hand out privately. The interesting part is not the Run button — it is
_who may run what, and who may then see the result_.

**Version 1.0.0** — complete against the brief it was written for: four roles,
the run gate, signed callbacks and scoped report links, all deployed and in use.
The deployment reports its own version at `GET /health`, so "which one is
running?" is answerable without signing in.

Start with [`docs/decisions.md`](docs/decisions.md) if you have five minutes and
want the reasoning rather than the code.

> This repo is a stand-in for production work I cannot publish — same
> architecture and reasoning, invented subject matter, no employer code or
> branding. [`docs/provenance.md`](docs/provenance.md) says exactly what
> travelled and how AI was used.

**Live at [testbydesign.dev](https://testbydesign.dev)** — password `demo`.
That deployment is real: real D1, real R2, a real GitHub token that can
dispatch the companion suite below. `demo` cannot reach any of that — see
[decision 12](docs/decisions.md#12-a-fourth-role-that-can-never-dispatch-for-real)
for why a role can be handed a genuine login to a real deployment and still be
safe to publish.

## Run it

No Cloudflare account, no GitHub token, nothing to sign up for.

```bash
pnpm install && pnpm db:migrate && pnpm dev
```

The UI is on `http://localhost:5173`. Sign in with `demo`, `dev`, `qa`, or
`admin` — the passwords are printed on the login screen, because they are in
the source anyway and a demo whose first screen is a password hunt is a demo
nobody sees.

Press Run. The dashboard simulates a dispatch, walks the run through
queued → running → result, and the report link opens a real Allure report.
Sign in as `demo` and use the **Viewing as** bar to watch what each role is
allowed to see — without gaining what it is allowed to do.

## What is where

```
packages/api    Cloudflare Worker — Hono, D1, R2
packages/ui     React + Vite
```

| File                                                      | What it decides                                          |
| --------------------------------------------------------- | -------------------------------------------------------- |
| [`policy.ts`](packages/api/src/policy.ts)                 | Who may run what, on which branch, and what they may see |
| [`auth.ts`](packages/api/src/auth.ts)                     | Session tokens, the role gate                            |
| [`crypto.ts`](packages/api/src/crypto.ts)                 | Webhook signing, report-link tokens                      |
| [`routes/webhook.ts`](packages/api/src/routes/webhook.ts) | The only endpoint that may change a result               |
| [`routes/demo.ts`](packages/api/src/routes/demo.ts)       | Role preview — read-only, and only for a `demo` session  |

## Tests

```bash
pnpm verify        # what CI runs: format, lint, types, leak check, tests
pnpm test          # 384 tests — 307 in the Worker, 77 in the UI
pnpm check:leak    # the vocabulary and branding tripwire alone
pnpm check:claims  # fails if these docs advertise a count that has gone stale
```

Tests run in **workerd against a real local D1 and R2**, not against mocks —
half of what matters here (visibility enforced in SQL, R2 cleanup on delete, the
simulator's overwrite guard) is invisible to a fake `prepare()`. See
[decision 8](docs/decisions.md#8-tests-run-inside-workerd-against-real-d1-and-r2).

Every test was proven able to fail. Eighty-five deliberate mutations — deleting the
privilege-escalation guard, signing the webhook body without its timestamp,
dropping the visibility clause — each produced a failure naming the right
behaviour. Two real bugs came out of writing them:
[decision 9](docs/decisions.md#9-the-bugs-the-tests-actually-found).

## Security posture

This is a demo, and it says so in code rather than in a comment:

- `POST /demo/preview-role` never mints a session token for another role. It
  requires a genuine `demo` session and sets a second, narrower cookie that
  only changes what `GET /runs` and `GET /runs/:id` return — every write path
  (starting a run, deleting one) still enforces the real, signed-in role
  regardless of what is being previewed. See
  [decision 12](docs/decisions.md#12-a-fourth-role-that-can-never-dispatch-for-real).
- Every secret has an obviously fake development default so a clone runs as-is,
  and `assertDeployable` logs loudly if one would reach a real deployment.
- The webhook signs `timestamp.body` and refuses anything older than five
  minutes, so a captured callback is not replayable forever.
- Reports live in a private bucket behind signed, expiring, run-scoped links.
  A real Allure report's own assets cannot carry that token, so opening one
  sets a cookie scoped to `/reports/{runId}/` — minted only after the token has
  been accepted, and refused for any other run. See
  [decision 14](docs/decisions.md#14-one-real-allure-report-shared-by-every-simulated-run).
- The **run gate** pauses developer-triggered runs during a release without
  touching anyone's role. It fails _open_ on bad data, unlike everything above
  it — see [decision 11](docs/decisions.md#11-the-run-gate-fails-open-and-policy-fails-closed).

## Deploying it for real

Set every secret first. The Worker **refuses to serve** without them — a 503 on
every route, and `/health` says which are missing — because the development
defaults are published in this repo, and a deployment that silently used them
would sign report links with a value anyone can read.

```bash
wrangler secret put WEBHOOK_SECRET   # signs the result callback
wrangler secret put TOKEN_SECRET     # signs report links
wrangler secret put ADMIN_PASSWORD
wrangler secret put QA_PASSWORD
wrangler secret put DEV_PASSWORD
```

### The order matters

Migrations first, then the Worker, then the UI:

```bash
wrangler d1 migrations apply run-dashboard --remote   # 1. schema
wrangler deploy --var GITHUB_REPO:<owner/repo> \
                --var GITHUB_WORKFLOW:on-demand.yml \
                --var SIMULATE_DISPATCH:false        # 2. the Worker
pnpm --filter @run-dashboard/ui build                 # 3. the UI
wrangler pages deploy dist --project-name <project>
```

Deploying the Worker before its migration gives a **500 on every callback** —
the new code selects a column the database does not have yet, and the only
visible symptom is runs that never leave `running`. That is not hypothetical:
it is what happened when 0004 was added and the Worker was restarted first.

**Pass the vars on the command line, not by editing `wrangler.toml`.** The
tracked file deliberately holds `SIMULATE_DISPATCH = "true"` and a placeholder
`GITHUB_REPO` (see [decision 6](docs/decisions.md#6-simulation-is-the-default-and-one-flag-governs-it)),
so a plain `wrangler deploy` silently reverts a live deployment to simulating —
the dashboard keeps working, and quietly stops dispatching anything real.

Then in `wrangler.toml`: set `database_id` to a real D1 database, `GITHUB_REPO`
to the repository whose workflow you are dispatching, and `SIMULATE_DISPATCH`
to `"false"`. That last one also hides dev/qa/admin's credentials from the
login screen — only `demo`'s stays printed, since hiding it protects nothing.

The suite side needs `DASHBOARD_WEBHOOK_URL` as a repository variable and
`DASHBOARD_WEBHOOK_SECRET` as a repository secret, matching `WEBHOOK_SECRET`
here. Without them its callback step is skipped and runs stay `running`.

For a real run's **report** to appear as well, it also needs
`CLOUDFLARE_API_TOKEN` (scoped to object-write on the reports bucket, nothing
else) and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. The workflow writes
the report into R2 directly rather than through this API — see
[decision 14](docs/decisions.md#14-one-real-allure-report-shared-by-every-simulated-run).
Without them the run still reports its numbers; it just has no report link.

## The companion repository

This dashboard triggers a suite; that suite is published too:

**`playwright-api-automation-patterns`** —
the same API suite built twice, functional-style and class-first, against one
OpenAPI contract.

They meet at three points: this dashboard dispatches that repo's
`on-demand.yml`, that workflow uploads its Allure report into this deployment's
R2 bucket, and then posts its result back to `/webhook` here.

## Docs

- [`decisions.md`](docs/decisions.md) — why it is shaped this way, with costs
- [`architecture.md`](docs/architecture.md) — the request paths end to end
- [`provenance.md`](docs/provenance.md) — where this came from, and how AI was used
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — what runs when, how to mutation-test, how to add an endpoint

## Licence

MIT — see [LICENSE](LICENSE).
