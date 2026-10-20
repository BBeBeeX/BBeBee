#!/usr/bin/env node
/**
 * Build the host-shared module chunks into `dist/host/`.
 *
 * These chunks are the single React / ReactDOM instances the desktop shell
 * shares with dynamically loaded plugins: the renderer's import map (see
 * `renderer/host-modules.manifest.ts` and `vite.config.ts`) resolves the bare
 * specifiers `react`, `react-dom`, … to `./host/*.js` for the app bundle
 * itself AND for plugin code, so both run the same instance.
 *
 * The react family ships as CommonJS; esbuild converts it to ESM. The named
 * export surface of each chunk is generated from the *actual* CJS exports
 * (discovered by requiring the production build), because guessing export
 * names (rollup-style `export *` over CJS) is how chunks silently end up
 * missing `useState` et al. A post-build assertion re-reads the emitted
 * `host/react.js` and fails the build if the plugin-facing surface is
 * incomplete.
 *
 * `react-dom` and `react-dom/client` are entry points of the SAME build so
 * code splitting puts react-dom's internals in one shared chunk — building
 * them separately would duplicate react-dom state across the two files.
 *
 * Deliberately NO externals: the react family must resolve against each
 * other inside this one build graph (the same approach vite uses when
 * pre-bundling deps). react-dom's CJS does `require("react")` from inside
 * function scope, which esbuild can only emit as a dynamic `__require("react")`
 * when 'react' is external — a runtime bomb in the browser ("Dynamic require
 * of react is not supported"). Resolving it inside the graph instead puts the
 * react implementation in a shared chunk imported by every host file, which
 * is what guarantees the single instance together with the page import map
 * (`react` -> `./host/react.js` for the app bundle AND plugin code).
 *
 * Runs after `vite build` in the `build` chain: vite empties `dist/`, so
 * these chunks must be written afterwards.
 */
process.env.NODE_ENV = 'production'

import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import console from 'node:console'
import { build } from 'esbuild'
import { HOST_MODULES, HOST_REACT_VERSION } from '../renderer/host-modules.manifest.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const distDir = resolve(appDir, 'dist')
const require = createRequire(resolve(appDir, 'package.json'))

// The manifest's version constant is the contract the chunks are built
// against; refuse to build against a different installed react.
const installedReact = require('react/package.json').version
if (installedReact !== HOST_REACT_VERSION) {
  console.error(
    `[build:host-modules] installed react is ${installedReact} but host-modules.manifest.ts declares ${HOST_REACT_VERSION}; update the manifest (single source of truth).`,
  )
  process.exit(1)
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Actual export names of a CJS package entry, minus `default` and non-identifiers. */
function cjsExportNames(entry) {
  const mod = require(entry)
  return Object.keys(mod ?? {}).filter((k) => k !== 'default' && IDENT.test(k))
}

/**
 * ESM shim re-exporting a CJS entry: default passthrough plus one named
 * const per real CJS export, so the emitted chunk's export surface is exact.
 *
 * The shim imports the entry by its resolved absolute file path, NOT by bare
 * specifier: the specifiers themselves are on the external list (so the
 * bundled react-family code keeps referencing them for the import map), and
 * a bare import in the shim would externalize the very package the chunk is
 * supposed to contain.
 */
function shimSource(resolvedPath, names) {
  const lines = [`import def from ${JSON.stringify(resolvedPath)}`, 'export default def']
  if (names.length > 0) {
    lines.push(`export const { ${names.join(', ')} } = def`)
  }
  return lines.join('\n') + '\n'
}

// Virtual entry points: one per manifest entry, content from the shim generator.
const shims = new Map()
const entryPoints = {}
for (const m of HOST_MODULES) {
  const virtualId = `bbebee-host:${m.specifier}`
  shims.set(virtualId, shimSource(require.resolve(m.entry), cjsExportNames(m.entry)))
  // Output name mirrors the manifest file ('host/react.js' -> 'host/react').
  entryPoints[m.file.replace(/\.js$/, '')] = virtualId
}

const virtualEntries = {
  name: 'bbebee-host-entries',
  setup(b) {
    b.onResolve({ filter: /^bbebee-host:/ }, (args) => ({ path: args.path, namespace: 'bbebee-host' }))
    b.onLoad({ filter: /.*/, namespace: 'bbebee-host' }, (args) => ({
      contents: shims.get(args.path),
      loader: 'js',
      // Resolve package imports from the app's node_modules, not from the
      // virtual namespace.
      resolveDir: appDir,
    }))
  },
}

await build({
  entryPoints,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  // Evergreen webviews, same floor as build-shim.js.
  target: 'es2020',
  // Pin production builds of the react family regardless of ambient env.
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [virtualEntries],
  outdir: distDir,
  chunkNames: 'host/chunk-[hash]',
  absWorkingDir: appDir,
  logLevel: 'warning',
})

// ---------------------------------------------------------------------------
// Post-build assertions
// ---------------------------------------------------------------------------

/** Export names an emitted ESM file statically declares. */
function emittedExportNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim()
      if (!seg) continue
      const asParts = seg.split(/\s+as\s+/)
      names.add((asParts[1] ?? asParts[0]).trim())
    }
  }
  for (const m of code.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(m[1])
  }
  if (/export\s+default\b/.test(code)) names.add('default')
  return names
}

/** Relative module specifiers an emitted file imports from. */
function emittedRelativeImports(code) {
  const specs = new Set()
  for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    specs.add(m[1])
  }
  return specs
}

const REQUIRED_REACT_EXPORTS = [
  'useState',
  'useEffect',
  'useRef',
  'useMemo',
  'useCallback',
  'useContext',
  'createElement',
  'Fragment',
  'memo',
  'forwardRef',
  'StrictMode',
  'version',
  'default',
]

const reactOut = resolve(distDir, 'host/react.js')
if (!existsSync(reactOut)) {
  console.error(`[build:host-modules] expected output missing: ${reactOut}`)
  process.exit(1)
}
const reactNames = emittedExportNames(readFileSync(reactOut, 'utf8'))
const missing = REQUIRED_REACT_EXPORTS.filter((k) => !reactNames.has(k))
if (missing.length > 0) {
  console.error(
    `[build:host-modules] host/react.js is missing required exports: ${missing.join(', ')}. ` +
      'The CJS->ESM export surface is incomplete; do not ship this build.',
  )
  process.exit(1)
}

// No host chunk may contain a bare (non-relative) import: every dependency
// must resolve inside the dist/host/ graph. A bare specifier here means a
// leaked external (e.g. esbuild emitting __require("react")), which the
// browser cannot resolve and which would break the single-instance guarantee.
const hostFiles = HOST_MODULES.map((m) => m.file)
// Entry files AND shared chunks: a leaked external in a chunk poisons every
// entry that imports it.
const emittedFiles = readdirSync(resolve(distDir, 'host'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `host/${f}`)
for (const file of emittedFiles) {
  const code = readFileSync(resolve(distDir, file), 'utf8')
  const bare = new Set()
  for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (!m[1].startsWith('.')) bare.add(m[1])
  }
  if (bare.size > 0) {
    console.error(
      `[build:host-modules] dist/${file} contains bare imports: ${[...bare].join(', ')}. ` +
        'Host chunks must be fully self-contained within dist/host/.',
    )
    process.exit(1)
  }
  // __require("x") with an argument is the signature of a dynamic require
  // esbuild could not statically convert (e.g. CJS require of an external
  // inside function scope); it throws "Dynamic require … is not supported"
  // in the browser. The __commonJS helper *definition* (function __require())
  // is harmless and not matched here.
  if (/__require\s*\(\s*["']/.test(code)) {
    console.error(
      `[build:host-modules] dist/${file} contains a dynamic __require("…") call; ` +
        'it would throw at runtime in the browser.',
    )
    process.exit(1)
  }
}

// Shared-chunk invariants: one copy of react internals across every file that
// uses them, and one copy of react-dom internals between the two dom entries.
const chunkGraph = new Map()
for (const file of hostFiles) {
  chunkGraph.set(
    file,
    emittedRelativeImports(readFileSync(resolve(distDir, file), 'utf8')),
  )
}
function mustShareChunks(a, b, why) {
  const shared = [...chunkGraph.get(a)].filter((s) => chunkGraph.get(b).has(s))
  if (shared.length === 0) {
    console.error(`[build:host-modules] ${a} and ${b} share no chunk; ${why}.`)
    process.exit(1)
  }
  return shared
}
const domShared = mustShareChunks('host/react-dom.js', 'host/react-dom-client.js', 'react-dom internals would be duplicated')
const reactShared = mustShareChunks('host/react.js', 'host/react-dom.js', 'react would exist in two copies')

console.log(
  `[build:host-modules] wrote ${HOST_MODULES.length} host chunks to dist/host/ ` +
    `(react ${HOST_REACT_VERSION}, ${reactNames.size} react exports, react chunk shared with react-dom: ${reactShared.join(', ')}, react-dom chunks shared with client: ${domShared.join(', ')})`,
)
