# Test Run Dashboard

Self-service test running: pick a slice, press **Run**, and get a link to the
report — without waiting for someone else or digging through CI artifacts. A
machine holding an API key can start one without opening the page at all.

Three roles see three different dashboards. A `dev` is pinned to `main` and sees
only main-branch runs; `qa` may also run `develop` and `release/<version>`, and sees every
run; `admin` may run any branch, delete, and use the admin page. The interesting
part is not the Run button — it is _who may run what, and who may then see the
result_.

**It is a demo throughout** ([decision 52](docs/decisions.md#52-a-demo-throughout-a-sandbox-for-each-visitor)).
Every visitor gets a sandbox of their own for a day: their runs, their gate,
their keys, their member list, their activity log. Every control works — delete
a run, lock the sandbox down, revoke a key — and the only person who sees the
result is the one who did it. Nothing starts a real workflow and there are no
passwords. The real runs the suites' own CI reports are shown beside every
sandbox's, and no visitor can change them.

**Version 1.3.0.** 1.0.0 (4 September) was complete against its own scope:
four roles, the run gate, signed callbacks and scoped report links, all
deployed. 1.1.0 added a second suite, API keys and a sandbox key for visitors,
QA's release branches, a redesigned page, reports fenced off from the API, and
the fixes from a five-way review. 1.2.0 (7 October) lets a simulated run be
asked to fail, removes the oldest stored reports while keeping the runs, and
records a result that counted no tests as an error. 1.3.0 (11 October) is
the page itself, from two reviews of the live site: status colours measured as
marks and for colour blindness, one type scale, a run form in which no choice is
cut and Run stays on a phone's first screen, whole tap areas on a touch screen,
and one way to choose one of a few things — each in
[`docs/decisions.md`](docs/decisions.md) (45 to 47) or its commit.
The deployment reports its own version at `GET /health`, so "which one is
running?" is answerable without signing in.

Start with [`docs/decisions.md`](docs/decisions.md) if you have five minutes and
want the reasoning rather than the code.

Part of [testbydesign.dev](https://testbydesign.dev), which draws how this and both
suites fit together.

**Live at [runs.testbydesign.dev](https://runs.testbydesign.dev)** — one button, no
password. "Sign in with Google" is there too, labelled a concept: it is not
connected to Google, and it shows the account chooser a company sign-in would
put first, with the whitelist check behind it applied for real.

## Run it

No Cloudflare account, no GitHub token, nothing to sign up for.

```bash
pnpm install && pnpm db:migrate && pnpm dev
```

The UI is on `http://localhost:5173`. Press **Log in to demo**: that makes a
sandbox and signs you in as its visitor account, listed as admin. Listed is half
of admin; the other half is the sandbox's admin key, which the admin page shows
you because this is a demo. Paste it, and the gate, members, API keys, activity
and lockdown are yours. **Switch account** signs in as the sandbox's `qa` or
`dev` account, or as one on no list, which is refused.

Press Run. The dashboard walks the run through queued → running → result.
Locally the report link answers 404: the report is an object in R2, and a fresh
clone's local bucket is empty. On the deployed site every simulated run opens
one real, shared Allure report
([decision 14](docs/decisions.md#14-one-real-allure-report-shared-by-every-simulated-run)).

## What is where

```
packages/api    Cloudflare Worker — Hono, D1, R2
packages/ui     React + Vite
```

| File                                                      | What it decides                                          |
| --------------------------------------------------------- | -------------------------------------------------------- |
| [`policy.ts`](packages/api/src/policy.ts)                 | Who may run what, on which branch, and what they may see |
| [`auth.ts`](packages/api/src/auth.ts)                     | Sessions, the admin key, the role read from the list     |
| [`sandboxes.ts`](packages/api/src/sandboxes.ts)           | One visitor's copy, its limits and its expiry            |
| [`crypto.ts`](packages/api/src/crypto.ts)                 | Webhook signing, report-link tokens                      |
| [`routes/webhook.ts`](packages/api/src/routes/webhook.ts) | The only endpoint that may change a result               |
| [`routes/admin.ts`](packages/api/src/routes/admin.ts)     | Members, activity and lockdown — admin, people only      |

## Tests

```bash
pnpm verify        # what CI runs: format, lint, types, tests, claims
pnpm test          # 1136 tests — 601 in the Worker, 535 in the UI
pnpm check:claims  # fails if these docs advertise a count that has gone stale
```

Tests run in **workerd against a real local D1 and R2**, not against mocks —
half of what matters here (visibility enforced in SQL, R2 cleanup on delete, the
simulator's overwrite guard) is invisible to a fake `prepare()`. See
[decision 8](docs/decisions.md#8-tests-run-inside-workerd-against-real-d1-and-r2).

Every test was proven able to fail. In all, 384 deliberate mutations — deleting
the privilege-escalation guard, signing the webhook body without its timestamp,
dropping the visibility clause — each produced a failure naming the right
behaviour. 328 of them are written down one by one in
[`docs/mutations.md`](docs/mutations.md), with the commit that ran each and the
message it produced; that file also says plainly which of the 384 are _not_
recorded, and why they cannot be. Two real bugs came out of writing them:
[decision 9](docs/decisions.md#9-the-bugs-the-tests-actually-found).

## Security posture

This is a demo, and it says so in code rather than in a comment:

- Visibility is scoped in SQL by sandbox as well as by role: a visitor's query
  can return the real runs and their own sandbox's, never another's, and every
  write — delete, gate, keys, members, lockdown — names the caller's sandbox in
  its `WHERE`. A real run cannot be deleted through the API at all.
- A session names a sandbox and an account, never a role. The role is read from
  the member list on every request, so a removal takes effect on the next click.
- Admin is two locks: listed as admin, and the sandbox's admin key, which gives
  an hour in its own cookie. Wrong keys are counted per account before they are
  compared ([decision 28](docs/decisions.md#28-sign-in-counts-wrong-passwords-and-counts-them-before-checking)).
- Every secret has an obviously fake development default so a clone runs as-is,
  and `assertDeployable` refuses to serve on any host but a local one without
  the real ones.
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

Set the secrets first. On any host that is not a local one, the Worker
**refuses to serve** without them — a 503 on every route, and `/health` says
which are missing — because the development defaults are published in this
repo, and a deployment that silently used them would let anyone forge a
session, an admin key or a report link.

Every `wrangler` command below runs from `packages/api`, where `wrangler.toml`
is (`pnpm exec wrangler …` if it is not on your PATH).

```bash
wrangler secret put WEBHOOK_SECRET_API   # signs the API suite's result callback
wrangler secret put WEBHOOK_SECRET_UI    # signs the UI suite's
wrangler secret put TOKEN_SECRET         # signs sessions, admin keys and report links
```

That is all of them. There is no GitHub token, because nothing is dispatched,
and no passwords, because there are none.

### Routing

The Worker and the UI share one hostname: Pages serves the static site, and
Worker routes claim the API paths in front of it. Those routes are configured
in the Cloudflare dashboard rather than here, so **adding an endpoint means
adding its route** — otherwise the SPA answers instead, and the symptom is a
`405` on a path that exists and works locally.

The paths the Worker must own:

```
/auth/*   /demo/*   /runs   /runs/*   /gate   /keys   /keys/*
/webhook  /reports/*   /health
```

### Rate limiting at the edge

The limits in this repository are counted in D1, which means a request has
already reached the Worker (and read the database) by the time one refuses it.
They bound what a caller can _do_, not what they can _send_. Stopping a flood or
a bot before the Worker is Cloudflare's rate limiting, and it is **configuration
in the Cloudflare dashboard, not something this repository sets or checks** —
nothing here fails if it is missing.

Rules are per zone, so one zone covers every site on it. Suggested rules, by
path, counted per IP address (adjust the numbers; what the dashboard offers for
period and block duration depends on the plan, and the free plan's are narrower):

| Path (host `runs.…`) | Why                                                                            | Starting point        |
| -------------------- | ------------------------------------------------------------------------------ | --------------------- |
| `/auth/*`            | making sandboxes and guessing admin keys; the D1 limits start after the Worker | 10 requests / minute  |
| `/demo/keys`         | minting keys                                                                   | 10 requests / minute  |
| `/runs*`             | creating and listing runs                                                      | 60 requests / minute  |
| `/webhook`           | GitHub's callbacks; signed, so this only bounds noise                          | 120 requests / minute |

The static sites (the hub and the dashboard's own pages) are served by
Cloudflare Pages and need nothing beyond what Cloudflare does by default. A site
hosted elsewhere, such as the Paygate sandbox on Vercel, is not behind any of this.

### The order matters

Migrations first, then the Worker, then the UI:

```bash
wrangler d1 migrations apply run-dashboard --remote   # 1. schema
wrangler deploy                                       # 2. the Worker
pnpm --filter @run-dashboard/ui build                 # 3. the UI
wrangler pages deploy ../ui/dist --project-name <project>
```

Deploying the Worker before its migration gives a **500 on every callback** —
the new code selects a column the database does not have yet, and the only
visible symptom is runs that never leave `running`. That is not hypothetical:
it is what happened when 0004 was added and the Worker was restarted first.

There are no `--var`s any more. The flag that made a plain `wrangler deploy`
quietly fall back to simulating is gone, and whether a deployment must have its
secrets is decided by the host a request reaches, which a deploy cannot forget.

The suite side needs `DASHBOARD_WEBHOOK_URL` as a repository variable and
`DASHBOARD_WEBHOOK_SECRET` as a repository secret, matching
`WEBHOOK_SECRET_API` here for the API suite's repository and `WEBHOOK_SECRET_UI`
for the UI suite's (decision 50). A callback for a run this dashboard has not
seen is recorded as a new real run when it says what ran — `suite`,
`service`, `tags`, `ref` — which is how a suite's scheduled CI reports here
(decision 52). **The suites' workflows do not send those yet**: until they do,
the real runs shown are the ones recorded before the dashboard stopped
dispatching.

For a real run's **report** to appear as well, it also needs
`CLOUDFLARE_API_TOKEN` (scoped to object-write on the reports bucket, nothing
else) and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. The workflow writes
the report into R2 directly rather than through this API — see
[decision 14](docs/decisions.md#14-one-real-allure-report-shared-by-every-simulated-run).
Without them the run still reports its numbers; it just has no report link.

## The companion repositories

This dashboard shows the results of two suites, and both are published:

**[`playwright-api-automation-patterns`](https://github.com/surakiartysk/playwright-api-automation-patterns)** —
the same API suite built twice, functional-style and class-first, against one
OpenAPI contract.

**[`playwright-ui-automation-patterns`](https://github.com/surakiartysk/playwright-ui-automation-patterns)** —
the same twenty UI journeys built twice, locator-first and page-first, against
a public demo storefront.

Each meets this dashboard at two points: its workflow uploads its Allure report
into this deployment's R2 bucket, and then posts its result back to `/webhook`
here. There used to be a third, the workflow inputs this dashboard dispatched
with, and that is where the repositories had drifted once — a service name sent
in an input that only took package names. Nothing is dispatched now
([decision 52](docs/decisions.md#52-a-demo-throughout-a-sandbox-for-each-visitor)).

Which suite a run belongs to is its `suite` — `api` or `ui`, a column on every
run since migration 0008 (see
[decision 24](docs/decisions.md#24-a-second-suite-and-why-it-is-a-column-rather-than-a-naming-convention)).
`packages/api/test/integration-contract.test.ts` holds the callback's shape and
the report path, copied by hand, and fails when either side changes.

## Docs

- [`decisions.md`](docs/decisions.md) — why it is shaped this way, with costs
- [`architecture.md`](docs/architecture.md) — the request paths end to end
- [`how-it-was-built.md`](docs/how-it-was-built.md) — how AI was used, and the companion repositories
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — what runs when, how to mutation-test, how to add an endpoint
- [`CLAUDE.md`](CLAUDE.md) — the rules you break first, and why they exist

## Licence

MIT — see [LICENSE](LICENSE).
