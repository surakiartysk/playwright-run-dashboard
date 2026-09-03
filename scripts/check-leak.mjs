#!/usr/bin/env node
/**
 * Vocabulary tripwire.
 *
 * This repository restates an approach developed elsewhere; the approach
 * travelled, the source material did not. This check enforces that mechanically
 * on every push, because a rule nobody can verify is a rule that decays.
 *
 * Design note — every term below is specific enough to be meaningless outside
 * its source. A check that cries wolf on line one gets ignored by line two,
 * which is worse than no check. If a term here ever fires on innocent code,
 * narrow the term rather than renaming the code around it.
 *
 * This repo carries one risk its companion does not: it copies a UI. Layout
 * and spacing are craft and may travel; a brand colour is identity and may not.
 * So the palette is checked, not just the words.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist', 'build', '.pnpm'])

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.html',
  '.css',
  '.sql',
  '.env',
  '.example',
])

/**
 * Terms that must never appear. Each entry explains itself so a future reader
 * can judge whether a hit is a real leak or a term that needs narrowing.
 */
const DENYLIST = [

  // ── Brand ─────────────────────────────────────────────────────────────────
  // The original's accent, in every form a copy-paste would produce. Layout
  // travelled deliberately; the brand colour must not. See decision 10.
  { pattern: /#c0ffee\b/i, why: "a disallowed brand colour" },
  { pattern: /\brgb\(\s*229\s*,\s*28\s*,\s*35\s*\)/i, why: "a disallowed brand colour" },
  { pattern: /\b229\s*,\s*28\s*,\s*35\b/, why: "a disallowed brand colour, as components" },

  // ── Fabricated identifiers ────────────────────────────────────────────────
  // An AI drafting this once invented a GitHub account that does not exist and
  // wrote it into wrangler.toml as if it were real. A placeholder is honest; a
  // plausible-looking handle is a claim. See docs/provenance.md.
  {
    pattern: /\bsurakiart-[a-z]+\//i,
    why: 'invented account handle — use a placeholder such as your-org/',
  },

  // ── Credentials and hosts ─────────────────────────────────────────────────
  {
    pattern:
      /\b[A-Za-z0-9._%+-]+@(?!api\.test|example\.(com|org))[A-Za-z0-9.-]+\.(com|co\.th|io|net)\b/,
    why: 'real-looking email address',
  },
  {
    pattern:
      /\bhttps?:\/\/(?!127\.0\.0\.1|localhost|json\.schemastore\.org|fonts\.(googleapis|gstatic)\.com|api\.github\.com|github\.com|opensource\.org)[a-z0-9.-]*(uat|sit|prod|internal|corp)[a-z0-9.-]*\b/i,
    why: 'non-public environment host',
  },
  { pattern: /\bBearer\s+eyJ[A-Za-z0-9_-]{10,}/, why: 'hardcoded JWT' },

  // A real secret reaching the repo. The development defaults are deliberately
  // fake and say so in their own value, so they do not match this.
  {
    pattern:
      /\b(WEBHOOK_SECRET|TOKEN_SECRET|GITHUB_TOKEN)\s*=\s*["'](?!.*(?:dev-|your-|placeholder))[^"']{12,}/,
    why: 'what looks like a real secret, not a development default',
  },
]

/** Paths exempt from scanning — this file necessarily contains every term. */
const EXEMPT = new Set(['scripts/check-leak.mjs'])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else {
      yield full
    }
  }
}

const findings = []

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file)
  if (EXEMPT.has(rel)) continue

  const ext = extname(file)
  const isDotfile = /^\.[a-z]/i.test(rel.split('/').pop() ?? '')
  if (!SCAN_EXTENSIONS.has(ext) && !isDotfile) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = content.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const { pattern, why } of DENYLIST) {
      const match = pattern.exec(line)
      if (match) {
        findings.push({ file: rel, line: index + 1, term: match[0].trim(), why })
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`\n✖ check:leak — ${findings.length} finding(s)\n`)
  for (const { file, line, term, why } of findings) {
    console.error(`  ${file}:${line}`)
    console.error(`    matched: ${JSON.stringify(term)}  (${why})\n`)
  }
  console.error('This repo must not carry vocabulary or branding from its source material.')
  console.error('If a pattern is over-broad, narrow it in scripts/check-leak.mjs.\n')
  process.exit(1)
}

console.log('✓ check:leak — clean')
