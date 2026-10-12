#!/usr/bin/env node
/**
 * check-no-hardcoded.mjs — Group 5 anti-rot gate.
 *
 * Fails if any .tsx (excluding *.test.*) under apps/ or packages/ui contains
 * a hardcoded UI string that is not in the allowlist.
 *
 * How it works:
 *  1. Runs inventory-ui-strings.mjs (the Group 1 heuristic).
 *  2. Filters out false positives:
 *     - i18n key references (e.g. `sources:search.track` inside t() calls)
 *     - pure URLs (example values, not UI copy)
 *  3. Normalizes to `file :: text` pairs (line numbers dropped).
 *  4. Compares against i18n-allowlist.txt at the repo root.
 *  5. Exits non-zero listing any candidate not allowlisted.
 *
 * To allowlist a new exception: add a line `file :: text` to
 * i18n-allowlist.txt with a `# reason` comment. Allowlist entries are
 * reviewed exceptions, not a dumping ground.
 *
 * Usage: node packages/feature/plugin-i18n/scripts/check-no-hardcoded.mjs [--root <repo>]
 */

import { execFileSync, } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import console from 'node:console'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const rootIdx = args.indexOf('--root')
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : join(here, '..', '..', '..', '..')
const ALLOWLIST = join(ROOT, 'i18n-allowlist.txt')

const KEY_REF = /^[a-z]+:[a-zA-Z0-9_.]+$/
const PURE_URL = /^https?:\/\/\S+$/

// 1+2. Run inventory, filter false positives.
let tsv
try {
  tsv = execFileSync('node', [join(here, 'inventory-ui-strings.mjs'), '--root', ROOT], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (e) {
  console.error('check-no-hardcoded: inventory script failed')
  console.error(e.message)
  process.exit(2)
}
const candidates = new Set()
for (const [i, line] of tsv.split('\n').entries()) {
  if (i === 0 || !line.trim()) continue // header / blank
  const parts = line.split('\t')
  if (parts.length < 6) continue
  const [file, , , , , original] = parts
  const text = (original ?? '').trim()
  if (!text) continue
  if (KEY_REF.test(text)) continue // t('ns:key') reference, not UI copy
  if (PURE_URL.test(text)) continue // example URL, not UI copy
  candidates.add(`${file} :: ${text}`)
}

// 3+4. Load allowlist (lines `file :: text`; `#` comments and blanks ignored).
let allowlist
try {
  allowlist = new Set(
    readFileSync(ALLOWLIST, 'utf8')
      .split('\n')
      .map((l) => l.split('#')[0].trim())
      .filter((l) => l && l.includes('::')),
  )
} catch {
  console.error(`check-no-hardcoded: cannot read allowlist at ${ALLOWLIST}`)
  process.exit(2)
}

const violations = [...candidates].filter((c) => !allowlist.has(c)).sort()
if (violations.length) {
  console.error(
    `check-no-hardcoded: ${violations.length} hardcoded UI string(s) not in i18n-allowlist.txt:`,
  )
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    '\nEither migrate them to catalogue keys, or add them to i18n-allowlist.txt with a `# reason` (reviewed exceptions only).',
  )
  process.exit(1)
}
console.log(
  `✓ no hardcoded UI strings (${candidates.size} candidates, all allowlisted or filtered)`,
)
