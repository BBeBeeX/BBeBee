#!/usr/bin/env node
/**
 * Build the Tauri webview preload shim.
 *
 * `apps/desktop/renderer/preload-shim.ts` is the single source of truth for
 * the `window.BBeBee` / `window.BBeBeeBridge` host surface. This script
 * bundles it to a self-contained IIFE — the artifact Tauri injects into
 * every webview window before page scripts run, via
 * `include_str!("../gen/shim.js")` in `src-tauri/src/{main,lyrics_manager,mini_player_manager}.rs`.
 *
 * The bundle is checked in (like `src-tauri/gen/schemas/*.json`) so
 * `cargo build` works on a fresh checkout without node. Run with `--check`
 * to fail when the checked-in bundle is stale — that is what
 * `tests/preload-parity.test.ts` asserts.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import console from 'node:console'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const ENTRY = resolve(here, '../renderer/preload-shim.ts')
const OUT = resolve(here, '../src-tauri/gen/shim.js')
// Pin the working dir: esbuild annotates the bundle with the entry path
// relative to cwd, so without this the artifact would differ depending on
// where the script is invoked from.
const ABS_WORKING_DIR = resolve(here, '../..')

const BANNER = `/**
 * BBeBee desktop preload shim — GENERATED, do not edit by hand.
 *
 * Source: apps/desktop/renderer/preload-shim.ts
 * Regenerate: pnpm --filter @BBeBee/desktop build:shim
 *
 * Injected into every Tauri webview window via initialization_script,
 * before any page script runs.
 */`

async function bundle() {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    absWorkingDir: ABS_WORKING_DIR,
    // IIFE: executes on load, no module system needed in the webview.
    // The module self-installs via `installPreloadShim(window)` at the
    // bottom of the source; the (unused here) exports are exposed under a
    // global name only to satisfy the IIFE format.
    format: 'iife',
    globalName: '__BBeBeePreloadShim',
    // Evergreen webviews (WebView2/Chromium, WebKitGTK, WKWebView) — the
    // source uses optional chaining and nullish coalescing throughout.
    target: 'es2020',
    minify: false,
    write: false,
    banner: { js: BANNER },
    logLevel: 'warning',
  })
  const text = result.outputFiles[0].text
  return text.endsWith('\n') ? text : text + '\n'
}

const check = process.argv.includes('--check')
const fresh = await bundle()

if (check) {
  let current = null
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    // Missing file counts as stale.
  }
  if (current !== fresh) {
    console.error(
      `[build:shim] ${OUT} is stale — run \`pnpm --filter @BBeBee/desktop build:shim\` to regenerate.`,
    )
    process.exit(1)
  }
  console.log('[build:shim] bundle is up to date.')
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, fresh)
  console.log(`[build:shim] wrote ${OUT} (${fresh.length} bytes)`)
}
