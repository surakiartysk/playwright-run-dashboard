# How it was built

How AI was used, and how this repository relates to the two suites it runs.

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
has been seen to fail for the right reason.** In all, 236 deliberate mutations
were each confirmed to produce a failure naming the right behaviour. 182
are listed with their evidence in [mutations.md](mutations.md), which also
states which are not, and why that gap is left open rather than filled in.

## The companion repositories

This dashboard triggers two suites. Both are published and built the same way:

**[`playwright-api-automation-patterns`](https://github.com/surakiartysk/playwright-api-automation-patterns)** —
the same API suite built twice, functional-style and class-first, against one
OpenAPI contract, so the two approaches can be read side by side.

**[`playwright-ui-automation-patterns`](https://github.com/surakiartysk/playwright-ui-automation-patterns)** —
the same twenty UI journeys built twice, locator-first and page-first, against
a public demo storefront.

The repos are deliberately separate. This one is about _operating_ a suite —
who may run it, how results get back, who may read them. Those are about
_writing_ one. They meet at exactly three points, each suite the same three:
this dashboard dispatches that repo's `on-demand.yml`, that workflow uploads
its Allure report into this deployment's R2 bucket, and then posts back to this
repo's `/webhook`.

## If you are evaluating this

The code is worth less than the reasoning. Start with
[decisions.md](decisions.md), and press hardest on the **trade-off** sections —
they are where a decision either holds up or does not.
