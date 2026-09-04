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
 * *consistency* across the three documents that state it, which catches the
 * realistic failure of updating one and forgetting the others.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Total tests reported by a package's vitest run. */
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
  return report.numTotalTests
}

const api = countTests('api')
const ui = countTests('ui')
const total = api + ui

console.log(`api: ${api} tests`)
console.log(`ui:  ${ui} tests`)

const problems = []

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
  'Forty-eight': 48,
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
}
const toNumber = (word) => WORDS[word]

const mutationClaims = [
  ['README.md', /([A-Z][a-z]+(?:-\w+)?) deliberate mutations/],
  ['docs/decisions.md', /([A-Z][a-z]+(?:-\w+)?) mutations were introduced/],
  ['docs/provenance.md', /([A-Z][a-z]+(?:-\w+)?) deliberate mutations/],
  ['CONTRIBUTING.md', /([A-Z][a-z]+(?:-\w+)?) mutations have been run/],
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

if (problems.length > 0) {
  console.error('\n✖ check:claims — the docs advertise something that is not true.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nUpdate the number, or the claim stops being true.\n')
  process.exit(1)
}

console.log(`\n✓ check:claims — ${total} tests and ${[...distinct][0]} mutations, as documented`)
