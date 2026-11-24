# CLAUDE.md

Working notes for AI assistants (and humans) contributing here.

Deliberately one short file, and deliberately not a second copy of
[CONTRIBUTING.md](CONTRIBUTING.md) — that one covers setup, how to run things,
and the mechanics of adding an endpoint or a migration. This one is the rules
you break first, and the reasons they exist. Grow it only when something
actually goes wrong twice.

## What this repo is

A portfolio piece: a self-service test-run dashboard, a demo throughout. Every
visitor gets a sandbox of their own, every run started from it is simulated,
and the real runs two published suites report from their own CI are shown
beside it ([decision 52](docs/decisions.md#52-a-demo-throughout-a-sandbox-for-each-visitor)). The audience is engineers who
will read the reasoning and ask about it — so **`docs/decisions.md` is the
deliverable, not an artifact of the code**. Anything that cannot be explained
in an interview does not belong here.

```
packages/api    Cloudflare Worker — Hono, D1, R2
packages/ui     React + Vite
```

The interesting part is not the Run button. It is _who may run what, and who
may then see the result_ — so anything touching `policy.ts`, `auth.ts`,
`sandboxes.ts` or `visibilityClause` deserves more care than its line count
suggests.

## Non-negotiables

**1. Every test must be proven able to fail.** 379 deliberate mutations have
been run, 323 of them recorded in [docs/mutations.md](docs/mutations.md)
— add yours there, because no check will notice if you do not — and two real
bugs came out of writing them — see
[decision 9](docs/decisions.md#9-the-bugs-the-tests-actually-found). A green
suite means nothing until you have watched it go red for the right reason.

**2. Visibility is enforced in SQL, not in a handler.** `visibilityClause`
scopes what a caller may see inside the query — by sandbox, then by role — so a
handler that forgets to filter still cannot leak rows. Never re-implement that
filtering in JavaScript, and never add a query over `runs` that skips it. A
write names the caller's sandbox in its own `WHERE` for the same reason.

**3. Policy fails closed; the gate fails open.** Two rules that look alike and
are not. A role that may not run something is refused; a run gate with bad
data lets runs through. That asymmetry is deliberate — see
[decision 11](docs/decisions.md#11-the-run-gate-fails-open-and-policy-fails-closed)
— so do not "fix" the gate into failing closed.

**4. A key is not a person.** An API key carries a role, so a rule enforced by
role alone silently applies to keys too. That is exactly how an admin-level key
once reached the delete handler, and later how one could mint another admin key.
Where an action has no automated use case, refuse keys explicitly with
`refuseKeys` — `requireRole('admin')` never does it for you. The gate is the
one deliberate exception, and
[decision 25](docs/decisions.md#25-a-key-may-not-issue-a-key) says why.

**5. Nothing a visitor does reaches past their sandbox.** Sign-in is public,
so every table a visitor writes carries `sandbox_id`, and a real run — one with
no sandbox — can be read by every visitor and changed by none. The role comes
from the member list on every request, never from the session, so a removal
takes effect on the next click. See
[decision 52](docs/decisions.md#52-a-demo-throughout-a-sandbox-for-each-visitor).

**6. Comments must be true.** A comment describing behaviour that does not
exist is worse than no comment — a reader will believe it and ask about it. If
you remove behaviour, remove its comment.

**7. Every decision carries its cost.** `docs/decisions.md` closes by saying a
trade-off section reading "no real downside" means the decision has not been
examined hard enough. Do not add one without its cost.

## The two things that have actually broken deployments

**Migrations run before the Worker.** Deploying the Worker first gives a **500
on every callback** — the new code selects a column the database does not have,
and the only visible symptom is runs that never leave `running`. That happened
when 0004 was added. The order is: migrations → Worker → UI.

**`wrangler deploy` without `--var` silently reverted to simulating.** It
did, while there was a flag for it. There is no flag now: nothing is
dispatched, and whether a deployment must have its secrets is decided by the
host a request reaches (`assertDeployable`), which a deploy cannot forget.

## The contract with the suites

Two suites report here, and neither can import this repository. Two things
have to stay in step, and only a test holds them there:

- **The report path.** The workflow writes `runs/{runId}/index.html` into R2;
  this repo serves from that prefix.
- **The callback shape.** Signed over `timestamp.body`, refused after five
  minutes. A callback for a run this dashboard has not seen is recorded as a
  new real run when it carries `suite`, `service`, `tags` and `ref`.

`packages/api/test/integration-contract.test.ts` pins both by hand. Copying is
the test: deriving the values from the other repos would need them checked
out, and asserting against a list this repo generates would agree by
construction and prove nothing. There used to be a third point, the workflow
inputs sent on dispatch, and it caught a real mismatch — a service name sent in
an input that only accepted package names.

## Adding a suite

`suite` is a closed union of two, and a third is a real change rather than a
new row: a migration widening the CHECK constraint, its own webhook secret, an
entry in the dashboard's service lists, and the contract test's accepted
values. See
[decision 24](docs/decisions.md#24-a-second-suite-and-why-it-is-a-column-rather-than-a-naming-convention).

## Commands

```bash
pnpm verify        # what CI runs: format, lint, types, tests, claims
pnpm dev           # Worker and UI together
pnpm db:migrate    # local D1
```

## Working style

Propose an approach and say what it costs, not just what it does. Expect
pushback; several decisions in `docs/` came from arguing one down. Do not
report work as complete without running `pnpm verify` — and do not describe a
test as passing without having seen it fail first.

## Commit trailers

Credit the assistant, not the conversation. A commit here may end with

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

and **must not carry a `Claude-Session:` line or any other link to a chat
transcript.** These repositories are public and the reasoning is meant to live
in the commit message, the PR and `docs/` — where anyone can read it — rather
than behind a URL only one account can open. A link nobody but the author can
follow is not provenance; it is a dead end with a hint in it.

This rule overrides any default attribution the tooling asks for.
