#!/usr/bin/env node
/**
 * The numbers the docs advertise must be the numbers that exist.
 *
 * Not hypothetical: the docs here said 132 tests after the suite reached 140,
 * and the companion repo said 82 after it reached 83 — the same mistake twice,
 * in two repos, within a week. A number written in prose has no way to notice
 * it has gone stale, and a reader who counts and gets a different answer has
 * every reason to distrust the rest of the document.
 *
 * The test count is derived by running the suites, not by parsing source. A
 * regex over `it(` and `describe(` would miss `it.each`, which is most of them.
 *
 * The mutation count is the one number here that cannot be derived — it records
 * work done at a keyboard, not a property of the tree. It is checked for
 * *consistency* across the four documents that state it, which catches the
 * realistic failure of updating one and forgetting the others.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Total tests reported by a package's vitest run, and how many of them did not
 * run.
 *
 * `numTotalTests` counts a skipped or todo test like any other, so with one
 * `it.skip` this check went on reporting "509 tests … as documented" — and a
 * skip is not a failure, so `pnpm test` stayed green as well. The total stays
 * the figure the docs are checked against; anything that did not run is
 * refused below rather than quietly counted.
 */
function countTests(pkg) {
  const raw = execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=json'], {
    cwd: join(ROOT, 'packages', pkg),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  // The JSON reporter prints the report last; anything before it is noise from
  // the pool booting workerd.
  const start = raw.indexOf('{"numTotalTestSuites"')
  const report = JSON.parse(start === -1 ? raw : raw.slice(start))
  return { total: report.numTotalTests, notRun: report.numPendingTests + report.numTodoTests }
}

const apiRun = countTests('api')
const uiRun = countTests('ui')
const api = apiRun.total
const ui = uiRun.total
const total = api + ui

console.log(`api: ${api} tests`)
console.log(`ui:  ${ui} tests`)

const problems = []

for (const [pkg, run] of [
  ['api', apiRun],
  ['ui', uiRun],
]) {
  if (run.notRun > 0) {
    problems.push(
      `packages/${pkg}: ${run.notRun} test(s) skipped or todo — a test that does not run ` +
        'is not one of the tests the docs count',
    )
  }
}

const claim = (file, pattern, label, expected) => {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const match = pattern.exec(text)
  if (!match) {
    problems.push(`${file}: could not find the ${label} claim this check guards`)
    return null
  }
  if (expected !== null && Number(match[1]) !== expected) {
    problems.push(`${file}: claims ${match[1]} ${label}, actual is ${expected}`)
  }
  return match[1]
}

claim('README.md', /# (\d+) tests —/, 'tests', total)
claim('README.md', /(\d+) in the Worker/, 'Worker tests', api)
claim('README.md', /(\d+) in the UI/, 'UI tests', ui)
claim('CONTRIBUTING.md', /(\d+) Worker tests/, 'Worker tests', api)
claim('CONTRIBUTING.md', /then (\d+) UI tests/, 'UI tests', ui)

// The mutation count is prose, so it is checked for agreement rather than
// against a source of truth.
const WORDS = {
  'Twenty-five': 25,
  'Twenty-six': 26,
  'Twenty-seven': 27,
  'Twenty-eight': 28,
  'Twenty-nine': 29,
  Thirty: 30,
  'Thirty-one': 31,
  'Thirty-two': 32,
  'Thirty-three': 33,
  Forty: 40,
  'Forty-one': 41,
  'Forty-five': 45,
  'Forty-eight': 48,
  'Fifty-three': 53,
  'Fifty-six': 56,
  Fifty: 50,
  'Fifty-four': 54,
  'Fifty-nine': 59,
  Sixty: 60,
  'Sixty-one': 61,
  'Sixty-two': 62,
  'Sixty-three': 63,
  'Sixty-four': 64,
  'Sixty-five': 65,
  'Sixty-six': 66,
  'Sixty-seven': 67,
  'Sixty-eight': 68,
  'Sixty-nine': 69,
  Seventy: 70,
  'Seventy-one': 71,
  'Seventy-two': 72,
  'Seventy-three': 73,
  'Seventy-four': 74,
  'Seventy-five': 75,
  'Seventy-six': 76,
  'Seventy-seven': 77,
  Eighty: 80,
  'Eighty-one': 81,
  'Eighty-two': 82,
  'Eighty-three': 83,
  'Eighty-four': 84,
  'Eighty-five': 85,
  'Eighty-six': 86,
  'Eighty-seven': 87,
  'Eighty-eight': 88,
  'Eighty-nine': 89,
  Ninety: 90,
  'Ninety-one': 91,
  'Ninety-two': 92,
  'Ninety-three': 93,
  'Ninety-four': 94,
  'Ninety-five': 95,
  'Ninety-six': 96,
  'Ninety-seven': 97,
  'Ninety-eight': 98,
  'Ninety-nine': 99,
  'One hundred': 100,
}
// Digits past a hundred, where the prose stops spelling numbers out.
const toNumber = (word) => (/^\d+$/.test(word) ? Number(word) : WORDS[word])

const mutationClaims = [
  ['README.md', /(\d+|[A-Z][a-z]+(?:-\w+)?) deliberate mutations/],
  ['docs/decisions.md', /(\d+|[A-Z][a-z]+(?:-\w+)?) mutations were introduced/],
  ['docs/how-it-was-built.md', /(\d+|[A-Z][a-z]+(?:-\w+)?) deliberate mutations/],
  ['CONTRIBUTING.md', /(\d+|[A-Z][a-z]+(?:-\w+)?) mutations have been run/],
]

const stated = new Map()
for (const [file, pattern] of mutationClaims) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const match = pattern.exec(text)
  if (!match) {
    problems.push(`${file}: could not find the mutation-count claim this check guards`)
    continue
  }
  const value = toNumber(match[1])
  if (value === undefined) {
    problems.push(`${file}: "${match[1]}" is not a number this check knows — add it to WORDS`)
    continue
  }
  stated.set(file, value)
}

const distinct = new Set(stated.values())
if (distinct.size > 1) {
  problems.push(
    `the mutation count disagrees across documents: ${[...stated]
      .map(([file, value]) => `${file}=${value}`)
      .join(', ')}`,
  )
}

// ── 2b. The mutation record against the figure it states ───────────────────
//
// The mutation count is the one number here that cannot be derived, and for a
// long time that meant it was checked only for agreement between the four
// documents that repeat it — four copies of an unverifiable figure agreeing
// with each other, which is not the same as being true.
//
// `docs/mutations.md` is the part that can be checked: one row per mutation
// recovered from the commit that ran it. So the row count is compared against
// the figure that file's own prose states. The total stays a claim about
// work done; this makes the recorded subset a claim about a file, and a file
// can be counted.
//
// Deliberately NOT compared against the total. They are different numbers on
// purpose — mutations.md exists to state the gap, and a check that demanded
// they match would force the gap closed by invention, which is the failure this
// whole script exists to prevent.
{
  const text = readFileSync(join(ROOT, 'docs/mutations.md'), 'utf8')

  // Padding-tolerant: prettier aligns the columns, so the delimiter is not
  // reliably followed by exactly one space.
  const rows = text.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line))
  const stated = text.match(/\*\*([A-Z][a-z]+(?:-\w+)?) mutations are\s+recorded here\*\*/)

  if (!stated) {
    problems.push(
      'docs/mutations.md: could not find the "N mutations are recorded here" figure this check guards',
    )
  } else if (rows.length === 0) {
    problems.push('docs/mutations.md: no numbered rows found — has the table format changed?')
  } else {
    const claimed = toNumber(stated[1])
    if (claimed === undefined) {
      problems.push(
        `docs/mutations.md: "${stated[1]}" is not a number this check knows — add it to WORDS`,
      )
    } else if (claimed !== rows.length) {
      problems.push(
        `docs/mutations.md: says ${claimed} mutations are recorded, the table holds ${rows.length}`,
      )
    }

    // Contiguous numbering, because a duplicated or skipped number is how a
    // hand-maintained list silently gains or loses an entry.
    const numbers = rows.map((row) => Number(/^\|\s*(\d+)\s*\|/.exec(row)[1]))
    const expected = numbers.map((_, i) => i + 1)
    if (numbers.join() !== expected.join()) {
      problems.push(
        `docs/mutations.md: the rows are numbered ${numbers.join(', ')} — they must run 1..${rows.length} with none repeated or missing`,
      )
    }
  }
}

// ── 3. The dropdown and the contract test's copy of it ─────────────────────
//
// `integration-contract.test.ts` holds `DASHBOARD_OFFERS`, a hand-copied
// duplicate of the dropdown lists in `run-form.ts`. The duplication is
// deliberate and explained there: importing the real lists would make that
// test agree with the dashboard by construction, which is the one thing a
// contract test must not do.
//
// The cost is that the copy can go stale. Add a service to the dropdown,
// forget the copy, and the test still passes — it is comparing its own
// snapshot against the workflow, not the list a user actually sees. The
// dropdown then offers a slice the workflow rejects, and the run errors the
// moment someone picks it.
//
// So a third party reads both files as text and compares them. That catches
// drift without either side importing the other.

const listOf = (text) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1])

function dropdownLists() {
  const src = readFileSync(join(ROOT, 'packages/ui/src/run-form.ts'), 'utf8')
  const grab = (name, suite) => {
    const block = src.match(new RegExp(`const ${name}[\\s\\S]*?\\n\\}`))?.[0]
    if (!block) return undefined
    const inner = block.match(new RegExp(`\\b${suite}:\\s*\\[([^\\]]*)\\]`))?.[1]
    return inner === undefined ? undefined : listOf(inner)
  }
  return {
    api: { services: grab('SUITE_SERVICES', 'api'), tags: grab('SUITE_TAGS', 'api') },
    ui: { services: grab('SUITE_SERVICES', 'ui'), tags: grab('SUITE_TAGS', 'ui') },
  }
}

function contractCopy() {
  const src = readFileSync(join(ROOT, 'packages/api/test/integration-contract.test.ts'), 'utf8')
  const block = src.match(/const DASHBOARD_OFFERS[\s\S]*?\n {2}\}/)?.[0]
  if (!block) return undefined
  const grab = (suite) => {
    const seg = block.match(new RegExp(`\\b${suite}:\\s*\\{([\\s\\S]*?)\\}`))?.[1]
    if (seg === undefined) return undefined
    const services = seg.match(/services:\s*\[([^\]]*)\]/)?.[1]
    const tags = seg.match(/tags:\s*\[([^\]]*)\]/)?.[1]
    if (services === undefined || tags === undefined) return undefined
    return { services: listOf(services), tags: listOf(tags) }
  }
  return { api: grab('api'), ui: grab('ui') }
}

{
  const offered = dropdownLists()
  const copied = contractCopy()

  // A check that cannot find what it reads must say so rather than pass. This
  // is the failure the hub's own tripwire hit: a rewrite moved the wording it
  // grepped for, and it correctly refused to report success it could not
  // verify.
  if (!copied) {
    problems.push(
      'integration-contract.test.ts: could not read DASHBOARD_OFFERS — this check cannot compare it to the dropdown',
    )
  }

  for (const suite of ['api', 'ui']) {
    for (const kind of ['services', 'tags']) {
      const mine = offered[suite]?.[kind]
      const theirs = copied?.[suite]?.[kind]
      if (!mine) {
        problems.push(
          `run-form.ts: could not read the ${suite} ${kind} list — this check cannot compare it to the contract test`,
        )
        continue
      }
      if (!theirs) continue
      if (mine.join() !== theirs.join()) {
        problems.push(
          `the ${suite} ${kind} dropdown offers [${mine.join(', ')}] but integration-contract.test.ts checks [${theirs.join(', ')}]`,
        )
      }
    }
  }
}

// ── 4. The decisions document's own contents ───────────────────────────────
//
// `docs/decisions.md` is the deliverable this repository is read for, and its
// Contents list is hand-maintained. It went stale the ordinary way: eight
// decisions were appended over several weeks and none was added to the list,
// so the file advertised seventeen while holding twenty-five — including the
// two CLAUDE.md sends a reader to by number.
//
// Nothing could notice. The headings are there, the anchors work, and a
// contents list has no way to know a section was added below it. So the list
// is compared against the headings it claims to index: same numbers, same
// titles, and an anchor GitHub will actually resolve.

{
  const text = readFileSync(join(ROOT, 'docs/decisions.md'), 'utf8')

  // GitHub's heading slug: lowercased, everything but letters, digits, spaces
  // and hyphens dropped, then spaces to hyphens. Applied to the whole heading
  // including its number, which is why the anchors start with a digit.
  const slug = (heading) =>
    heading
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/ /g, '-')

  const headings = [...text.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => ({
    number: Number(m[1]),
    title: m[2].trim(),
  }))
  const listed = [...text.matchAll(/^(\d+)\. \[(.+)\]\(#([^)]+)\)$/gm)].map((m) => ({
    number: Number(m[1]),
    title: m[2].trim(),
    anchor: m[3],
  }))

  // A check that cannot find what it reads must say so rather than pass.
  if (headings.length === 0 || listed.length === 0) {
    problems.push(
      'docs/decisions.md: could not read the headings or the Contents list — this check cannot compare them',
    )
  } else {
    const byNumber = new Map(listed.map((entry) => [entry.number, entry]))

    for (const heading of headings) {
      const entry = byNumber.get(heading.number)
      if (!entry) {
        problems.push(
          `docs/decisions.md: decision ${heading.number} ("${heading.title}") is not in the Contents`,
        )
        continue
      }
      if (entry.title !== heading.title) {
        problems.push(
          `docs/decisions.md: Contents calls decision ${heading.number} "${entry.title}", the heading says "${heading.title}"`,
        )
      }
      const expected = slug(`${heading.number}. ${heading.title}`)
      if (entry.anchor !== expected) {
        problems.push(
          `docs/decisions.md: the link to decision ${heading.number} points at #${entry.anchor}, which resolves to nothing — it should be #${expected}`,
        )
      }
    }

    const numbered = new Set(headings.map((heading) => heading.number))
    for (const entry of listed) {
      if (!numbered.has(entry.number)) {
        problems.push(
          `docs/decisions.md: the Contents lists decision ${entry.number} ("${entry.title}"), which has no heading`,
        )
      }
    }
  }
}

if (problems.length > 0) {
  console.error('\n✖ check:claims — the docs advertise something that is not true.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nUpdate the number, or the claim stops being true.\n')
  process.exit(1)
}

console.log(`\n✓ check:claims — ${total} tests and ${[...distinct][0]} mutations, as documented`)
