# Decisions

Why this repo is shaped the way it is. Read this first if a convention looks
strange — the reasoning is here rather than in the code.

Each entry carries a **trade-off** section. A decision without a stated cost is
usually a decision that has not been examined, and it is the section an
interviewer should press on hardest.

**Contents**

1. [Self-service running is an authorisation problem, not a UI one](#1-self-service-running-is-an-authorisation-problem-not-a-ui-one)
2. [One policy table, consulted three times](#2-one-policy-table-consulted-three-times)
3. [Visibility is enforced in SQL, never in the handler](#3-visibility-is-enforced-in-sql-never-in-the-handler)
4. [The webhook signs `timestamp.body`, not the body](#4-the-webhook-signs-timestampbody-not-the-body)
5. [Report links are signed, scoped and short-lived](#5-report-links-are-signed-scoped-and-short-lived)
6. [Simulation is the default, and one flag governs it](#6-simulation-is-the-default-and-one-flag-governs-it)
7. [No JWT, no session store, no auth library](#7-no-jwt-no-session-store-no-auth-library)
8. [Tests run inside workerd against real D1 and R2](#8-tests-run-inside-workerd-against-real-d1-and-r2)
9. [The bugs the tests actually found](#9-the-bugs-the-tests-actually-found)
10. [Copied layout, changed palette](#10-copied-layout-changed-palette)
11. [The run gate fails open, and policy fails closed](#11-the-run-gate-fails-open-and-policy-fails-closed)
12. [A fourth role that can never dispatch for real](#12-a-fourth-role-that-can-never-dispatch-for-real)
13. [A second, narrower cookie for looking at another role's view](#13-a-second-narrower-cookie-for-looking-at-another-roles-view)
14. [One real Allure report, shared by every simulated run](#14-one-real-allure-report-shared-by-every-simulated-run)

---

## 1. Self-service running is an authorisation problem, not a UI one

**Context.** The stated problem is "a developer wants to run the API suite
without waiting for QA". That sounds like a form with a Run button, and the
first version of anything like this usually is.

**Decision.** Treat it as an authorisation problem from the start. The
interesting question is not _how do I trigger a run_ — a workflow dispatch is
four lines — it is _who may run what, against which branch, and who may then
see the result_.

Triggering is the easy half. Handing every developer a button that runs
arbitrary refs on a shared runner is how a test dashboard becomes a way to
execute untrusted code, and scoping it afterwards means retrofitting rules onto
endpoints that were written without them.

**Trade-off.** Multiple roles and a policy table are more machinery than a
one-person team needs on day one; a single shared password would have worked and
shipped sooner. The cost is paid once, and the alternative — adding roles after
the read path already returns every row — is the migration nobody wants to do.
[Decision 12](#12-a-fourth-role-that-can-never-dispatch-for-real) is that cost
paid a second time, on purpose, for a role the original three were never meant
to cover.

---

## 2. One policy table, consulted three times

**Context.** Authorisation rules here answer three separate questions:

1. May this role start a run at all?
2. Against which git refs?
3. Which runs may it then _see_?

**Decision.** `src/policy.ts` holds all three, and the handlers consult it.
Nothing in a route decides policy for itself.

The failure mode this avoids is specific: `if (role === 'dev')` scattered
through four handlers, three of which drift. The read path forgets what the
write path enforces, and a developer sees a run they were never allowed to
start. Question 3 is the one most often missed — a dashboard that hides the
button but returns every row has not restricted anything.

The same table also feeds `GET /demo/roles`, so the UI's explanation of what
each role may do cannot drift from what the API enforces.

**Trade-off.** A table of constants does not express rules like "QA may use
release branches, but only during a freeze". The moment a rule needs context
beyond the role, this shape stops being enough and wants a real policy
evaluator. It is the right size for three roles and the wrong size for thirty.

---

## 3. Visibility is enforced in SQL, never in the handler

**Context.** `dev` sees only main-branch runs. The obvious implementation is to
fetch the list and filter it.

**Decision.** `visibilityClause(role)` returns a SQL fragment and its
parameters, and it is composed into the query. The database never hands back a
row the caller may not see.

Filtering in JavaScript means the browser's response is correct while the
_handler_ has already received rows it should not have. That is not a
restriction, it is a convention — and the moment someone adds an endpoint that
forgets the filter, it is not even that. Enforcing it in the query makes the
restriction structural.

It also fixes a subtler bug: with `LIMIT 25` applied before filtering, a
developer whose recent runs are all on other branches gets an empty list rather
than their own runs. There is a test for exactly this.

**Trade-off.** SQL fragments assembled in code are harder to read than a
`.filter()`, and they are the classic place injection gets introduced. The
mitigation is that the clause returns parameters rather than values — there is a
test asserting the fragment contains no literal — but a query builder would give
the same guarantee with less room for a future mistake.

---

## 4. The webhook signs `timestamp.body`, not the body

**Context.** When a run finishes, the workflow posts the result back. That
endpoint writes the numbers the dashboard displays.

**Decision.** HMAC-SHA256 over `` `${timestamp}.${raw}` ``, with requests older
than five minutes refused.

Signing the body alone is the common version and it is replayable forever:
capture one valid "passed" callback and it can be posted again at any time,
against any run whose id appears in it. Binding the signature to a timestamp and
then enforcing the age is what makes replay a five-minute window instead of
permanent.

Two details that are easy to get wrong:

- The body is read as **text**, not parsed and re-serialised. `JSON.parse` then
  `JSON.stringify` does not reproduce the bytes that were signed — key order and
  whitespace both move — so verification would fail for legitimate callers.
- A small negative age is tolerated (60 seconds) for ordinary clock skew between
  runner and edge. A large one would reopen the replay window.

**Trade-off.** A five-minute window is still a window. Genuinely preventing
replay needs a nonce store, which means another D1 table and a cleanup job — and
for "a workflow reports its own test results" the window is proportionate. If
this endpoint moved money the answer would be different.

---

## 5. Report links are signed, scoped and short-lived

**Context.** Reports live in R2. A Playwright report names environments,
payloads, and failure detail, so the bucket is not public.

**Decision.** A link carries an HMAC-signed token naming one run id and an
expiry. `GET /reports/:runId/*` refuses a token minted for a different run.

The token is accepted from the **query string** as well as a header, which is
normally a smell — URLs end up in logs and referrers. It is accepted here
because the report's own asset requests cannot carry a header: a browser
fetching `report.css` sends no `Authorization`. What makes that acceptable is
the scoping — a leaked link opens one run's report for one hour, not the bucket.

**Trade-off.** Query-string tokens leak more readily than headers, and an hour
is long enough for a link pasted into a chat to be used by someone who should
not have it. A cookie alone would avoid the URL entirely but breaks the "send
someone a link" case that is the whole point of the feature — so the link
stays the way in, and
[decision 14](#14-one-real-allure-report-shared-by-every-simulated-run) adds a
path-scoped cookie _behind_ it, minted only once the token has already been
accepted, because a real report's own assets cannot carry the token.

---

## 6. Simulation is the default, and one flag governs it

**Context.** Without a GitHub token and a repository to spam, none of this runs.
Most readers have neither.

**Decision.** `SIMULATE_DISPATCH` defaults to on. A simulated run walks
queued → running → result and writes a real HTML report into R2, so the whole
flow — including the report link — is exercisable on a laptop with no
Cloudflare account and no GitHub token.

Simulation is **opt-out rather than opt-in** so the safe behaviour is the
default and a real deployment has to state its intent.

The same flag also decides whether the login screen prints dev/qa/admin's
passwords, so a real deployment cannot both dispatch real workflows and still
advertise those credentials. `/demo/preview-role` — letting an authenticated
`demo` session look at another role's read views — is no longer tied to this
flag at all; see [decision 12](#12-a-fourth-role-that-can-never-dispatch-for-real)
for why its safety comes from where it is checked, not from `SIMULATE_DISPATCH`.

**Trade-off.** A simulator is code that exists only for the demo, and it is code
that can drift from what the real path does — it already had a bug where it
overwrote results a real webhook had written (see decision 9). The honest
statement is that it buys reach at the cost of a second code path.

---

## 7. No JWT, no session store, no auth library

**Context.** Sessions need to survive across requests without a database
lookup.

**Decision.** A session token is `` `<exp>.<role>.<hmac(exp.role)>` ``. Signed,
not encrypted — the role is not a secret, tampering is what needs preventing.

There is one issuer and one consumer, the payload is two fields, and a JWT
library would be more surface than the twenty lines it replaces. `alg: none` and
the confused-deputy problems that come with JWT simply do not exist here because
there is no algorithm negotiation to confuse.

Order matters: the signature is verified **before** the expiry is read. An
attacker who could push the expiry out would be stopped by the signature anyway,
but checking in that order means nothing untrusted is parsed first.

**Trade-off.** This is hand-rolled crypto in the sense that matters — a scheme
nobody else has reviewed. It is defensible at this size and would not be at a
larger one; the moment a second service needs to verify these tokens, or
sessions need revoking before expiry, it should become a real library and a real
store. Revocation in particular is impossible as built: a leaked token is valid
for its full eight hours.

---

## 8. Tests run inside workerd against real D1 and R2

**Context.** The Worker's logic is inseparable from its bindings. Mocking
`env.DB.prepare()` to return canned rows tests the mock.

**Decision.** `@cloudflare/vitest-pool-workers` runs the suite inside workerd,
with a real local D1 and a real local R2. Every test drives the exported `fetch`
handler rather than importing a route function, so the middleware chain —
session lookup, then the role gate — is actually exercised.

Half of what is worth testing here exists only at the binding: that visibility
is enforced in SQL, that deleting a run clears its objects out of R2, that the
simulator's `WHERE status IN (...)` guard really refuses to overwrite a finished
run. None of that is observable through a fake `prepare()`.

**Storage is shared across the tests in a file.** The pool's per-test rollback
was removed in the version used here, and — worse — the option for it is
silently accepted and ignored rather than rejected, so relying on it would have
produced tests that only _looked_ isolated. Every test therefore seeds rows
under a unique service name and asserts against those, never against a global
count. That is the same discipline the suite this dashboard triggers runs under,
for the same reason: it is how a test has to behave against a shared real
environment.

**Trade-off.** The suite takes ~40 seconds rather than ~2, mostly because the
simulator sleeps on purpose. Booting workerd per file is real overhead, and the
pool's API has already moved under this repo once.

---

## 9. The bugs the tests actually found

A test suite is worth what it catches. Both of these were found by writing
tests, not by reading code, and both are the kind that look fine in review.

**Run ids collided within a minute.** Ids were
`` `${date}-${hhmm}-${service}` `` — minute precision. Two runs of the same
service in the same minute produce the same PRIMARY KEY, so the second insert
throws and the caller gets a 500 for doing nothing wrong. Two developers
pressing Run on `items` within a minute of each other is an ordinary Tuesday,
not an edge case. Found immediately by a test that created two runs in a row.
Fixed with four random characters, and there is now a regression test named for
the failure.

**The simulator overwrote real webhook results.** The simulator and the webhook
both write the same row. Without a guard, whichever lands second wins — post a
correctly signed webhook for a simulated run and the simulator clobbers the
result a second later, which looks exactly like the webhook silently failing.
Found only by testing a _correctly signed_ callback; every test up to that point
had checked that bad signatures were rejected, which is the easy half. Fixed
with `WHERE status IN ('queued', 'running')`.

**Every test here was proven able to fail.** Seventy-seven mutations were introduced
one at a time — deleting the escalation guard, signing the body without the
timestamp, dropping the visibility clause, widening `dev` to every branch — and
each produced a failure naming the right behaviour. A green suite that has never
been watched go red is a suite with unknown coverage.

---

## 10. Copied layout, changed palette

**Context.** This dashboard's layout, spacing and component shapes come from one
I built at work. That is the point — it is a portfolio stand-in for real work.

**Decision.** Keep the structure; replace the brand colour. The original's
accent is a company's brand red, and a brand colour is identity rather than
craft — reproducing it would make a public repo recognisably theirs.

Indigo replaces it for a second reason beyond avoidance: **on a dashboard whose
entire job is showing pass and fail, a red accent competes with the failure
state.** Buttons, links and focus rings in the same red as "3 failed" costs the
red its meaning. A neutral accent leaves red meaning exactly one thing.

Two things follow from copying rather than redesigning:

- Runs are **cards, not table rows**. A run carries an id, what it covered, a
  branch, a result split three ways, timing and two actions. In columns that is
  unreadable at the width most people have.
- Pass/fail is a **proportional bar** beside the numbers. "112 / 118" needs
  arithmetic before it means anything; a bar that is almost entirely green with
  a sliver of red is read instantly.

Light and dark are two definitions of the same CSS variables, so a component
writing `c.card` is correct in both without knowing which is active. Status
colours are deliberately _not_ variables — green-is-pass should not shift
between themes when someone is reading colour before text.

**Trade-off.** Inline style objects rather than a stylesheet or a CSS framework:
easy to follow in a small app, and it gives up the pseudo-selectors and media
queries that a stylesheet gets for free. Hover states here are the CSS variables
doing the work, not JavaScript, but a larger app would want real CSS.

---

## 11. The run gate fails open, and policy fails closed

**Context.** Self-service running has a scheduling problem the permission model
does not solve. During a release, a dozen developer-triggered runs against a
shared environment is noise at exactly the wrong moment — but the developers
have not stopped being developers, so revoking their role is the wrong tool.

**Decision.** A separate control: one row saying whether `dev` runs are allowed
right now, either manually or for a one-off window. It is checked **after** the
policy, and it returns **503** rather than 403 — the request is permitted and
worth retrying, which is what that status means.

Two properties do the work, and they are opposites:

- **`policy.ts` fails closed.** An unrecognised role gets nothing.
- **`gate.ts` fails open.** A missing row, an unparseable timestamp, a window
  that closes before it opens, a mode nobody recognises — every one resolves to
  open.

That asymmetry is deliberate and is the whole design. **A coordination tool
whose bad data becomes an outage is worse than no coordination tool**, because
the failure lands on people who did nothing wrong and cannot fix it. Anything
that must not be bypassed belongs in the policy table instead.

It gates `dev` only. QA and admin run during a freeze precisely because a freeze
is when release verification happens — a gate that stopped them would be
stopping the work it exists to protect.

`GET /gate` is readable by the role it restricts, so a developer who is refused
can see why and when it lifts rather than filing a bug about a broken button.

**Trade-off.** A second concept that overlaps with authorisation, and a reader
has to learn which failure mode belongs to which. Two mechanisms answering
adjacent questions is a real cost, and at a smaller scale one manual switch
would do. The alternative — expressing "not right now" as a permission — makes
every release a round of role edits and remembering to undo them.

The window is one-off, not recurring. A gate that reopened every morning is a
schedule, which is a different feature with a timezone problem attached; nobody
setting a single window is asking for one.

---

## 12. A fourth role that can never dispatch for real

**Context.** This dashboard is a portfolio piece — the deployment at
`testbydesign.dev` is meant to be tried by a stranger, not just read about. The
three existing roles do not fit that: `dev`/`qa`/`admin` either dispatch a real
GitHub Actions run against a real repository, or the whole deployment sits in
`SIMULATE_DISPATCH: true` and nobody sees a real run ever complete. Flipping
that one flag back and forth per visitor is not a design, it is two
deployments pretending to be one.

**Decision.** A fourth role, `demo`, whose real-vs-simulated behaviour is
decided by the role itself rather than by `SIMULATE_DISPATCH`. Every other
role checks that flag once, in `dispatchWorkflow`, and does whatever it says.
`demo` short-circuits it:

```ts
const simulate = role === 'demo' || env.SIMULATE_DISPATCH !== 'false'
```

So the deployment can run for real — `dev`, `qa`, and `admin` dispatching
actual workflow runs — while `demo` still only ever simulates, regardless of
the flag, the token present, or anything else about the environment. A visitor
using the `demo` password gets a working dashboard with real-looking runs; a
stolen or guessed `demo` password cannot trigger CI on the underlying
repository, because the code path that would do that is never reached for
that role. [`demo-role-safety.test.ts`](../packages/api/test/demo-role-safety.test.ts)
proves the second half by mocking `fetch` and asserting it is never called —
and by mutation-testing the guard itself: deleting the `role === 'demo' ||`
clause makes that suite fail, and the mutant's `dev`-shaped request reaches
the real GitHub API and comes back `401 Bad Credentials`, which is exactly
what the guard exists to prevent a `demo` request from doing.

`demo`'s password is deliberately weak — the default is the string `"demo"`,
and `assertDeployable` does not require `DEMO_PASSWORD` to be set before a
real deployment starts, unlike the other three secrets. That is not an
oversight: this role's safety was never password secrecy, it is the dispatch
guard above. Requiring a strong `DEMO_PASSWORD` would imply the opposite and
be a promise this role does not need to keep. `GET /auth/dev-credentials`
reflects the same asymmetry — outside simulation it hides `dev`/`qa`/`admin`
passwords but keeps printing `demo`'s, because hiding it would gate a link
meant to be handed out and gain nothing.

Scoping `demo` to only the runs it started itself needed
[`visibilityClause`](#3-visibility-is-enforced-in-sql-never-in-the-handler) to
stop assuming visibility is always about `ref` — it previously returned only a
SQL fragment, and `GET /runs/:id` re-checked a single fetched row by comparing
it against `params[0]` under that assumption. `demo` is scoped by
`triggered_by`, not `ref`, so the function's return shape grew `column` and
`value` fields naming what it actually checked, and the single-row re-check
became generic. Anyone else visiting the deployment as `demo` sees a
plausible, populated history without seeing what other visitors ran.

**Trade-off.** A second axis of trust now exists alongside `SIMULATE_DISPATCH`
— "is this deployment simulating" and "is this role trusted" are no longer the
same question, and `dispatchWorkflow` and `visibilityClause` both carry the
extra branch permanently to keep them separate. For a dashboard with one real
audience (developers on a team) that would be needless complexity for a
guarantee nobody asked for. It earns its cost here because the audience
includes strangers who can only be given a password, never a role assignment.

---

## 13. A second, narrower cookie for looking at another role's view

**Context.** `demo` originally could switch to any role via `/demo/switch-role`
— but that endpoint minted a real session token (`createToken(secret, role)`)
for whatever role was requested, gated only by `SIMULATE_DISPATCH`. On a real
deployment that flag is off, so the endpoint refused everyone outright — which
meant a stranger on `testbydesign.dev` could never see what `qa` or `admin`'s
view looks like, the whole point of trying the dashboard at all.

Widening the gate to "any authenticated `demo` session may call this" would not
have been safe: a session token's HMAC covers only `role` and `exp` (see
[decision 7](#7-no-jwt-no-session-store-no-auth-library)) — nothing marks a
token "obtained via demo escalation" versus a real login. Once
`createToken(secret, 'admin')` runs, the resulting cookie is indistinguishable
from a genuine admin session, and `dispatchWorkflow`'s `role === 'demo'` guard
above no longer protects it — by the time a request reaches that function,
`role` really is `'admin'`.

**Decision.** `POST /demo/preview-role` mints no session token at all. A
genuine `demo` session (checked via `requireSession`, then `role === 'demo'`)
gets a second, distinctly-named `preview-role` cookie instead — HMAC-signed,
but never passed to `verifyToken`, and bound to the _underlying session's_
expiry rather than one of its own, so it cannot outlive the session it rides
on. Exactly one thing reads it: `resolveViewRole` in `routes/runs.ts`, used
only by `GET /runs` and `GET /runs/:id` to decide which role's
`visibilityClause` to answer with. `POST /runs`, `DELETE /runs/:id`, and
`dispatchWorkflow` all keep reading `c.get('role')` directly — the real,
authenticated role — completely untouched by this feature.

The alternative considered and rejected was extending the session token itself
with a "viewing role" claim distinct from the authorising one. That would have
meant every consumer of `Role` — `policy.ts`, `github.ts`, `requireRole`, both
run routes — needing to correctly pick the authorising field over the viewing
one, everywhere. A second cookie that only one narrow, read-only function ever
looks at is a smaller, more legible surface: one thing to get right, not many.

[`preview-role-safety.test.ts`](../packages/api/test/preview-role-safety.test.ts)
proves the boundary holds: a `demo` session previewing `admin` still gets 403
from `POST /runs` against a ref only admin may use, still gets 403 from
`DELETE /runs/:id`, and still only ever simulates a dispatch — identical to
plain `demo` with no preview cookie at all. Mutating `POST /runs` to consult
the preview cookie for its ref check makes that suite fail, confirming the
test would actually catch the regression it exists to catch.

**Trade-off.** Two cookies now travel together, and a reader has to learn that
one authorises writes while the other only shapes what reads return — a
subtler distinction than "logged in or not." The alternative (one token,
carefully layered fields) would have been one artifact to reason about instead
of two, at the cost of every write path needing to get the field choice right
rather than simply not being wired to a new concept at all.

---

## 14. One real Allure report, shared by every simulated run

**Context.** Simulated runs used to write a small stand-in HTML page — a badge,
four numbers, and a note admitting it was a placeholder. It proved the link
resolved, and nothing else. The dashboard's whole subject is test results, and
the one screen showing them was a mock.

The obvious fix is to store a real Allure report per run. Allure's default
output for this suite is **4.6 MB across 444 files** — a JS bundle, fonts, and
one JSON per test — which rules out bundling it into the Worker (megabytes of
base64 on every cold start) and makes copying it per run expensive: the R2
binding has no server-side copy, so duplicating it is 444 `get`s plus 444
`put`s against a **1000-subrequest limit**, for bytes identical to last time.

**Decision.** Build the report with Allure's `--single-file`, which inlines all
of that into one `index.html`, and store one of them at a fixed `demo-report/`
prefix that every simulated run points at. `report_path` on the row names which
prefix holds a run's report; `routes/reports.ts` reads that column instead of
assuming `runs/{id}/`. Real runs record their own, so a real run whose upload
never arrived still 404s rather than quietly serving someone else's results.

The numbers on the dashboard are still each run's own — only the report body is
shared. That is the honest trade: a visitor sees a genuine Allure report with
real suites, filters and a search index, and it is a sample rather than a
rendering of the run they just started.

**The multi-file form was tried first, and it is why `--single-file` is not
just a convenience.** Allure's `index.html` pulls its JS, CSS and fonts by
_relative_ path, and a browser does not carry the opening link's query-string
token onto those requests — so every asset arrived unauthenticated and 401'd,
leaving a report that rendered as a spinner forever. The fix was a cookie
scoped to `/reports/{runId}/`, set when the entry point is served and accepted
in the token's place. Then the cookie did not arrive either, because the entry
point was still marked `max-age=3600` and the edge replayed a cached copy
without running the handler. The page that carries a cookie cannot itself be
cacheable.

Both of those are still in place — a real run's report is a single file, but
the cookie costs nothing and keeps the route correct for any report that is
not. The lesson is the shape, not the workaround: **hundreds of individually
authorised assets is a hard thing to serve behind a link-scoped token, and one
file is not.** One upload, one object, one authorisation.

**A real run uploads its own, and does it from CI.** The workflow builds the
report on the runner and PUTs that one file into the reports bucket at
`runs/{run_id}/index.html`, with a Cloudflare token scoped to object-write on
that one bucket. The alternative — POSTing the bytes to an endpoint here —
means a body-size limit, a parser, and a signing scheme over a payload too
large to buffer before verifying, all so several megabytes can travel through
a Worker to reach a bucket the CI job can already write to. Decision 4 sized
the webhook's trust model for "a workflow reports its own test results", a
small JSON POST; a report is a different shape of thing and gets a different
channel rather than a widened one.

The callback runs **after** the upload and only claims `reportPath` when it
succeeded. `report_path` is what the serving route trusts, so a path recorded
for bytes that never arrived is a link that 404s — and the upload is
`continue-on-error`, because a run whose numbers arrive without a report is
worth more than a run the dashboard never hears about.

**Trade-off.** A report that is not this run's results is a claim the UI has to
be careful not to overstate, and one shared prefix means one report for every
simulated visitor rather than per-run history. Uploading the shared one is a
manual step (`scripts/upload-demo-report.mjs`) that no test can prove was run —
the suite can only check that the code points where the upload is _supposed_ to
land. The alternative, a per-run copy, buys accuracy nobody is asking for at a
cost the platform will not accept.

The real path costs a credential in the other repository, which is the honest
price of not building an upload endpoint: CI can now write to this bucket, and
what leaks if that token leaks is the ability to write reports. Scoping it to
one bucket is what keeps that bounded. It also means the integration has three
meeting points to keep in step rather than two, none of them checked at compile
time — the same class of drift that had already broken the dispatch contract
once.

---

## How to add a decision

Write it when the reasoning is still fresh, and include the cost. If the
trade-off section reads as "no real downside", the decision has not been
examined hard enough yet — go back and find who it makes life worse for.
