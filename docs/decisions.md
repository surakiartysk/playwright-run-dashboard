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
15. [Machine keys the dashboard issues, not GitHub tokens it hands out](#15-machine-keys-the-dashboard-issues-not-github-tokens-it-hands-out)
16. [What can be switched off, and what the two repos agree on](#16-what-can-be-switched-off-and-what-the-two-repos-agree-on)
17. [Green and red never carry a result on their own](#17-green-and-red-never-carry-a-result-on-their-own)

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

**Every test here was proven able to fail.** Ninety-seven mutations were introduced
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

**That argument was later applied to the typeface, where it always belonged.**
The face here was Prompt — the original's, a Thai typeface carried onto an
all-English tool without anyone deciding it should be. A house face is identity
in exactly the way a brand colour is, and this decision had the reasoning
without noticing the second thing it applied to. Archivo replaces it, paired
with JetBrains Mono under one rule: anything the machine produced is set in
mono, anything a person wrote is not.

So the split is now explicit. The **structure** came from the work — the run
card, the proportional bar, what sits next to what. The **surface** is this
repo's own: type, palette, density, and the order of the page. What travelled is
the thinking, which is what a portfolio piece is for; the paint is not evidence
of anything.

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

## 15. Machine keys the dashboard issues, not GitHub tokens it hands out

**Status: built.** `apiKeys.ts`, `routes/keys.ts`, migrations 0005 and 0006.
The design below is what was built, with one correction recorded at the end.

**Context.** Everything here assumes a person at a browser: a session cookie, an
eight-hour token, a form. The case it does not serve is the one that matters
most in practice — a deploy pipeline that wants to verify an environment the
moment it finishes deploying, at 03:00, with nobody watching.

The obvious answer is to hand developers a GitHub personal access token so their
pipeline can call `repository_dispatch` directly. That is worth examining, and
then rejecting, because **GitHub's scopes cannot express the rule we already
enforce**. A token that can dispatch a workflow needs `actions: write` on the
repository, and that is the whole grant: it can start _any_ workflow, against
_any_ ref, read Actions logs, and it keeps working until someone remembers it
exists. There is no scope meaning "smoke, against `main`, four workers". We
already have that rule, in `policy.ts`, and handing out a PAT routes around it.

**Decision.** The dashboard issues its own keys, and a key is a credential whose
authority is defined here rather than at GitHub. One `GITHUB_TOKEN` stays
server-side, as it is today; a pipeline authenticates to _this_ API, and every
rule already written applies to it unchanged.

The seam already exists. `requireSession` accepts `Authorization: Bearer` today
because a session token can be sent that way — a key is a second thing that
header may carry, resolved to a role and a set of limits before any handler
runs. `mayUseRef`, `maxWorkers` and the gate then work exactly as they do for a
person, because by that point the request looks like one.

```
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,       -- the public half, in the key itself
  hash         TEXT NOT NULL,          -- HMAC of the secret half; never the secret
  label        TEXT NOT NULL,          -- 'checkout-service deploy pipeline'
  role         TEXT NOT NULL,          -- the policy row it inherits
  allowed_refs TEXT,                   -- narrower than the role, never wider
  max_workers  INTEGER,                -- same
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,                   -- what makes an unused key visible
  revoked_at   TEXT                    -- kept, not deleted: history stays readable
);
```

Four properties are doing the work:

- **Only the hash is stored.** The key is shown once, at creation, and is
  unrecoverable afterwards — the same reason passwords are not stored either.
  The `id` prefix travels in the key so a lookup is one indexed read rather than
  a scan comparing hashes.
- **A key may narrow its role, never widen it.** `allowed_refs` on a key
  intersects with the role's; the effective answer is the stricter of the two.
  A key that could grant more than the role it names would be a second
  permission system, and the first one would stop being the truth.
- **`triggered_by` records the key, not just the role.** "Who ran this?" has to
  survive being answered by a machine, and a run history where every automated
  row says `dev` is a history that cannot answer it.
- **Revocation is a column, not a delete.** A revoked key's runs stay
  attributable. Deleting the row would orphan them.

**The gate applies to keys.** A `dev`-level key is blocked during a freeze
exactly as a developer is, and gets the same 503. This is the one that looks
wrong at first: a pipeline is not a person, and blocking a deploy verification
feels like collateral damage. It is not — the gate exists because a dozen runs
against a shared environment during a release is noise at the worst possible
moment, and an automated caller retrying every thirty seconds is _more_ of that
problem, not less. A pipeline that must run during a freeze is asking for a
`qa`-level key, and that should be a decision someone makes, not a default it
inherits by being a machine.

**Trade-offs.**

This is a credential system, and the cost is that it never stops being one. It
adds a table, a hashing path, a management screen, and a revocation story that
has to actually work under pressure — at 02:00, when a key is leaking, by
someone who did not build it. `wrangler secret` covers today's single token
with none of that.

It also moves this repository across a line. The dashboard currently holds one
secret and authenticates humans against three passwords; after this it is
issuing credentials to other systems, which is a category of thing that attracts
requirements — expiry, rotation reminders, an audit trail someone will
eventually want exported. None of that is hard. All of it is more surface than
the thing it protects, which is the ability to run a test suite.

And the honest limit: a key is only as narrow as the policy behind it. Every
sharpening of what a key may do is a change in `policy.ts`, which means the
answer to "can I have a key that only runs smoke on Tuesdays" is no, and stays
no until someone extends the policy model. A key system does not make the
permission model finer-grained; it only lets a machine use the one that exists.

**What building it changed.** One bug, and it is the one this shape invites.

`DELETE /runs/:id` is guarded by `requireRole('admin')`, which checks the role
and stops there — and a key _carries_ a role. So an admin-level key deleted a
run, despite `effectivePolicy` refusing deletion to every key regardless of
role. The guard and the rule disagreed, and the guard won.

That is the cost of the central design choice. Making a key look like a person
by the time a handler sees it is what lets `mayUseRef`, `maxWorkers` and the
gate apply unchanged — and it means **any rule enforced by role alone silently
extends to keys**. The fix is explicit at the delete handler; the lesson is that
each new role-only guard has to decide about keys deliberately.

Found by a test rather than by review, which is the only reason it is a
paragraph here instead of an incident.

**The endpoints.**

```
POST   /keys       mint one; returns the plaintext once, admin only
GET    /keys       list, including revoked, never anything reconstructable
DELETE /keys/:id   revoke; revoking twice is success, not an error
```

Authenticate with `Authorization: Bearer rdk_<id>_<secret>`. A key is refused
with "API key is invalid or revoked" rather than falling through to session
verification, so a pipeline debugging a 401 is not sent looking for a login
problem that does not exist.

---

## 16. What can be switched off, and what the two repos agree on

**Status: designed, not built.** The branch-naming half of this is corrected in
the code today; the toggle model and the sync are written down, not implemented.

**Context.** Two questions that look separate and are the same question.

_The first:_ the only thing an operator can switch is the run gate, which is one
boolean for one role. There is no way to say "the maintenance-logs service is
being rewritten, stop offering it", or "nobody may use sixteen workers this
week", without editing `policy.ts` and redeploying. A policy table is the right
shape for rules that change when someone's job changes; it is the wrong shape
for facts that change on a Tuesday afternoon.

_The second:_ the dashboard offers a list of services and tags that is **copied
by hand from the suite's workflow**, and it now lives in three places —
`RunTrigger.tsx`, `WORKFLOW_ACCEPTS` in `integration-contract.test.ts`, and
`on-demand.yml` itself. Adding a service to the suite means remembering all
three. The contract test catches a mismatch between two of them; nothing catches
the workflow drifting from both.

Both are the same failure: **a fact about the suite is stored in the dashboard**,
and the two go out of step because nothing makes them agree.

**Decision — the toggle model.** Three tiers, distinguished by who owns the fact
and how fast it changes. Merging them is the mistake to avoid: it is what turns
a coordination switch into an authorisation bypass.

| Tier                       | Owner                    | Lifetime                 | Fails  |
| -------------------------- | ------------------------ | ------------------------ | ------ |
| **Policy** (`policy.ts`)   | whoever grants access    | changes with a job title | closed |
| **Gate** (D1, exists)      | whoever runs the release | hours or days            | open   |
| **Availability** (D1, new) | whoever owns the suite   | a sprint                 | open   |

Availability is the new tier, and it is deliberately not a permission. It
answers "is this worth offering right now?" — a service mid-rewrite, a tag whose
specs are all skipped, a worker ceiling lowered while the shared environment is
fragile. It cannot grant anything: a service switched **on** that a role may not
run is still refused by `policy.ts`, because availability narrows the offer and
never widens it.

```
CREATE TABLE availability (
  kind     TEXT NOT NULL,        -- 'service' | 'tag'
  name     TEXT NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1,
  note     TEXT,                 -- 'being rewritten, back after the 14th'
  updated_at TEXT, updated_by TEXT,
  PRIMARY KEY (kind, name)
);
```

`note` is not decoration. A disabled option with no reason produces a message to
whoever owns the dashboard; one that says why does not. The gate already proved
this — it records `updated_by` for exactly that reason.

It fails **open**, like the gate and unlike policy: an unknown service, a missing
row, an unreachable table all resolve to available. A coordination tool whose bad
data becomes an outage is worse than no coordination tool, and anything that must
not be bypassed belongs in the policy table, which fails closed.

**Decision — the sync.** The suite owns the list; the dashboard asks rather than
remembers.

`on-demand.yml`'s `options:` lists are already the single source of truth — they
are what GitHub validates a dispatch against, so a value the dashboard invents is
rejected at the boundary no matter what any local list says. The fix is to stop
keeping a second copy:

1. The suite publishes `suite-manifest.json` at a known path — services, tags,
   styles, and the suite version — generated from the workflow in CI so it cannot
   drift from the `options:` lists that validate the dispatch.
2. The dashboard fetches it on a schedule, caches the result, and offers what it
   found. `SERVICES` and `TAGS` stop being literals.
3. The manifest is **cached, and the cache is authoritative when the fetch
   fails**. A dashboard that cannot reach GitHub must still offer yesterday's
   list rather than an empty dropdown — the suite has not changed just because
   the network did.
4. `WORKFLOW_ACCEPTS` in the contract test stays hand-copied **on purpose**.
   Deriving it from the same manifest would make the test assert that a file
   equals itself. Copying is what makes it a test.

Availability then layers on top: the manifest says what exists, the table says
what is being offered today, and the dropdown shows the intersection with an
explanation for anything missing.

**Trade-offs.**

The manifest adds a network dependency to a form that currently has none, and a
cache is a thing that can be stale in a way nobody notices — the failure mode
moves from "the list is wrong because someone forgot" to "the list is wrong
because a fetch failed quietly three weeks ago". That is a better failure, but it
is not no failure, and it needs the staleness to be visible in the UI rather than
inferred.

The availability table is a third place to look when something is unexpectedly
unavailable, after the policy and the gate. Three tiers is more than a
three-role dashboard strictly needs, and the honest defence is only that merging
any two of them makes a coordination switch and an authorisation rule the same
object — which is the failure this repo already argues against in decision 11.

And the sequencing cost: the manifest is worth building the moment a service is
added or renamed, and not before. Today the list has been stable since the repo
was written, so this would be infrastructure protecting against a change nobody
has made yet.

---

## 17. Green and red never carry a result on their own

**Context.** This dashboard's entire subject is whether a run passed. Pass is
green, fail is red, and that pairing is so conventional it stops looking like a
decision — which is how it survived unexamined until the palette was measured
rather than judged.

Run against a colour-vision validator, `#22c55e` and `#ef4444` separate by a
**ΔE of 7.4 under deuteranopia** (OKLab ×100). The working target is 8; the band
from 6 to 8 is usable _only_ where something other than hue also carries the
meaning. Roughly one man in twelve has some form of the deficiency, and green
against red is the pair it flattens hardest.

Most of the UI was already safe by accident rather than intent: the status badge
prints `passed` beside its colour, the result numbers read `44 / 45 · 1 failed`,
and the stat tiles colour a figure that is itself the value. In each of those the
hue is emphasis on a fact the text already states.

**Two places were not.**

The trend chart drew each run as a 4px dot whose only difference between passed
and failed was hue — no label, no shape, no size. Against a chart whose whole
job is showing which runs went red, that is the failure mode in its purest form.
A failed point is now drawn larger and ringed in the surface colour, so it
survives greyscale, printing and forced-colours mode, and carries a `<title>` so
hovering names it.

The result bar butted its segments together, so a sliver of failures met the
pass fill at a boundary drawn in hue alone. A 2px gap makes the boundary
structural; the colour is now the label on it rather than the edge itself.

**Trade-offs.**

The validator also reports the greens and ambers below 3:1 contrast against the
light surface, and that is not fixed here. Darkening them to clear the ratio
would make a green that reads as a warning state and cost the instant "mostly
green" recognition the bar exists for. The relief the check demands — a visible
label beside every coloured mark — is present throughout, which is what makes
that trade legitimate rather than ignored.

`neutral` fails the chroma floor by reading as grey. It is meant to: it fills the
remainder of a bar where tests neither passed nor failed, and a saturated hue
there would claim a meaning that segment does not have.

And the honest limit: this was measured once, by hand, against one palette. There
is no check in CI that would catch someone adding a fifth status colour and
putting it next to red. The reasoning is written down here, which is weaker than
a test, and is the same class of gap the landing page's claim checker exists to
close on the other side.

---

## 18. The run list is a table, and it can be paged

Decision-shaped because it reverses one. The list was a card per run, and this
file's own reasoning for that is quoted in the component: a run carries more
than a table row wants to hold — an id, what it covered, a branch, a result
split three ways, timing, and two actions.

That reasoning was sound about a single run and wrong about a list of them. The
job of a run history is comparison: which run went red first, whether one branch
fails more than the others, whether the failure count is climbing. Comparison is
exactly what a stack of cards prevents, because the eye has to re-find the same
field inside each block instead of running down a column. Cards read well at five
runs, and the dashboard's own production database had thirteen.

So the row carries what gets compared — status, what ran, result, when, how long
— and everything else moves into a detail row the reader expands: full id,
worker count, suite provenance, and the report and delete actions. Nothing the
cards showed was dropped; it stopped being shown all at once.

### The part that was actually broken

Underneath the layout question was a defect. `GET /runs` took a `limit`, the UI
sent 25, and there was no cursor and no offset — so run 26 was not below the
fold, it was **unreachable**. Nothing on screen said so either: without a total,
a truncated list and a complete one look identical.

Both halves are now fixed. The endpoint returns `total` and `nextCursor`, and the
list says "showing 25 of 37" whenever those disagree.

### Why the cursor is a pair

`(started_at, id)`, not `started_at`. The timestamp is a plain TEXT column with
no uniqueness guarantee, and a cursor on a non-unique key silently drops rows or
repeats them when two runs land either side of a page boundary in the same
second. Production had no duplicate timestamps when this was written, which is a
statement about today's data rather than about the schema — the pair makes the
order total regardless.

The cursor clause is **ANDed onto** the visibility clause, never substituted for
it. A mutation that enforced scoping on the first page only — the exact shape a
careless refactor would take — let a `dev` page into other branches' runs, and is
now pinned by a test.

### Trade-offs

- **The poll drops loaded pages.** While a run is in flight the list refreshes
  every two seconds, and it refreshes page one only. Someone who had loaded four
  pages is returned to twenty-five rows. Refetching every page on a timer would
  multiply request count by however far they had scrolled, and stitching a fresh
  page one onto stale later pages duplicates a run whenever a new one arrives at
  the top. Losing the extra pages is the cheap, honest option — and while a run
  is in flight, the top is what is being watched.
- **The detail row hides things that used to be visible.** A reader scanning for
  a suite version now clicks. That is the cost of the column that made the list
  scannable, taken deliberately.
- **`total` is one more query per list request.** Counted through the same
  visibility clause as the rows, so it is never a count of runs the caller
  cannot reach.

---

## 19. Admin controls belong in one place, and the ones with no UI were the point

`GateControl` opens with a note that `PUT /gate` shipped and nothing in the UI
could reach it. The same sentence was true of `POST /keys`, `GET /keys` and
`DELETE /keys/:id` — the entire machine-key feature of decision 15, reachable
only with curl. Decision 15 says the dashboard issues keys and defines their
authority; for anyone without a terminal, it did not.

That is twice now, which makes it a pattern rather than an oversight: this repo
builds the route, documents the reasoning, and stops before the surface. It is
worth naming here so the next feature is not the third.

Both controls now live in one collapsed panel, badged `admin`, with the gate and
key management as tabs. Collapsed because an admin opens this dashboard for the
same reason everyone else does — to see whether the last run passed — and the
operational levers are the exception. Set apart from the flow because a control
that changes things for everyone should not look like a control that changes
your own view.

### The one-time secret

`POST /keys` returns the plaintext once; the database holds only a digest. The
panel that shows it is deliberately not a toast and cannot be dismissed by
clicking elsewhere — a secret lost to a stray click costs a re-mint and leaves a
dead key in the list. It stays until acknowledged.

### Trade-offs

- **A collapsed panel is a click away from being found.** An admin who has never
  opened it may not know key issuing exists. The alternative — controls that
  change things for everyone, expanded by default above the run history — is
  worse.
- **The key form exposes the server's vocabulary.** Branches are a comma list
  and workers a number, because that is what the API takes. A friendlier form
  would have to invent a mapping this repo would then have to keep in sync, which
  is the drift decision 16 is about.
- **Nothing in CI checks that a shipped route has a way in.** This decision, like
  decision 17's colour note, is reasoning written down where a test would be
  stronger. It is the same gap, named twice, which is itself the argument for
  closing it.

### What building it exposed

The dev proxy did not forward `/keys`. Vite falls through to the SPA index for
an unlisted route, so the request returned **HTML with a 200**, the component
read `response.keys` off it, got `undefined`, and threw — taking the whole
dashboard down, not just the panel. Two fixes: the proxy lists the route, and
the component treats a response without a `keys` array as empty rather than
destructuring blind. The same class of miss as the production Worker route that
`/keys*` needed in decision 15 — a route that exists on the server and is
unreachable from the client is invisible until something calls it.

---

## 20. Bars, not a line — runs are discrete events

The pass-rate panel drew a polyline with a filled area under it. That shape
makes a claim about the data that is not true: a line says the quantity was
continuous and we sampled it, so the segment between two runs draws a pass rate
for a moment when no run existed. Runs are discrete events a few times a day,
not a signal.

Grafana draws the same line — a bar chart for categorical or discrete data, a
time series for a continuous one — and recommends bars only while the count
stays small. Production had thirteen runs.

Bars also fix what the line could not show. A failed run was a 3px dot on a
polyline; it is now a red column of its own, with a faint full-height wash
behind it so it is findable at a glance in a row of green.

### The stretch, and the letterbox

The old chart used `viewBox="0 0 100 100"` with `preserveAspectRatio="none"`,
scaling x and y by different factors. That is why it looked cheap: a circle
rendered as an ellipse — the failed-run dot was a flattened red smear — and
every stroke needed `vectorEffect="non-scaling-stroke"` to stay even.

The first fix was `meet`, and it was wrong in the other direction: it
letterboxes, so a 320-unit box in a 900px panel drew the chart down the middle
with a third of the panel empty on each side. It reverted to `none`, which is
correct **for this shape**: a stretched rectangle is still a rectangle, and its
width carries no meaning here — the bars divide whatever room they are given.
The corner radius went with it, because a radius drawn in a stretched space is
rounder on one axis than the other.

### Two floors

- **Minimum bar height.** A run at the bottom of the drawn range maps to zero
  height, so the run that failed hardest — the one most worth seeing — is the
  one that disappears.
- **Minimum bar width.** A page holds up to 100 runs and the reader can load
  more; past about ninety the natural width drops under two units and the chart
  becomes a grey smear.

Both were written with a test that passed whether or not the guard existed —
`domain` pads the range, so a two-run spread never reaches the true floor, and
sixty runs never reach the width guard. Both tests were tightened until they
failed against the mutation. Worth recording because it is the failure mode this
repo's mutation rule exists to catch: a test that asserts on the right property
in a case that never exercises it.

### Trade-offs

- **A trend is easier to see in a line.** Direction is what a line is good at,
  and bars trade some of that for honesty about what was measured. The
  header keeps the change in points, which is the part of the trend a reader
  actually quotes.
- **Bars cost more marks.** One rect per run against one polyline for all of
  them, plus a wash per failure. At the sizes this panel shows, that is
  nothing; at a thousand runs it would be a different decision.

---

## 21. The diagrams scroll on a phone rather than shrink

`figure svg { max-width: 100% }` is the standard advice for a responsive SVG and
it was quietly ruining the landing page. An 800-unit diagram squeezed into a
343px phone scales its 10px labels to **4.3px** — the figure stays on the page,
costs a screen of height, and cannot be read. The page passed every check that
looks for horizontal overflow, because there was none: the drawing had been
shrunk into uselessness instead.

Below 760px each figure now scrolls sideways inside its own container, with the
SVG held at a minimum width. Labels render at 7.8–10.8px, the reader pans, and
the page itself still never scrolls horizontally. A hint under the figure says
so, shown only where the scroll exists.

### Trade-offs

- **Panning is worse than seeing it all at once.** It is better than a diagram
  that is present and illegible, which is what was shipped.
- **The breakpoint is a guess.** 760px is where the page's other rules already
  switch, not a measurement of these particular drawings. A tablet at 768px sits
  just above it and scales to 8.6px, which is legible but not comfortable.
- **A diagram redrawn for narrow screens would beat both.** That means a second
  layout per figure to keep in sync, and these diagrams already carry the
  page's most-checked claims.

---

## 22. A limit on demo runs, and why it is not a security control

`demo`'s password is published — in this README, on the landing page, and
behind a one-click button on the sign-in screen. That is deliberate, and the
containment around it is real: a demo run is always simulated and never reaches
a real workflow (the `role === 'demo'` term sits first in `dispatchWorkflow`'s
`simulate` expression, so no deployment flag can turn it off), it sees only the
runs it started itself, and it cannot delete anything or reach the gate or the
key routes.

What a stranger _can_ do is start simulated runs in a loop. The only casualty
is rows in D1, which is a housekeeping problem rather than a security one — and
it is the one thing the published password actually exposes.

So `POST /runs` refuses a demo run once thirty have started in the last hour,
with a 429. Deliberately generous: the number exists to stop a script, not to
interrupt a visitor clicking Run a few times to see what happens, which is
exactly what the button invites. The message names the way around it — clone
the repo and run it locally, where there is no limit at all.

### One shared bucket, not one per visitor

A demo session carries no identity beyond its role; that is the point of it.
There is nothing honest to key a per-caller bucket on. IP is the usual answer
and is both spoofable and shared by everyone behind one NAT, so it would punish
an office while barely inconveniencing a script.

The cost is real and worth stating: one person hammering the demo can lock the
button for everyone else for up to an hour. That is acceptable here because the
locked-out visitor loses a demo, not their work — and the message tells them
where to get an unlimited one.

### Checked last

The limit is evaluated after the ref and gate checks. A caller who is over the
limit _and_ asked for a branch they may never use should hear about the branch:
that answer does not change in an hour, and telling them to come back later
would send them round the same wall twice.

### What was already covered, and what was not

`demo-role-safety.test.ts` pinned the dispatch half of this from the start.
Nothing pinned the other half — that one visitor cannot see another's runs, or
delete, or reach the admin routes — which is the half the published password
makes interesting. `demo-isolation.test.ts` covers it now, and removing the
visibility clause turns it red.

---

## How to add a decision

Write it when the reasoning is still fresh, and include the cost. If the
trade-off section reads as "no real downside", the decision has not been
examined hard enough yet — go back and find who it makes life worse for.
