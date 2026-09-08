# CLAUDE.md

Working notes for AI assistants (and humans) contributing here.

Deliberately one short file, and deliberately not a second copy of
[CONTRIBUTING.md](CONTRIBUTING.md) — that one covers setup, how to run things,
and the mechanics of adding an endpoint or a migration. This one is the rules
you break first, and the reasons they exist. Grow it only when something
actually goes wrong twice.

## What this repo is

A portfolio piece: a self-service test-run dashboard that really dispatches
two published suites and serves their reports. The audience is engineers who
will read the reasoning and ask about it — so **`docs/decisions.md` is the
deliverable, not an artifact of the code**. Anything that cannot be explained
in an interview does not belong here.

```
packages/api    Cloudflare Worker — Hono, D1, R2
packages/ui     React + Vite
```

The interesting part is not the Run button. It is _who may run what, and who
may then see the result_ — so anything touching `policy.ts`, `auth.ts` or
`visibilityClause` deserves more care than its line count suggests.

## Non-negotiables

**1. Nothing from the source material.** Patterns and reasoning travelled from
production work; code, endpoints, field names, and business rules did not.
`pnpm check:leak` enforces a vocabulary denylist on every CI run. If it fires
on innocent code, narrow the pattern in `scripts/check-leak.mjs` — never work
around it by renaming a variable.

**2. Every test must be proven able to fail.** Ninety-nine deliberate mutations
are recorded, and two real bugs came out of writing them — see
[decision 9](docs/decisions.md#9-the-bugs-the-tests-actually-found). A green
suite means nothing until you have watched it go red for the right reason.

**3. Visibility is enforced in SQL, not in a handler.** `visibilityClause`
scopes what a role may see inside the query, so a handler that forgets to
filter still cannot leak rows. Never re-implement that filtering in
JavaScript, and never add a query over `runs` that skips it.

**4. Policy fails closed; the gate fails open.** Two rules that look alike and
are not. A role that may not run something is refused; a run gate with bad
data lets runs through. That asymmetry is deliberate — see
[decision 11](docs/decisions.md#11-the-run-gate-fails-open-and-policy-fails-closed)
— so do not "fix" the gate into failing closed.

**5. A key is not a person.** An API key carries a role, so a rule enforced by
role alone silently applies to keys too. That is exactly how an admin-level key
once reached the delete handler. Where an action has no automated use case,
refuse keys explicitly — `DELETE /runs/:id` is the worked example.

**6. `demo` always simulates, whatever the deployment says.** Its password is
published, so a real dispatch behind it would let anyone spend Actions minutes
or drive a workflow against a ref they choose. `SIMULATE_DISPATCH` is
deployment-wide; the `demo` exception is separate and must stay that way — see
[decision 12](docs/decisions.md#12-a-fourth-role-that-can-never-dispatch-for-real).

**7. Comments must be true.** A comment describing behaviour that does not
exist is worse than no comment — a reader will believe it and ask about it. If
you remove behaviour, remove its comment.

**8. Every decision carries its cost.** `docs/decisions.md` closes by saying a
trade-off section reading "no real downside" means the decision has not been
examined hard enough. Do not add one without its cost.

## The two things that have actually broken deployments

**Migrations run before the Worker.** Deploying the Worker first gives a **500
on every callback** — the new code selects a column the database does not have,
and the only visible symptom is runs that never leave `running`. That happened
when 0004 was added. The order is: migrations → Worker → UI.

**`wrangler deploy` without `--var` silently reverts to simulating.** The
tracked `wrangler.toml` holds `SIMULATE_DISPATCH = "true"` and placeholder repo
names on purpose, so a clone never inherits a live deployment's configuration.
Pass the vars on the command line; the dashboard keeps working and quietly
stops dispatching anything real if you forget.

## The contract with the suites

This dashboard dispatches two repositories, and neither can import the other.
Three things have to stay in step, and only a test holds them there:

- **The workflow inputs.** Both suites' `on-demand.yml` declare the same names.
  GitHub rejects a dispatch carrying an input a workflow does not declare — the
  whole request fails — so a body that branched per suite would be a second
  thing to maintain.
- **The report path.** The workflow writes `runs/{runId}/index.html` into R2;
  this repo serves from that prefix.
- **The callback shape.** Signed over `timestamp.body`, refused after five
  minutes.

`packages/api/test/integration-contract.test.ts` pins all three by hand.
Copying is the test: deriving the values from the other repos would need them
checked out, and asserting against a list this repo generates would agree by
construction and prove nothing. It has already caught a real mismatch — a
service name sent in an input that only accepted package names, which would
have rejected every dispatch.

## Adding a suite

`suite` is a closed union of two, and a third is a real change rather than a
new row: its own `GITHUB_*_REPO` pair, a migration widening the CHECK
constraint, an entry in the dashboard's service lists, and the contract test's
accepted values. See
[decision 24](docs/decisions.md#24-a-second-suite-and-why-it-is-a-column-rather-than-a-naming-convention).

## Commands

```bash
pnpm verify        # what CI runs: format, lint, types, leak, tests, claims
pnpm dev           # Worker and UI together
pnpm db:migrate    # local D1
pnpm check:leak    # the vocabulary tripwire alone
```

## Working style

Propose an approach and say what it costs, not just what it does. Expect
pushback; several decisions in `docs/` came from arguing one down. Do not
report work as complete without running `pnpm verify` — and do not describe a
test as passing without having seen it fail first.
