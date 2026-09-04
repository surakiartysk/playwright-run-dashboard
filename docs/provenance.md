# Provenance

Where this repository came from, what did and did not travel, and how AI was
used. Written plainly because the alternative — depth with no explanation —
invites the wrong question.

## The short version

**This repository is a stand-in for production work I cannot show.**

The original is an internal dashboard for self-service test running at a
company, where I am the sole author: I started the project, designed it, and
made every architectural call in it. The team uses what I built. That system is
not mine to publish, and it should not be.

So it was rebuilt here — with AI as the drafting tool, working from the
architecture and the decisions rather than from the code — against an invented
subject. Same reasoning, same shape, same operational habits; different domain
and a different brand.

**The approach travelled. The code, the business context, and the brand did
not.**

## What travelled

Ideas, and the reasoning behind them:

- The core flow: a developer picks a slice, presses Run, and gets a link to the
  report without waiting for QA.
- The role model, and specifically that visibility is part of it rather than an
  afterthought — see [decision 2](decisions.md#2-one-policy-table-consulted-three-times).
- Signing the result callback, and binding the signature to a timestamp.
- Serving reports from private storage behind expiring, run-scoped links.
- The layout and component shapes of the UI: the split-panel sign-in, runs as
  cards rather than table rows, pass/fail as a proportional bar.

## What did not travel

- **No code.** Nothing here was copied from the original.
- **No brand.** The original's accent is a company brand red. This uses indigo,
  for [a second reason beyond avoidance](decisions.md#10-copied-layout-changed-palette).
- **No employer names, endpoints, repositories, or internal vocabulary.**
  Enforced mechanically: `pnpm check:leak` fails the build on the source
  project's domain words, its brand red in any notation, and invented account
  handles. A rule nobody can verify is a rule that decays, so this one runs in
  CI rather than living in a README.
- **No real infrastructure.** Every secret has an obviously fake development
  default, and `assertDeployable` refuses to let one reach a real deployment.

## How AI was used

As a drafting tool, under review. The architecture, the decisions, and the
trade-offs in [decisions.md](decisions.md) are mine; the typing was largely not.

That division is worth stating because it is the honest one, and because the
review half is where the value was:

- The AI wrote a `GITHUB_REPO` default naming a GitHub account that does not
  exist. Caught and replaced with a placeholder. Inventing a plausible-looking
  identifier is exactly the failure mode to watch for.
- It set a pool option, `isolatedStorage`, that the installed version silently
  ignores — the tests would have _looked_ isolated and shared a database. Caught
  by reading the library's type surface rather than trusting the option name.
- Both bugs in [decision 9](decisions.md#9-the-bugs-the-tests-actually-found)
  were found by insisting that every test be watched failing before being
  believed.

The discipline that made this work: **nothing is described as passing until it
has been seen to fail for the right reason.** Eighty-five deliberate mutations, each
confirmed to produce a failure naming the right behaviour.

## The companion repository

This dashboard triggers a suite. That suite is also published, built the same
way and for the same reason:

**`playwright-api-automation-patterns`** —
the same API suite built twice, functional-style and class-first, against one
OpenAPI contract, so the two approaches can be read side by side.

The two repos are deliberately separate. This one is about _operating_ a suite —
who may run it, how results get back, who may read them. That one is about
_writing_ one. They meet at exactly three points: this dashboard dispatches that
repo's `on-demand.yml`, that workflow uploads its Allure report into this
deployment's R2 bucket, and then posts back to this repo's `/webhook`.

## If you are evaluating this

The code is worth less than the reasoning. Start with
[decisions.md](decisions.md), and press hardest on the **trade-off** sections —
they are where a decision either holds up or does not.
