#!/usr/bin/env node
/**
 * Assemble a publishable BBeBee plugin npm package from a monorepo pair:
 * one headless feature package + its desktop UI package (optionally a
 * mobile UI package too).
 *
 *   node scripts/assemble-plugin.mjs \
 *     --feature packages/feature/plugin-visualizer \
 *     --ui packages/ui/plugin-visualizer-ui-desktop \
 *     [--ui-mobile packages/ui/plugin-visualizer-ui-mobile] \
 *     [--out <dir>] [--name <npm-name>] [--version <x.y.z>] [--no-build]
 *
 * Output layout (the npm plugin format, docs/plugins/loading.md §6.8–6.9):
 *
 *   <out>/
 *   ├── package.json          name/version from the feature package (or the
 *   │                         --name/--version overrides); `files` covers the
 *   │                         manifest + dist/; `peerDependencies` for the
 *   │                         host-shared modules are GENERATED from
 *   │                         apps/desktop/renderer/host-modules.manifest.ts
 *   │                         (the single source of truth) — never write a
 *   │                         react version literal in here or by hand.
 *   ├── BBeBee.plugin.json    the feature package's manifest, with `entry`
 *   │                         rewritten to the assembled layout below.
 *   └── dist/
 *       ├── index.js          the feature package's own build output (its
 *       │                     whole dist/ is copied: tsc emits several
 *       │                     files with relative imports; its existing
 *       │                     bare imports — cordis, protocol, toolkit —
 *       │                     are its established form and stay as-is)
 *       ├── ui-desktop.js     the UI package's build output re-bundled
 *       │                     with esbuild, host-shared modules external
 *       └── ui-mobile.js      same treatment, when --ui-mobile is given
 *
 * The UI bundle MUST reference the host's React through bare specifiers
 * (`import … from "react"`), resolved at runtime by the shell's import
 * map — a second React copy inside the bundle breaks hooks/context when
 * the UI renders inside the host tree. The script therefore fails loudly
 * when the emitted bundle contains React implementation code, or when it
 * contains no bare host-module import at all (which would mean react was
 * bundled or tree-shaken into invisibility — the silent-breakage shape).
 *
 * The output directory defaults to `.cache/plugin-packages/<name>-<version>`
 * (gitignored) and is wiped before each run. Publishing (`npm publish`)
 * is a deliberate manual step afterwards; this script only assembles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'
import { build } from 'esbuild'
import { HOST_MODULES, HOST_REACT_VERSION } from '../apps/desktop/renderer/host-modules.manifest.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const TAG = '[assemble-plugin]'
/** Install-side tarball cap (plugin-manager, D8-7); the assembled tree must fit under it. */
const SIZE_LIMIT_BYTES = 50 * 1024 * 1024

// ---------------------------------------------------------------------------
// Host contract, derived from the manifest (single source of truth)
// ---------------------------------------------------------------------------

/** Bare specifiers the shell shares with plugins; the UI bundle keeps these external. */
const HOST_SPECIFIERS = HOST_MODULES.map((m) => m.specifier)

/** npm package name behind a host entry (`react-dom/client` → `react-dom`). */
function packageNameOf(entry) {
  const parts = entry.split('/')
  return entry.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * `peerDependencies` for the assembled package.json: one entry per npm
 * package behind the host-shared specifiers, ranged at `^<major>.0.0` of
 * the host React version. v1 shares only the react family, whose packages
 * are versioned in lockstep with HOST_REACT_VERSION; if a future shared
 * module carries its own version, this derivation is where it must land —
 * not a literal in this script.
 */
function hostPeerDependencies() {
  const major = HOST_REACT_VERSION.split('.')[0]
  const peers = {}
  for (const m of HOST_MODULES) {
    peers[packageNameOf(m.entry)] = `^${major}.0.0`
  }
  return peers
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(message) {
  throw new Error(`${TAG} ${message}`)
}

function readJson(path, what) {
  if (!existsSync(path)) fail(`${what} not found: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    fail(`${what} is not valid JSON (${path}): ${err.message}`)
  }
}

function runPackageBuild(pkgJson, dir) {
  if (!pkgJson.scripts?.build) fail(`package ${pkgJson.name} has no "build" script (${dir})`)
  console.log(`${TAG} building ${pkgJson.name} …`)
  const res = spawnSync('pnpm', ['--filter', pkgJson.name, 'build'], { cwd: rootDir, stdio: 'inherit' })
  if (res.status !== 0) fail(`build failed for ${pkgJson.name} (exit ${res.status})`)
}

/** Recursively list files under dir as POSIX-style relative paths. */
function listFiles(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(p, base))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

// ---------------------------------------------------------------------------
// UI bundling + validation gate
// ---------------------------------------------------------------------------

/**
 * Substrings that only appear when a React implementation was bundled —
 * property/string markers that survive bundling and minification. Any hit
 * means the bundle carries its own React copy and would break in the host
 * tree; this is the failure the whole host-sharing design exists to avoid.
 */
const REACT_IMPL_MARKERS = [
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  'ReactCurrentOwner',
  'ReactCurrentDispatcher',
  'react.production',
  'react-dom.production',
  'scheduler.production',
]

function assertUiBundle(code, label) {
  for (const marker of REACT_IMPL_MARKERS) {
    if (code.includes(marker)) {
      fail(
        `${label} contains React implementation code (marker "${marker}"). ` +
          'The host-shared modules must stay external so the plugin renders against the shell\'s single React instance.',
      )
    }
  }
  // At least one bare host import must survive: without it there is
  // nothing for the import map to resolve, which in practice means react
  // was bundled (caught above) or silently dropped.
  const bareHostImport = HOST_SPECIFIERS.some((s) =>
    new RegExp(`(?:from\\s*|import\\s*)["']${s.replace('/', '\\/')}["']`).test(code),
  )
  if (!bareHostImport) {
    fail(
      `${label} contains no bare host-module import (${HOST_SPECIFIERS.join(', ')}). ` +
        'A UI bundle that never references the shared modules cannot be checked against the host contract — refusing to assemble.',
    )
  }
}

async function bundleUi(uiDir, uiPkg, outFile, label) {
  const entryPoint = join(uiDir, 'dist', 'index.js')
  if (!existsSync(entryPoint)) {
    fail(
      `${label}: ${uiPkg.name} has no dist/index.js — its own build must run first ` +
        `(drop --no-build, or run "pnpm --filter ${uiPkg.name} build").`,
    )
  }
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: HOST_SPECIFIERS,
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: outFile,
    logLevel: 'warning',
  })
  if (result.errors.length > 0) fail(`${label}: esbuild reported errors`)
  const code = readFileSync(outFile, 'utf8')
  assertUiBundle(code, label)
  console.log(`${TAG} ${label}: bundled + validated (${formatBytes(statSync(outFile).size)})`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { feature: null, ui: null, uiMobile: null, out: null, name: null, version: null, build: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const take = (flag) => {
      const v = argv[++i]
      if (!v) fail(`${flag} needs a value`)
      return v
    }
    if (arg === '--feature') opts.feature = take(arg)
    else if (arg.startsWith('--feature=')) opts.feature = arg.slice('--feature='.length)
    else if (arg === '--ui') opts.ui = take(arg)
    else if (arg.startsWith('--ui=')) opts.ui = arg.slice('--ui='.length)
    else if (arg === '--ui-mobile') opts.uiMobile = take(arg)
    else if (arg.startsWith('--ui-mobile=')) opts.uiMobile = arg.slice('--ui-mobile='.length)
    else if (arg === '--out') opts.out = take(arg)
    else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length)
    else if (arg === '--name') opts.name = take(arg)
    else if (arg.startsWith('--name=')) opts.name = arg.slice('--name='.length)
    else if (arg === '--version') opts.version = take(arg)
    else if (arg.startsWith('--version=')) opts.version = arg.slice('--version='.length)
    else if (arg === '--no-build') opts.build = false
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/assemble-plugin.mjs --feature <dir> --ui <dir> [--ui-mobile <dir>] [--out <dir>] [--name <npm-name>] [--version <x.y.z>] [--no-build]')
      process.exit(0)
    } else fail(`unknown argument: ${arg}`)
  }
  if (!opts.feature) fail('--feature <dir> is required (the headless plugin package)')
  if (!opts.ui) fail('--ui <dir> is required (the desktop UI package)')
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const featureDir = resolve(rootDir, opts.feature)
  const uiDir = resolve(rootDir, opts.ui)
  const uiMobileDir = opts.uiMobile ? resolve(rootDir, opts.uiMobile) : null

  const featurePkg = readJson(join(featureDir, 'package.json'), 'feature package.json')
  const featureManifest = readJson(join(featureDir, 'BBeBee.plugin.json'), 'feature BBeBee.plugin.json')
  const uiPkg = readJson(join(uiDir, 'package.json'), 'UI package.json')
  const uiMobilePkg = uiMobileDir ? readJson(join(uiMobileDir, 'package.json'), 'mobile UI package.json') : null
  if (!featureManifest.id) fail('feature BBeBee.plugin.json has no "id"')

  const name = opts.name ?? featurePkg.name
  const version = opts.version ?? featurePkg.version
  if (!name || !version) fail('could not determine package name/version (feature package.json or --name/--version)')

  if (opts.build) {
    runPackageBuild(featurePkg, featureDir)
    runPackageBuild(uiPkg, uiDir)
    if (uiMobilePkg) runPackageBuild(uiMobilePkg, uiMobileDir)
  }

  const featureDist = join(featureDir, 'dist')
  if (!existsSync(join(featureDist, 'index.js'))) {
    fail(`feature package ${featurePkg.name} has no dist/index.js — build it first (drop --no-build).`)
  }

  const outDir = opts.out
    ? resolve(rootDir, opts.out)
    : join(rootDir, '.cache', 'plugin-packages', `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}`)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'dist'), { recursive: true })

  // 1. Headless: copy the feature package's whole dist (its files import
  //    each other relatively; .d.ts/.map are build byproducts, not shipped).
  const headlessFiles = listFiles(featureDist).filter((f) => f.endsWith('.js'))
  if (headlessFiles.some((f) => f === 'ui-desktop.js' || f === 'ui-mobile.js')) {
    fail('feature dist contains ui-desktop.js/ui-mobile.js at its root — those names belong to the assembled UI entries.')
  }
  for (const f of headlessFiles) {
    const dest = join(outDir, 'dist', f)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(featureDist, f), dest)
  }
  console.log(`${TAG} headless: copied ${headlessFiles.length} file(s) from ${featurePkg.name}/dist`)

  // 2. UI bundles with the host modules external + the validation gate.
  await bundleUi(uiDir, uiPkg, join(outDir, 'dist', 'ui-desktop.js'), 'ui-desktop')
  if (uiMobileDir) {
    await bundleUi(uiMobileDir, uiMobilePkg, join(outDir, 'dist', 'ui-mobile.js'), 'ui-mobile')
  }

  // 3. BBeBee.plugin.json: the feature manifest, entry rewritten to the
  //    assembled layout; version aligned with package.json (the installer
  //    refuses on a version disagreement, so the two never drift here).
  const manifest = {
    ...featureManifest,
    name,
    version,
    entry: {
      main: './dist/index.js',
      ui: {
        desktop: './dist/ui-desktop.js',
        ...(uiMobileDir ? { mobile: './dist/ui-mobile.js' } : {}),
      },
    },
  }
  writeFileSync(join(outDir, 'BBeBee.plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  // 4. package.json: publish shape; peerDependencies generated from the
  //    host manifest above — deliberately not copied from either source
  //    package (their peer fields describe monorepo development, not the
  //    host contract).
  const pkg = {
    name,
    version,
    description: featurePkg.description,
    license: featurePkg.license,
    type: 'module',
    main: './dist/index.js',
    files: ['BBeBee.plugin.json', 'dist'],
    peerDependencies: hostPeerDependencies(),
  }
  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  // 5. Report + total size gate.
  const files = listFiles(outDir)
  let total = 0
  console.log(`${TAG} assembled ${name}@${version} → ${outDir}`)
  for (const f of files) {
    const size = statSync(join(outDir, f)).size
    total += size
    console.log(`  ${f}  (${formatBytes(size)})`)
  }
  console.log(`${TAG} total ${formatBytes(total)} across ${files.length} file(s); peerDependencies: ${JSON.stringify(pkg.peerDependencies)}`)
  if (total > SIZE_LIMIT_BYTES) {
    fail(`assembled package is ${formatBytes(total)}, over the ${formatBytes(SIZE_LIMIT_BYTES)} install limit`)
  }
  console.log(`${TAG} done. Publish with: npm publish ${outDir}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
