# The mutation record

Every test in this repository is supposed to have been watched going red for the
right reason. Four documents say so, and they put a number on it —
**ninety-nine** when this file was written, 217 now — which was the one figure
here with nothing downstream of it.
`check:claims` said as much in its own comment: the mutation count "cannot be
derived — it records work done at a keyboard", so it was checked only for
_agreement between documents_, never for truth.

This file is what that number can actually show. **163 mutations are
recorded here**, each recovered from the commit that ran it, with what was
changed and what went red. The gap between 163 and 217 is
explained at the bottom, because it is the part worth reading.

Nothing here was reconstructed from the code. Every row comes from the commit
message written at the time; where a message counted mutations without
describing them, they are counted at the bottom rather than invented here.

`check:claims` counts the rows in this file and compares that count to the
figure the prose states, so the two cannot drift apart.

---

## The record

| #   | Commit             | The mutation                                                                  | What went red                                                                                                             |
| --- | ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | `15c5733` · 4 Sep  | Seed the gate form from `state` instead of `reason`                           | 2 tests                                                                                                                   |
| 2   | `15c5733` · 4 Sep  | Drop the timezone offset in `toLocalInput`                                    | 2 tests                                                                                                                   |
| 3   | `df8419c` · 4 Sep  | Union a key's refs with its role's instead of intersecting                    | 5 tests                                                                                                                   |
| 4   | `df8419c` · 4 Sep  | Ignore a key's revocation                                                     | 2 tests                                                                                                                   |
| 5   | `df8419c` · 4 Sep  | Drop a key's worker cap                                                       | 2 tests                                                                                                                   |
| 6   | `df8419c` · 4 Sep  | Remove the delete guard on keys                                               | 1 test                                                                                                                    |
| 7   | `daa9c9b` · 6 Sep  | Enforce the visibility scope on page one only                                 | pinned by a test                                                                                                          |
| 8   | `daa9c9b` · 6 Sep  | The exact-multiple page boundary                                              | passed first, then the test was tightened until it failed                                                                 |
| 9   | `daa9c9b` · 6 Sep  | The visibility bypass while paging                                            | passed first, then the test was tightened until it failed                                                                 |
| 10  | `82db061` · 6 Sep  | Remove `domain()`'s padding, so a two-run spread reaches the floor            | caught                                                                                                                    |
| 11  | `82db061` · 6 Sep  | Remove the minimum bar width, so 60 runs draw hairlines                       | caught                                                                                                                    |
| 12  | `6abfb44` · 6 Sep  | Drop the time bound on the demo rate limit                                    | 1 test                                                                                                                    |
| 13  | `6abfb44` · 6 Sep  | Disable the demo rate limit entirely                                          | 1 test                                                                                                                    |
| 14  | `e4553c3` · 7 Sep  | Revert a bar's tooltip to the bare percentage                                 | 4 tests                                                                                                                   |
| 15  | `02512cc` · 10 Sep | Ignore the suite argument when sizing a simulated run                         | the `ui` case red, the `api` case green                                                                                   |
| 16  | `f146cda` · 10 Sep | Drop `suite` from the bar's `describe`                                        | 1 test red, the other 22 green                                                                                            |
| 17  | `834038d` · 15 Sep | Null `durationMs` in `webhook.ts`                                             | the contract test                                                                                                         |
| 18  | `ce0ebb8` · 18 Sep | Interpolate the cursor clause instead of binding it                           | 4 tests                                                                                                                   |
| 19  | `7f96589` · 18 Sep | Remove `refuseKeys` from both places it guards                                | 4 tests, including the one already guarding delete                                                                        |
| 20  | `61f6f71` · 18 Sep | Put a second object under a report's prefix                                   | the shape test                                                                                                            |
| 21  | `90239d1` · 19 Sep | Offer the `cross-service` tag while leaving the contract pin short            | `expected [...] to include 'cross-service'`                                                                               |
| 22  | `69ab86c` · 20 Sep | Make delete read `report_path` and walk its directory                         | `expected { deletedObjects: 1 } to match { deletedObjects: 0 }`                                                           |
| 23  | `969d4c1` · 21 Sep | Make a present token mean a real dispatch                                     | simulates when a token is set but the flag is unset                                                                       |
| 24  | `969d4c1` · 21 Sep | Read `SIMULATE_DISPATCH` as a loose boolean                                   | still simulates when the flag says anything but exactly `false`                                                           |
| 25  | `969d4c1` · 21 Sep | Drop the missing-token error                                                  | reports the missing token once the deployment is configured                                                               |
| 26  | `894ba46` · 21 Sep | No try/catch around the simulator (the original)                              | marks the run errored when the finishing write fails                                                                      |
| 27  | `894ba46` · 21 Sep | Catch the failure and swallow it                                              | `expected 'running' to be 'error'`                                                                                        |
| 28  | `894ba46` · 21 Sep | Drop the status guard on the error write                                      | `expected 'error' to be 'passed'`                                                                                         |
| 29  | `0c1a840` · 21 Sep | Spread the whole key row into the view                                        | `not to contain '6fab5d25…'`; `expected [ …(16) ] to deeply equal [ …(9) ]`                                               |
| 30  | `0c1a840` · 21 Sep | Add only `hash` to the view                                                   | `not to contain '159e8bcf…'`                                                                                              |
| 31  | `0c1a840` · 21 Sep | Drop `lastUsedAt` from the view                                               | `expected [ …(8) ] to deeply equal [ …(9) ]`                                                                              |
| 32  | `9466efe` · 21 Sep | Derive the failure count as `total - passed` again                            | 3 tests: `expected '…7/10 — 3 failed…' to contain '7/10 — 1 failed'`                                                      |
| 33  | `9466efe` · 21 Sep | Derive `failed` in `trendPoints` instead of carrying it                       | 1 test: `expected 3 to be 1`                                                                                              |
| 34  | `9466efe` · 21 Sep | Make the no-failures branch claim failures anyway                             | 1 test: `expected '…0 failed…' not to contain 'failed'`                                                                   |
| 35  | `15e2f6f` · 21 Sep | Drop an entry from the decisions index                                        | decision 25 is not in the Contents                                                                                        |
| 36  | `15e2f6f` · 21 Sep | Retitle an entry in the index                                                 | Contents calls decision 20 "Bars rather than a line", the heading says otherwise                                          |
| 37  | `15e2f6f` · 21 Sep | Collapse the double hyphen an em dash leaves in an anchor                     | the link resolves to nothing                                                                                              |
| 38  | `15e2f6f` · 21 Sep | Add an index entry with no matching decision                                  | decision 26 has no heading                                                                                                |
| 39  | `15e2f6f` · 21 Sep | Change the shape of every heading                                             | could not read the headings — the tripwire                                                                                |
| 40  | `b3a5fe2` · 21 Sep | Stop the report delete at R2's first page                                     | `expected { deletedObjects: 1000 } to match { deletedObjects: 1050 }`                                                     |
| 41  | `6bbb5a8` · 21 Sep | Restore `const [body, signature] = token.split('.')`                          | 5 tests: `expected 'run-1' to be null`; `expected 200 to be 401`                                                          |
| 42  | `6bbb5a8` · 21 Sep | Accept at least two token parts instead of exactly two                        | the same 5 — which is the point                                                                                           |
| 43  | `6bbb5a8` · 21 Sep | Require exactly three parts, so no real token passes                          | 4 the other way: `expected null to be 'run-a'`                                                                            |
| 44  | `3135ddd` · 21 Sep | Drop the one-axis rule on `POST /runs`                                        | 2 tests: `expected 201 to be 422`                                                                                         |
| 45  | `3135ddd` · 21 Sep | Make the dispatch always send the tag, never the service                      | 3 tests: `expected 'all' to be 'items'`                                                                                   |
| 46  | `88600f7` · 23 Sep | Drop the `Math.max` that floors clock skew at zero                            | `expected "0s ago", received "-2s ago"`                                                                                   |
| 47  | `88600f7` · 23 Sep | Point `SUITE_REPOS.ui` at the API repository                                  | the `ui` case of `suiteCommitUrl`                                                                                         |
| 48  | `d5a487a` · 23 Sep | Drop the slice in `trendPoints`                                               | `length 50, expected 30`                                                                                                  |
| 49  | `d5a487a` · 23 Sep | Slice after the reverse in `trendPoints`                                      | kept `run-20`..`run-49`, the oldest thirty                                                                                |
| 50  | `11e0649` · 24 Sep | `const name = body.name`, dropping the demo check                             | `startedBy "Mallory", expected null`                                                                                      |
| 51  | `d90d6f5` · 24 Sep | `effectiveTags` returns the picked tag, the old behaviour                     | 2 tests: the service-named request, and the scope shown                                                                   |
| 52  | `d90d6f5` · 24 Sep | `effectiveTags` always returns `'all'`                                        | 2 tests: the picked tag kept across every service                                                                         |
| 53  | `d90d6f5` · 24 Sep | `runRequest` returns the form unchanged                                       | 1 test: "sends tags=all when a single service is named"                                                                   |
| 54  | `d457dc6` · 24 Sep | `adminPanelMode` lets the preview decide: demo previewing admin gets `'full'` | 1 test: "gives a demo session previewing admin the read-only panel, never the full one"                                   |
| 55  | `d457dc6` · 24 Sep | No read-only panel at all, the old behaviour                                  | the same test                                                                                                             |
| 56  | `d457dc6` · 24 Sep | Demo gets the panel whatever role it previews                                 | 1 test: "shows demo nothing while it previews any other role"                                                             |
| 57  | `35d5cc2` · 24 Sep | The old t4/t5 values, restored in `index.html`                                | 6 tests: t4 and t5 in all three palette blocks                                                                            |
| 58  | `35d5cc2` · 24 Sep | One dark block's t5 drifts from the other                                     | 1 test: "declares the dark theme identically in both of its blocks"                                                       |
| 59  | `35d5cc2` · 24 Sep | t4 and t5 swapped in the light theme                                          | 1 test: "keeps the tones in order"                                                                                        |
| 60  | `6227d85` · 3 Oct  | `available` from the loaded runs, not the total                               | 1 test: "is every run the caller may see, not the number loaded"                                                          |
| 61  | `6227d85` · 3 Oct  | `available` without the floor at the loaded count                             | 1 test: "is never fewer than the runs on screen"                                                                          |
| 62  | `9ad75ba` · 3 Oct  | The limit refuses only wrong passwords, so a right one gets through over it   | 2 tests, incl. "refuses even the right password…": 200, not 429                                                           |
| 63  | `9ad75ba` · 3 Oct  | Every address counted in one bucket                                           | "counts each address separately", run alone: 429, not 200                                                                 |
| 64  | `9ad75ba` · 3 Oct  | A right password is charged and never refunded                                | 2 tests, incl. "does not charge a right password…": 429, not 200                                                          |
| 65  | `9ad75ba` · 3 Oct  | A right password resets the count to zero                                     | 1 test: "does not let demo's published password wipe the count…"                                                          |
| 66  | `9ad75ba` · 3 Oct  | Check the count, then record the failure                                      | 1 test: "holds against guesses sent all at once": 30, not 10                                                              |
| 67  | `9ad75ba` · 3 Oct  | The window never restarts                                                     | 1 test: "starts an address over once its window has passed"                                                               |
| 68  | `f85bdfb` · 4 Oct  | The run's row always recorded as real                                         | 2 tests: the demo run and the flag-simulated run read back real                                                           |
| 69  | `f85bdfb` · 4 Oct  | The run's row always recorded as simulated                                    | 1 test: "marks a real dispatch as not simulated"                                                                          |
| 70  | `f85bdfb` · 4 Oct  | The view ignores the stored column                                            | 2 tests: both simulated cases read back real                                                                              |
| 71  | `f85bdfb` · 4 Oct  | /demo/roles tells only demo it simulates                                      | 1 test: "says a real role dispatches for real only where…"                                                                |
| 72  | `f85bdfb` · 4 Oct  | `role === 'demo'` dropped from `simulates()`                                  | 2 tests: the demo row, and the form's answer for demo                                                                     |
| 73  | `7bbe555` · 5 Oct  | The cookie builder never adds `Secure`                                        | 5 tests: each cookie over HTTPS, `expected [ …(5) ] to include 'Secure'`                                                  |
| 74  | `7bbe555` · 5 Oct  | The cookie builder always adds `Secure`                                       | 5 tests: each cookie over HTTP, `expected [ …(6) ] to not include 'Secure'`                                               |
| 75  | `7bbe555` · 5 Oct  | Sign-in passes `false` instead of the scheme                                  | 1 test: the session, on sign-in, over HTTPS                                                                               |
| 76  | `7bbe555` · 5 Oct  | Preview passes `false` instead of the scheme                                  | 1 test: the preview role, on preview, over HTTPS                                                                          |
| 77  | `7bbe555` · 5 Oct  | The report cookie passes `false` instead of the scheme                        | 1 test: the report asset cookie, over HTTPS                                                                               |
| 78  | `7bbe555` · 5 Oct  | No CSP on report responses                                                    | 4 tests: `expected null not to be null`                                                                                   |
| 79  | `7bbe555` · 5 Oct  | `connect-src` admits `'self'`                                                 | `expected [ '\'self\'' ] to deeply equal []`                                                                              |
| 80  | `7bbe555` · 5 Oct  | `script-src` admits the analytics host                                        | `expected [ 'https://www.googletagmanager.com' ] to deeply equal []`                                                      |
| 81  | `7bbe555` · 5 Oct  | `default-src 'self'`                                                          | `expected [ '\'self\'' ] to deeply equal [ '\'none\'' ]`                                                                  |
| 82  | `7bbe555` · 5 Oct  | The CSP on the entry point only                                               | passed first, then the test was tightened until it failed: `expected null to be 'default-src \'none\'; script-src \'un…'` |
| 83  | `7bbe555` · 5 Oct  | No `Referrer-Policy` on reports                                               | `expected null to be 'no-referrer'`                                                                                       |
| 84  | `7bbe555` · 5 Oct  | The opener policy on reports as well                                          | `expected 'same-origin' to be null`                                                                                       |
| 85  | `7bbe555` · 5 Oct  | No opener policy anywhere                                                     | 4 tests: `expected null to be 'same-origin'`                                                                              |
| 86  | `7bbe555` · 5 Oct  | The UI's `_headers` without the opener policy                                 | `expected undefined to be 'same-origin'`                                                                                  |
| 87  | `7bbe555` · 5 Oct  | The UI's `_headers` lets the site frame itself                                | `expected 'frame-ancestors \'self\'' to be 'frame-ancestors \'none\''`                                                    |
| 88  | `8cd4219` · 5 Oct  | A list answer applied whatever was asked since                                | 2 tests: `expected 'unfiltered' to be null`                                                                               |
| 89  | `8cd4219` · 5 Oct  | `forget()` does nothing                                                       | `expected 'the admin\'s runs' to be null`                                                                                 |
| 90  | `8cd4219` · 5 Oct  | A superseded failure rethrown                                                 | `Error: stale 401`                                                                                                        |
| 91  | `8cd4219` · 5 Oct  | Sign-out without `lists.forget()`                                             | not the suite (no component tests run effects): the browser probe, dev sees 2 of 25 develop rows                          |
| 92  | `8cd4219` · 5 Oct  | `refresh` asks `api.listRuns` directly                                        | not the suite: the browser probe, "rows API 0 UI 13" with no filter                                                       |
| 93  | `8cd4219` · 5 Oct  | `loadMore` asks `api.listRuns` directly                                       | not the suite: the browser probe, 4 API rows under `?suite=ui`                                                            |
| 94  | `7622f7d` · 5 Oct  | A service checked by its shape again                                          | 3 tests: `expected 201 to be 422`                                                                                         |
| 95  | `7622f7d` · 5 Oct  | A tag checked by its shape again                                              | 3 tests, incl. "records nothing…": `expected 20 to be 19`                                                                 |
| 96  | `7622f7d` · 5 Oct  | Either suite's names accepted for both                                        | 3 tests: "rejects the other suite's service with 422"                                                                     |
| 97  | `7622f7d` · 5 Oct  | Every ref allowed, to show the count-based tests bite                         | 5 tests, incl. "records no run when the ref is refused": `expected 19 to be 18`                                           |
| 98  | `7622f7d` · 5 Oct  | The gate never applies                                                        | 2 tests: `expected 201 to be 503`                                                                                         |
| 99  | `b1b969c` · 5 Oct  | No `og:image`                                                                 | 3 tests: `expected false to be true`                                                                                      |
| 100 | `b1b969c` · 5 Oct  | `og:image` relative                                                           | `expected '/og.png' to match /^https:\/\//`                                                                               |
| 101 | `b1b969c` · 5 Oct  | `og:image` names a file not shipped                                           | 2 tests: `ENOENT`                                                                                                         |
| 102 | `b1b969c` · 5 Oct  | The stated image width wrong                                                  | `expected [ '1280', '630' ] to deeply equal [ '1200', '630' ]`                                                            |
| 103 | `b1b969c` · 5 Oct  | A summary card, not a large one                                               | `expected 'summary' to be 'summary_large_image'`                                                                          |
| 104 | `f501026` · 5 Oct  | No links on the sign-in page                                                  | `expected '<main …' to contain 'href=…'`                                                                                  |
| 105 | `f501026` · 5 Oct  | No note in demo's role panel                                                  | `… to contain 'the point of the project'`                                                                                 |
| 106 | `f501026` · 5 Oct  | The note shown to every role                                                  | `… not to contain 'the point of the project'`                                                                             |
| 107 | `f501026` · 5 Oct  | The decisions link at the repository root                                     | `… to match /\/docs\/decisions\.md$/`                                                                                     |
| 108 | `d1d797d` · 5 Oct  | Logout does not clear the preview cookie                                      | `expected undefined to be defined`                                                                                        |
| 109 | `d1d797d` · 5 Oct  | The preview clear replaces the session clear instead of appending             | "clears the session cookie": `expected 'preview-role=; …' to contain 'session=;'`                                         |
| 110 | `297b432` · 5 Oct  | A key may name branches its role may not run                                  | `expected 201 to be 422`                                                                                                  |
| 111 | `297b432` · 5 Oct  | A key may name more workers than its role                                     | `expected 201 to be 422`                                                                                                  |
| 112 | `297b432` · 5 Oct  | Exact match instead of the role's patterns                                    | 2 tests, incl. `{"role":"qa","allowedRefs":["release/2.1.0"]}: expected 422 to be 201`                                    |
| 113 | `297b432` · 5 Oct  | Drop the `*` clause from the check                                            | survived: `matchesRef` already reads `*` as any branch, so the clause was removed                                         |
| 114 | `297b432` · 5 Oct  | "any branch" for a key without a list                                         | `expected 'any branch · …' to be 'the role\'s branches · …'`                                                              |
| 115 | `92b66ac` · 5 Oct  | An empty Authorization header falls through to sessions                       | 3 tests: `expected 'Session is invalid or expired' to contain 'carries no key'`                                           |
| 116 | `92b66ac` · 5 Oct  | Only a wholly empty header caught                                             | the `"Bearer "` and `"Bearer"` cases                                                                                      |
| 117 | `92b66ac` · 5 Oct  | Every role sent to the admin panel for a key                                  | 2 tests: `… to contain 'Ask an admin'`                                                                                    |
| 118 | `92b66ac` · 5 Oct  | No `export RUN_KEY=` line                                                     | `… to contain 'export RUN_KEY='`                                                                                          |
| 119 | `481b9a0` · 5 Oct  | `recheckDelay` always null                                                    | 3 tests: `expected null to be 301000`                                                                                     |
| 120 | `481b9a0` · 5 Oct  | No cap on the recheck delay                                                   | `expected 31536001000 to be 2147483647`                                                                                   |
| 121 | `481b9a0` · 5 Oct  | The recheck timer never set                                                   | the timer probe stays disabled (probe only, not the suite)                                                                |
| 122 | `481b9a0` · 5 Oct  | The gate effect ignores a return                                              | the return probe stays disabled (probe only, not the suite)                                                               |
| 123 | `481b9a0` · 5 Oct  | App never signals a return                                                    | the return probe stays disabled (probe only, not the suite)                                                               |
| 124 | `1eaf78f` · 5 Oct  | `linkNotice` never blames the filters                                         | `expected 'The linked run (items on main) is fur…' to be …`                                                               |
| 125 | `1eaf78f` · 5 Oct  | `linkNotice` describes a missing run as found                                 | `expected 'The linked run is further down…' to be 'That run link names…'`                                                 |
| 126 | `1eaf78f` · 5 Oct  | No `hashchange` listener                                                      | "opened? 0" (probe only, not the suite)                                                                                   |
| 127 | `1eaf78f` · 5 Oct  | A missing linked run never looked up                                          | "any notice? []" (probe only, not the suite)                                                                              |
| 128 | `1eaf78f` · 5 Oct  | Load more offered for a run the role cannot see                               | the probe shows it (probe only, not the suite)                                                                            |
| 129 | `1eaf78f` · 5 Oct  | Looked up before the list answered                                            | "notice shown? 1" while loading (probe only, not the suite)                                                               |
| 130 | `d1c57a6` · 5 Oct  | The run cell does not wrap in the table                                       | "709 in 630" at 680 (probe only, not the suite)                                                                           |
| 131 | `d1c57a6` · 5 Oct  | Compact from 640 again                                                        | `expected 640 to be greater than or equal to 670`                                                                         |
| 132 | `d1c57a6` · 5 Oct  | Two columns from 1000 again                                                   | `expected 1000 to be greater than or equal to 1014`                                                                       |
| 133 | `d1c57a6` · 5 Oct  | No coarse-pointer font rule                                                   | `no coarse-pointer rule for input, select and textarea`                                                                   |
| 134 | `d1c57a6` · 5 Oct  | The row's flex basis on the key form's column fields                          | "180/180 … 180/180", 602px (probe only, not the suite)                                                                    |
| 135 | `92fd288` · 5 Oct  | Workers and Run never grouped                                                 | `… to match /role="group" aria-label="Workers and run"…/`                                                                 |
| 136 | `92fd288` · 5 Oct  | Run before the worker count                                                   | the same test                                                                                                             |
| 137 | `b844bcf` · 5 Oct  | The trend's change coloured by direction                                      | `expected true to be false`                                                                                               |
| 138 | `b844bcf` · 5 Oct  | Always "pts"                                                                  | `expected '↑ 1 pts' to be '↑ 1 pt'`                                                                                       |
| 139 | `b844bcf` · 5 Oct  | The passed count red on a failed run                                          | `expected true to be false`                                                                                               |
| 140 | `b844bcf` · 5 Oct  | The failures in the status red                                                | `… to match /color:var\(--c-danger\)…/`                                                                                   |
| 141 | `b844bcf` · 5 Oct  | The gate's Open in green text                                                 | `… not to match /color:\s*status\.pass\b/`                                                                                |
| 142 | `75ddacf` · 5 Oct  | The gate refusal explains the system again                                    | 2 tests: `expected 'Runs are paused for your role, by Nok…' to be …`                                                      |
| 143 | `75ddacf` · 5 Oct  | demo told it sees only its own runs                                           | `expected { role: 'demo', …(4) } to match object …`                                                                       |
| 144 | `75ddacf` · 5 Oct  | "your role's scope" for dev again                                             | `… to contain 'dev’s scope'`                                                                                              |
| 145 | `b3ec3ab` · 5 Oct  | Revoke acts on the first press                                                | "after first press: revoked? true" (probe only, not the suite)                                                            |
| 146 | `b3ec3ab` · 5 Oct  | The revoke question offers no confirm                                         | `… to contain '>Revoke key<'`                                                                                             |
| 147 | `b3ec3ab` · 5 Oct  | A revoked key offered the question                                            | `… not to contain '<button'`                                                                                              |
| 148 | `b3ec3ab` · 5 Oct  | A numeric "last used" date again                                              | `expected '10/5/2026' to match /Oct/`                                                                                     |
| 149 | `5f4e3a3` · 5 Oct  | Failures ignored by `pollDelay`                                               | 2 tests: `expected 2000 to be 4000`; probe, 10 asks in 20s                                                                |
| 150 | `5f4e3a3` · 5 Oct  | App never counts a failed ask                                                 | 10 asks in 20s of outage (probe only, not the suite)                                                                      |
| 151 | `5f4e3a3` · 5 Oct  | No cap on the backoff                                                         | `expected 15360000 to be 60000`                                                                                           |
| 152 | `2d34660` · 5 Oct  | No status command in the panel                                                | 3 tests, incl. `expected [ '>Copy<', '>Copy<' ] to have a length of 3`                                                    |
| 153 | `2d34660` · 5 Oct  | The status command without the key                                            | 3 tests, incl. `… to contain 'Authorization: Bearer rdk_a_b'`                                                             |
| 154 | `57eadf3` · 5 Oct  | The tap area no larger than the control                                       | `… to match /button::before, summary::before …/`; probe, 43 of 47                                                         |
| 155 | `57eadf3` · 5 Oct  | The tap area not positioned on the control                                    | `… to match /button, summary { position: relative;/`; probe, 43 of 47                                                     |
| 156 | `5f31720` · 5 Oct  | The empty-summary note never shown                                            | "1280px, no runs: note shown? 0" (probe only, not the suite)                                                              |
| 157 | `5f31720` · 5 Oct  | The note shown with runs too                                                  | "1280px, runs: note shown? 1" (probe only, not the suite)                                                                 |
| 158 | `5f31720` · 5 Oct  | The note shown stacked too                                                    | "700px, no runs: note shown? 1" (probe only, not the suite)                                                               |
| 159 | `5f31720` · 5 Oct  | The note says nothing                                                         | `… to contain 'pass rate and the run-…'`                                                                                  |
| 160 | `1225996` · 5 Oct  | Role buttons left enabled while switching                                     | "preview requests: [\"admin\",\"qa\"]", ending on admin (probe only, not the suite)                                       |
| 161 | `1225996` · 5 Oct  | The second guard inside `pick()` removed                                      | survived: with the buttons disabled it could never fire, so it was removed                                                |
| 162 | `0acd6a2` · 5 Oct  | The old blue tab icon                                                         | `expected '#4f6bed' to be '#1f2937'`                                                                                      |
| 163 | `0acd6a2` · 5 Oct  | A bare "Loading…" again                                                       | `… to contain 'role="status"'`                                                                                            |

---

## Four more the history counts but does not describe

Two commits stated a total without naming every mutation in it:

- `daa9c9b` — "Six tests, five mutations." Three are rows 7–9 above; two are not
  described.
- `82db061` — "Four mutations, all caught." Two are rows 10–11; two are not
  described.

So the commit history accounts for **167**: 163 described, four
counted.

## The gap, and why it is stated rather than closed

217 mutations have been run. 167 are in the history. The other fifty
were run at a keyboard during development — break it, watch the right test go
red, put it back — and never written down, because for most of that period the
convention was to record the ones worth repeating rather than all of them.

That is not recoverable now. Re-deriving them from the code would be inventing a
record, not restoring one, and a fabricated provenance is worse than a stated
gap: it would read as evidence while being a guess.

217 is also a floor rather than an exact count. The prose figure stood at
ninety-nine from 7 to 24 September while rows 15 to 45 were being run — the
mutations went into their commit messages, and the total was not moved with
them — so the real number is higher by an amount the history cannot settle.

What changed is the convention, not the past. Since the counting became
explicit, every mutation has gone into its commit message with the message it
produced — rows 23 to 163 are all from that period, and every future one belongs
in this table. The number in the prose is the number of mutations run; the
number in this table is the number anyone else can check.

## What the check guards, and what it does not

`check:claims` compares the documents' figure for agreement, and counts the rows
here against the figure this file states. This file used to end by saying that
meant the record "cannot quietly fall behind the claim". It did.

Rows 46 to 53 were run on 23 and 24 September, each written into its commit
message, and none reached this table until they were added together afterwards.
Nothing failed in between, because nothing could: a mutation left out of the
table _and_ out of the figure leaves the two agreeing. The check catches a table
and a figure that disagree. It cannot catch work that neither mentions, and the
only thing that puts a new mutation here is whoever ran it remembering to.
