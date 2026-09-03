#!/usr/bin/env node
/**
 * Uploads one real Allure report into R2, as the report every simulated run
 * serves.
 *
 * Why one shared report rather than one per run: it is the same bytes every
 * time. Simulated runs record this prefix in `report_path`; real runs record
 * their own, uploaded by the companion repo's workflow.
 *
 * The report must be built with `--single-file` (which is the default in that
 * repo's `pnpm allure`). The multi-file form is ~450 objects — hundreds of
 * round trips to upload, and hundreds of individually-authorised assets to
 * serve, for a page that inlines to one file.
 *
 * Run it when the report needs refreshing:
 *
 *   pnpm allure                                   # in the companion repo
 *   node scripts/upload-demo-report.mjs <path-to-allure-report/index.html>
 */

import { statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BUCKET = 'run-dashboard-reports'
const KEY = 'demo-report/index.html'

const source = process.argv[2]

if (!source) {
  console.error('usage: node scripts/upload-demo-report.mjs <path-to-index.html>')
  process.exit(1)
}

if (!source.endsWith('.html')) {
  console.error(`Expected a single .html file, got: ${source}`)
  console.error('Build the report with --single-file (the default in `pnpm allure`).')
  process.exit(1)
}

const megabytes = (statSync(source).size / 1024 / 1024).toFixed(1)
console.log(`Uploading ${source} (${megabytes} MB) to ${BUCKET}/${KEY} …`)

execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'r2',
    'object',
    'put',
    `${BUCKET}/${KEY}`,
    '--file',
    source,
    // Set explicitly: the serving route hands back whatever content-type was
    // stored, so guessing wrong here is a report that renders as plain text.
    '--content-type',
    'text/html; charset=utf-8',
    '--remote',
  ],
  { cwd: new URL('../packages/api', import.meta.url).pathname, stdio: 'inherit' },
)

console.log('✓ uploaded')
