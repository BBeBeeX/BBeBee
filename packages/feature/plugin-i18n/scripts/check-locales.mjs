#!/usr/bin/env node
/**
 * Locale parity gate for the catalogues plugin-i18n ships.
 *
 * Every catalogue file pairs locales (`en.json`/`zh.json` for the `app`
 * namespace; the per-namespace files carry their locales side by side).
 * The pairs are expanded to dotted key paths and compared as sets: a key
 * present in en but missing in zh is an error, and so is the reverse —
 * both directions mean a screen that will silently fall back at runtime,
 * which is exactly what this gate exists to catch.
 *
 * Third-party catalogues registered through `ctx.i18n.register()` are NOT
 * checked here: the runtime falls back per key, so an incomplete
 * contribution degrades gracefully by design. This gate covers what the
 * plugin itself ships.
 *
 * Wired into CI (`.github/workflows/ci.yml`, Lint job) and runnable as
 * `pnpm check:locales`.
 */
import console from 'node:console'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, '..', 'src', 'locales')

/** Collapses `{ common: { confirm: 'OK' } }` to `['common.confirm', …]`. */
function flatten(value, prefix = '', out = []) {
  if (typeof value !== 'object' || value === null) return out
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') out.push(path)
    else flatten(child, path, out)
  }
  return out
}

/** One failure line, ordered so re-runs are diffable. */
function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

/**
 * The shipped catalogues as `[namespace, { localeTag: nestedJson }]` rows.
 * `en.json`/`zh.json` are per-locale files that together form the `app`
 * namespace; the per-namespace files carry their locales side by side.
 * Either way the comparison is over the same shape: locales side by side.
 */
const catalogues = [
  {
    namespace: 'app',
    locales: {
      en: JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')),
      zh: JSON.parse(readFileSync(join(localesDir, 'zh.json'), 'utf8')),
    },
  },
  {
    namespace: 'registry',
    locales: JSON.parse(readFileSync(join(localesDir, 'registry.json'), 'utf8')),
  },
  {
    namespace: 'settings',
    locales: JSON.parse(readFileSync(join(localesDir, 'settings.json'), 'utf8')),
  },
]

/** Locale tags the plugin ships, in a stable order. */
const shippedLocales = ['en', 'zh']

for (const catalogue of catalogues) {
  for (const locale of shippedLocales) {
    if (!(locale in catalogue.locales)) {
      fail(`${catalogue.namespace}: locale "${locale}" is missing entirely`)
    }
  }
  const tags = Object.keys(catalogue.locales)
  if (tags.length < 2) continue

  const [referenceTag, ...rest] = tags
  const reference = new Set(flatten(catalogue.locales[referenceTag]))
  for (const otherTag of rest) {
    const other = new Set(flatten(catalogue.locales[otherTag]))
    for (const key of reference) {
      if (!other.has(key)) {
        fail(`${catalogue.namespace}: "${otherTag}" is missing key "${key}" (${referenceTag} has it)`)
      }
    }
    for (const key of other) {
      if (!reference.has(key)) {
        fail(`${catalogue.namespace}: "${otherTag}" has extra key "${key}" (${referenceTag} does not)`)
      }
    }
  }
}

if (process.exitCode) {
  console.error('\nLocale parity check failed — fix the catalogues above.')
} else {
  console.log('✓ locale parity: en/zh catalogues match across all namespaces')
}
