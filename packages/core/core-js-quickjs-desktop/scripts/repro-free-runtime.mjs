#!/usr/bin/env node
/**
 * JS_FreeRuntime (`gc_obj_list`) repro driver.
 *
 * Runs each stress class from `src/stress.test.ts` in its OWN vitest
 * process — an abort poisons the WASM instance, so classes must never
 * share one — with handle tracing on, and summarises per class:
 * passed, aborted (the assertion text was printed), or leaked (the
 * tracer's report fired; a leak that did not quite reach the assertion).
 *
 * Usage:
 *   node packages/core/core-js-quickjs-desktop/scripts/repro-free-runtime.mjs
 *   BBEBEE_QUICKJS_STRESS_N=50 node .../repro-free-runtime.mjs
 *
 * Iterations per class default to 200 (BBEBEE_QUICKJS_STRESS_N).
 * Exits non-zero unless every class is clean.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import console from 'node:console'
import process from 'node:process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const testFile = 'packages/core/core-js-quickjs-desktop/src/stress.test.ts'
const iterations = process.env.BBEBEE_QUICKJS_STRESS_N ?? '200'

const CLASSES = [
  ['class-a', 'sync eval + dispose'],
  ['class-b', 'async settle (immediate + host bridge) + dispose'],
  ['class-c', 'dispose while parked on a host promise (race)'],
  ['class-d', 'throwing scripts (sync + async) + dispose'],
  ['class-e', 'production shapes (source rules, lyric sandbox)'],
]

const ABORT_RE = /Aborted\(Assertion failed[^\n]*|gc_obj_list/
const LEAK_RE = /unreleased handle\(s\) still registered/

let allClean = true
const rows = []

for (const [id, label] of CLASSES) {
  const result = spawnSync(
    'pnpm',
    ['vitest', 'run', testFile, '-t', id, '--testTimeout=600000'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 900_000,
      env: {
        ...process.env,
        BBEBEE_QUICKJS_STRESS: '1',
        BBEBEE_QUICKJS_TRACE_HANDLES: '1',
        BBEBEE_QUICKJS_STRESS_N: iterations,
      },
    },
  )
  const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const aborted = ABORT_RE.test(out)
  const leaked = LEAK_RE.test(out)
  const passed = result.status === 0 && !aborted && !leaked
  if (!passed) allClean = false

  // Pull the tracer's per-kind counts out of the child's output, if any.
  const kinds = [...out.matchAll(/^\s{2}(\S+) ×(\d+)$/gm)]
    .map((m) => `${m[1]} ×${m[2]}`)
    .join(', ')
  const verdict = aborted
    ? 'ABORT (gc_obj_list assertion printed)'
    : leaked
      ? `LEAK reported (${kinds || 'kinds unparsed'})`
      : result.status === 0
        ? 'clean'
        : `FAILED (exit ${result.status})`
  rows.push(`  ${id}  ${label}\n      → ${verdict}`)
  if (!passed) {
    // Show the evidence, not just the verdict: the assertion line and the
    // first leak report block, verbatim from the child.
    const abortLine = out.split('\n').find((l) => ABORT_RE.test(l))
    if (abortLine) rows.push(`      ${abortLine.trim()}`)
    const leakStart = out.indexOf('realm disposed with')
    if (leakStart >= 0) {
      const block = out
        .slice(leakStart, leakStart + 1200)
        .split('\n')
        .slice(0, 14)
        .map((l) => `      ${l}`)
        .join('\n')
      rows.push(block)
    }
  }
}

console.log(`JS_FreeRuntime repro — ${iterations} iterations/class, tracing on\n`)
console.log(rows.join('\n'))
console.log(`\n${allClean ? 'ALL CLASSES CLEAN' : 'SOME CLASSES NOT CLEAN — see above'}`)
process.exit(allClean ? 0 : 1)
