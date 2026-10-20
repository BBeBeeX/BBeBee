#!/usr/bin/env node
/**
 * P3 pilot: end-to-end verification of the npm plugin loop for a
 * combined (feature + UI) package, assembled by
 * `scripts/assemble-plugin.mjs`, installed by the real `plugin-manager`
 * + `NpmClient`, and loaded by the real desktop `dynamic-loader`.
 *
 *   node scripts/verify-plugin-pilot.mjs [target]
 *
 * The loop is target-agnostic; everything package-specific (identity,
 * registry entry, world composition, edge services, the update marker,
 * target-specific assertions) is data in
 * `verify-plugin-pilot.targets.mjs`. The default target is
 * `visualizer`, the first-party pilot package. A target may also name
 * `dependencyPackages`: other targets served as its registry
 * dependency closure (installed first, in order), and a target with
 * `source: 'own'` is a prebuilt combined package staged verbatim
 * instead of assembled — the third-party authoring shape.
 *
 * The loop, stage by stage (each stage header in the output states its
 * fidelity — what is real and what is substituted at the edges):
 *
 *   1. assemble (with `--id`, the registry publication id) — or, for
 *      an 'own'-source target, stage the prebuilt package verbatim —
 *      plus any dependency packages, then `npm pack`; the tarball
 *      contents are compared against the package layout.
 *   2. the pilot registry entries are validated with the registry
 *      repo's own `scripts/validate.mjs --strict --skip-network`
 *      against a temporary fixture registry root, and the served
 *      index is the one the registry's own `build-index.mjs`
 *      generates there.
 *   3. a localhost HTTP stand-in serves the registry index,
 *      npm-shaped packuments (real sha512 integrity) and the
 *      tarballs; the real plugin-manager installs from it over real
 *      HTTP — dependency closure first when the entry declares one,
 *      and a negative-control world (dependency entry removed from
 *      the index) must refuse with no half-installed state. The
 *      `HttpService` is a `fetch` implementation of the protocol shape;
 *      store/secrets/settings/device are in-memory stand-ins; the
 *      lifecycle bridge is a recording stand-in that writes files to a
 *      temp plugins directory. A second world with the host React
 *      version misreported as 18.x asserts the P2 peer warning appears
 *      and the install still proceeds.
 *   4. the installed directory is loaded through the real
 *      `makeExternalEntry`/`composePluginWithUi`, with node module
 *      hooks (see `verify-plugin-pilot.hooks.mjs`) standing in for the
 *      shell's import map: the UI bundle's bare `react` resolves to
 *      `apps/desktop/dist/host/react.js`, and object identity with the
 *      host chunk's React is asserted. The composite def is then
 *      applied to a real Cordis context (edge services stubbed) and the
 *      UI's `registerView`/`contribute` calls are observed.
 *   5. a marker string is patched into a copy of the feature build,
 *      re-assembled as the next patch version, and the real update
 *      path runs: `checkUpdates` reports it, rollback staging is
 *      observed in the server request log (the old tarball is
 *      re-fetched), the record flips version, and the reloaded plugin
 *      exposes the new marker.
 *   6. uninstall: plugin files and the lock record go away; unrelated
 *      store data (the plugin's user data) survives.
 *
 * What this does NOT cover: the Tauri shell itself (the
 * `bbebee-plugin://` transport is replaced by the loader's injectable
 * importer seam, mapped to `file:` URLs; the WebView import map is
 * replaced by node module hooks). In-shell verification stays a
 * real-machine gate.
 *
 * The sibling registry checkout is read-only input (its validator is
 * copied into the fixture root, never modified). Override its location
 * with `BBEBEE_REGISTRY_REPO` when it is not `../B_Be_Bee-registry`.
 *
 * Exit code is 0 only when every assertion passes. Workspace packages
 * are rebuilt with the workspace TypeScript before the run, so the
 * code under test is the current source, compiled by its own build.
 */
import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers'
import { TARGETS } from './verify-plugin-pilot.targets.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registryRepo = process.env.BBEBEE_REGISTRY_REPO
  ? resolve(process.env.BBEBEE_REGISTRY_REPO)
  : resolve(repoRoot, '..', 'B_Be_Bee-registry')

const targetName = process.argv[2] ?? 'visualizer'
const target = TARGETS[targetName]
if (!target) {
  console.error(
    `unknown pilot target "${targetName}" — available: ${Object.keys(TARGETS).join(', ')}`,
  )
  process.exit(2)
}
const PLUGIN_ID = target.pluginId
const NPM_NAME = target.npmName
const [V1, V2] = target.versions
const MARKER = target.updateMarker.tag
const MARKER_BASE = target.updateMarker.find
const HOST_VERSION = '19.2.3' // apps/desktop's react (host-modules.manifest.ts)
const HOST_MAJOR = HOST_VERSION.split('.')[0]
const HOST_PEER_RANGE = `^${HOST_MAJOR}.0.0`
const OLDER_HOST_VERSION = `${Number(HOST_MAJOR) - 1}.3.1`
const TARGET_SOURCE = target.source ?? 'assembled'
// Registry packages this target's entry depends on, described by other
// targets in the map and served alongside it (see the targets file).
const depTargets = (target.dependencyPackages ?? []).map((d) => {
  const def = TARGETS[d.target]
  if (!def) throw new Error(`target "${targetName}" depends on unknown target "${d.target}"`)
  return { ...d, def }
})
const EXPECTED_CLOSURE = target.expectClosure ?? []

// ---------------------------------------------------------------------------
// Tiny assertion kit
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

function check(label, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    failures.push(label)
    console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function stage(title) {
  console.log(`\n== ${title}`)
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (res.status !== 0) {
    const tail = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n')
    throw new Error(`command failed: ${cmd} ${args.join(' ')} (exit ${res.status})\n${tail}`)
  }
  return res.stdout ?? ''
}

function buildPackage(pkgDir) {
  run(process.execPath, [join(repoRoot, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
    cwd: pkgDir,
  })
}

function listFiles(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(p, base))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out.sort()
}

const sha256HexOf = (data) => createHash('sha256').update(data).digest('hex')
const sha512B64Of = (data) => createHash('sha512').update(data).digest('base64')

// ---------------------------------------------------------------------------
// Stage 0 — temp root, probe shim, module hooks, workspace builds
// ---------------------------------------------------------------------------

stage('stage 0 — setup (temp root, import-map hooks, workspace builds)')

const tmp = mkdtempSync(join(tmpdir(), 'bbebee-pilot-'))
console.log(`  temp root: ${tmp}`)

const hostDir = join(repoRoot, 'apps/desktop/dist/host')
for (const f of ['react.js', 'react-dom.js', 'react-dom-client.js', 'jsx-runtime.js', 'jsx-dev-runtime.js']) {
  if (!existsSync(join(hostDir, f))) {
    throw new Error(`host chunk missing: ${f} — build apps/desktop first (its dist/host is a P1 artifact)`)
  }
}
const realUrl = (p) => pathToFileURL(realpathSync(p)).href
const hostReactUrl = realUrl(join(hostDir, 'react.js'))

// Probe shim for `react`: re-exports the host chunk byte-for-byte (no
// second copy) and records the module namespace for the identity check.
const probeShimPath = join(tmp, 'react-probe.mjs')
writeFileSync(
  probeShimPath,
  [
    `import * as ns from ${JSON.stringify(hostReactUrl)}`,
    'globalThis.__bbebeePilotProbes ??= {}',
    'globalThis.__bbebeePilotProbes.reactNamespace = ns',
    `export * from ${JSON.stringify(hostReactUrl)}`,
    `export { default } from ${JSON.stringify(hostReactUrl)}`,
    '',
  ].join('\n'),
)
globalThis.__bbebeeGlobStub = () => ({})

const resolutionLog = join(tmp, 'resolutions.jsonl')
writeFileSync(resolutionLog, '')
const dynamicLoaderPath = join(repoRoot, 'apps/desktop/renderer/dynamic-loader.ts')
register('./verify-plugin-pilot.hooks.mjs', {
  parentURL: import.meta.url,
  data: {
    hostTargets: {
      react: pathToFileURL(probeShimPath).href,
      'react-dom': realUrl(join(hostDir, 'react-dom.js')),
      'react-dom/client': realUrl(join(hostDir, 'react-dom-client.js')),
      'react/jsx-runtime': realUrl(join(hostDir, 'jsx-runtime.js')),
      'react/jsx-dev-runtime': realUrl(join(hostDir, 'jsx-dev-runtime.js')),
    },
    workspaceTargets: {
      cordis: realUrl(join(repoRoot, 'packages/kernel/node_modules/cordis/lib/index.js')),
      '@BBeBee/kernel': realUrl(join(repoRoot, 'packages/kernel/dist/index.js')),
      '@BBeBee/protocol': realUrl(join(repoRoot, 'packages/protocol/dist/index.js')),
      '@BBeBee/toolkit': realUrl(join(repoRoot, 'packages/feature/toolkit/dist/index.js')),
      '@BBeBee/toolkit/hooks': realUrl(join(repoRoot, 'packages/feature/toolkit/dist/hooks/index.js')),
    },
    resolutionLog,
    dynamicLoaderUrl: pathToFileURL(dynamicLoaderPath).href,
  },
})

// Build first (the hooks resolve workspace specifiers to these dists),
// then import the code under test — only after the hooks are registered.
// 'own'-source targets build with their own build.mjs instead of tsc.
const tscDirs = new Set([
  'packages/protocol',
  'packages/kernel',
  'packages/feature/toolkit',
  'packages/feature/plugin-manager',
])
const ownBuildDirs = []
for (const t of [target, ...depTargets.map((d) => d.def)]) {
  if ((t.source ?? 'assembled') === 'own') ownBuildDirs.push(t.featureDir)
  else {
    tscDirs.add(t.featureDir)
    if (t.uiDir) tscDirs.add(t.uiDir)
  }
}
for (const pkg of tscDirs) {
  buildPackage(join(repoRoot, pkg))
}
for (const dir of ownBuildDirs) {
  run(process.execPath, [join(repoRoot, dir, 'build.mjs')], { cwd: join(repoRoot, dir) })
}
console.log('  workspace packages rebuilt with the repo TypeScript')

const { Context } = await import('@BBeBee/kernel')
const protocol = await import('@BBeBee/protocol')
const { PluginManagerPlugin } = await import(
  pathToFileURL(join(repoRoot, 'packages/feature/plugin-manager/dist/index.js')).href
)
const { makeExternalEntry } = await import(pathToFileURL(dynamicLoaderPath).href)

// ---------------------------------------------------------------------------
// Stage 1 — assemble + npm pack
// ---------------------------------------------------------------------------

stage(`stage 1 — assemble ${NPM_NAME} (publication id ${PLUGIN_ID}, target ${targetName}) + npm pack`)

function assemble({ forTarget = target, featureDir, version, outDir }) {
  run(
    process.execPath,
    [
      join(repoRoot, 'scripts/assemble-plugin.mjs'),
      '--feature',
      featureDir,
      ...(forTarget.uiDir ? ['--ui', join(repoRoot, forTarget.uiDir)] : []),
      '--version',
      version,
      '--id',
      forTarget.pluginId,
      '--name',
      forTarget.npmName,
      '--no-build',
      '--out',
      outDir,
    ],
    { cwd: repoRoot },
  )
}

// Stages a prebuilt ('own'-source) package: copies the authored package
// directory and pins both version fields to the round's version — the
// installer's three-way version check reads package.json and the
// in-package manifest against the packument's selected version.
function stagePrebuilt({ sourceDir, version, outDir }) {
  cpSync(sourceDir, outDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.endsWith('.tgz'),
  })
  for (const f of ['package.json', 'BBeBee.plugin.json']) {
    const p = join(outDir, f)
    const json = JSON.parse(readFileSync(p, 'utf8'))
    json.version = version
    writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`)
  }
}

// The publishable file set of a prebuilt package: what `npm pack`
// includes — package.json, the readme, and everything its `files`
// field names (single files or whole directories).
function publishableLayout(pkgDir) {
  const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const out = new Set(['package.json'])
  if (existsSync(join(pkgDir, 'README.md'))) out.add('README.md')
  for (const f of pj.files ?? []) {
    const p = join(pkgDir, f)
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) {
      for (const rel of listFiles(p, pkgDir)) out.add(rel)
    } else {
      out.add(f)
    }
  }
  return [...out].sort()
}

function npmPack(pkgDir) {
  const out = run('npm', ['pack', '--json'], {
    cwd: pkgDir,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  })
  const meta = JSON.parse(out.slice(out.indexOf('[')))[0]
  const tarballPath = join(pkgDir, meta.filename)
  const bytes = readFileSync(tarballPath)
  const listing = run('tar', ['-tzf', tarballPath])
    .split('\n')
    .filter((l) => l && !l.endsWith('/'))
    .map((l) => l.replace(/^package\//, ''))
    .sort()
  return { tarballPath, bytes, listing, integrity: `sha512-${sha512B64Of(bytes)}` }
}

const pkgDirV1 = join(tmp, `pkg-${V1}`)
if (TARGET_SOURCE === 'own') {
  stagePrebuilt({ sourceDir: join(repoRoot, target.featureDir), version: V1, outDir: pkgDirV1 })
} else {
  assemble({ featureDir: join(repoRoot, target.featureDir), version: V1, outDir: pkgDirV1 })
}

const manifestV1 = JSON.parse(readFileSync(join(pkgDirV1, 'BBeBee.plugin.json'), 'utf8'))
const hasUi = Boolean(manifestV1.entry?.ui?.desktop)
const layoutV1 = TARGET_SOURCE === 'own' ? publishableLayout(pkgDirV1) : listFiles(pkgDirV1)
check(
  'assembled layout carries manifest, package.json and dist entries',
  ['BBeBee.plugin.json', 'package.json', 'dist/index.js', ...(hasUi ? ['dist/ui-desktop.js'] : [])].every(
    (f) => layoutV1.includes(f),
  ),
  layoutV1.join(', '),
)
check('assembled manifest id is the registry publication id', manifestV1.id === PLUGIN_ID, manifestV1.id)
check('assembled manifest version matches', manifestV1.version === V1, manifestV1.version)
if (hasUi) {
  check(
    'assembled manifest declares entry.ui.desktop',
    manifestV1.entry?.ui?.desktop === './dist/ui-desktop.js',
    JSON.stringify(manifestV1.entry),
  )
}
const packageJsonV1 = JSON.parse(readFileSync(join(pkgDirV1, 'package.json'), 'utf8'))
if (hasUi) {
  check(
    'peerDependencies declare the host contract range',
    packageJsonV1.peerDependencies?.react === HOST_PEER_RANGE &&
      packageJsonV1.peerDependencies?.['react-dom'] === HOST_PEER_RANGE,
    JSON.stringify(packageJsonV1.peerDependencies),
  )
  const uiBundleV1 = readFileSync(join(pkgDirV1, 'dist/ui-desktop.js'), 'utf8')
  check('UI bundle keeps bare react imports', (uiBundleV1.match(/from\s*"react"/g) ?? []).length > 0)
  check(
    'UI bundle contains no React implementation markers',
    !['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED', 'ReactCurrentDispatcher'].some((m) =>
      uiBundleV1.includes(m),
    ),
  )
}

const packV1 = npmPack(pkgDirV1)
check(
  'npm tarball contents equal the assembled layout',
  JSON.stringify(packV1.listing) === JSON.stringify(layoutV1),
  `tarball: ${packV1.listing.join(', ')}`,
)

// Dependency packages are assembled and packed the same way; the
// server registers them alongside the target in stage 3.
const depPacks = []
for (const dep of depTargets) {
  const dir = join(tmp, `dep-${dep.def.pluginId}-${dep.version}`)
  assemble({ forTarget: dep.def, featureDir: join(repoRoot, dep.def.featureDir), version: dep.version, outDir: dir })
  const pack = npmPack(dir)
  depPacks.push({
    def: dep.def,
    version: dep.version,
    dir,
    pack,
    packageJson: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
  })
  check(
    `dependency package ${dep.def.npmName}@${dep.version} assembles and packs`,
    pack.listing.includes('BBeBee.plugin.json') && pack.listing.includes('dist/index.js'),
    pack.listing.join(', '),
  )
}

// ---------------------------------------------------------------------------
// Stage 2 — registry entry fixture, validated by the registry repo's tools
// ---------------------------------------------------------------------------

stage('stage 2 — registry entry validated with the registry repo validator (fixture root)')

if (!existsSync(join(registryRepo, 'scripts/validate.mjs'))) {
  throw new Error(`registry repo not found at ${registryRepo} (set BBEBEE_REGISTRY_REPO)`)
}

// id/npm are injected from the target identity so the entry can never
// drift from the packaged manifest the installer checks it against.
// An `entryFile` target instead ships its entry verbatim (asserted
// against the identity); dependency packages contribute their own
// entries from their target data.
const fixtureEntries = []
if (target.entryFile) {
  const fromFile = JSON.parse(readFileSync(join(repoRoot, target.entryFile), 'utf8'))
  check(
    'entry file identity matches the target identity',
    fromFile.id === PLUGIN_ID && fromFile.npm === NPM_NAME,
    `${fromFile.id} / ${fromFile.npm}`,
  )
  fixtureEntries.push({ entry: fromFile, fileName: target.entryFileName ?? `${PLUGIN_ID}.json` })
} else {
  fixtureEntries.push({
    entry: { id: PLUGIN_ID, npm: NPM_NAME, ...target.entry },
    fileName: target.entryFileName ?? `${PLUGIN_ID}.json`,
  })
}
for (const dep of depTargets) {
  fixtureEntries.push({
    entry: { id: dep.def.pluginId, npm: dep.def.npmName, ...dep.def.entry },
    fileName: dep.def.entryFileName ?? `${dep.def.pluginId}.json`,
  })
}

const fixtureRoot = join(tmp, 'registry-fixture')
for (const d of ['plugins', 'music-sources', 'lyric-sources', 'themes']) {
  mkdirSync(join(fixtureRoot, d), { recursive: true })
}
cpSync(join(registryRepo, 'scripts'), join(fixtureRoot, 'scripts'), { recursive: true })
for (const { entry, fileName } of fixtureEntries) {
  writeFileSync(join(fixtureRoot, 'plugins', fileName), `${JSON.stringify(entry, null, 2)}\n`)
}

run(process.execPath, [join(fixtureRoot, 'scripts/build-index.mjs')], { cwd: fixtureRoot })
const fixtureIndex = JSON.parse(readFileSync(join(fixtureRoot, 'plugins/index.json'), 'utf8'))
check(
  'build-index aggregates every fixture entry',
  // The index wire format is the document form { entries, blocked }
  // since the registry's W4 upgrade; the ids live under `.entries`.
  Array.isArray(fixtureIndex?.entries) &&
    JSON.stringify(fixtureIndex.entries.map((e) => e.id).sort()) ===
      JSON.stringify(fixtureEntries.map(({ entry }) => entry.id).sort()),
  JSON.stringify(
    Array.isArray(fixtureIndex?.entries) ? fixtureIndex.entries.map((e) => e.id) : fixtureIndex,
  ),
)
run(process.execPath, [join(fixtureRoot, 'scripts/validate.mjs'), '--strict', '--skip-network'], {
  cwd: fixtureRoot,
})
check('validate.mjs --strict --skip-network passes on the fixture registry', true)

// ---------------------------------------------------------------------------
// Stage 3 — local stand-in + real install via plugin-manager / NpmClient
// ---------------------------------------------------------------------------

stage('stage 3 — install from a localhost registry/npm stand-in (real HTTP, real plugin-manager)')

// Per-package npm state: every packed package (the target plus any
// dependency packages) registers its versions here; registering a
// newer version moves that package's `latest` tag.
const packagesState = new Map()
const tarballFiles = new Map()
const tarballFileName = (npmName, version) =>
  `${npmName.replace('@', '').replace('/', '-')}-${version}.tgz`
function registerPackage(npmName, version, pack, packageJson) {
  let st = packagesState.get(npmName)
  if (!st) {
    st = { latest: version, versions: {} }
    packagesState.set(npmName, st)
  }
  st.versions[version] = {
    tarballPath: pack.tarballPath,
    integrity: pack.integrity,
    peers: packageJson.peerDependencies,
  }
  st.latest = version
  tarballFiles.set(tarballFileName(npmName, version), pack.tarballPath)
}
registerPackage(NPM_NAME, V1, packV1, packageJsonV1)
for (const dep of depPacks) registerPackage(dep.def.npmName, dep.version, dep.pack, dep.packageJson)
// When set, the index route serves this array instead of the fixture
// index (the negative control removes a dependency entry).
let indexOverride = null
const requestLog = []
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  requestLog.push(`${req.method} ${url.pathname}`)
  if (url.pathname === '/raw/plugins/index.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(indexOverride ?? fixtureIndex))
    return
  }
  if (url.pathname.startsWith('/npm/')) {
    const npmName = decodeURIComponent(url.pathname.slice('/npm/'.length))
    const st = packagesState.get(npmName)
    if (st) {
      const versions = {}
      for (const [v, info] of Object.entries(st.versions)) {
        versions[v] = {
          version: v,
          peerDependencies: info.peers,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/tarballs/${tarballFileName(npmName, v)}`,
            integrity: info.integrity,
          },
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ name: npmName, 'dist-tags': { latest: st.latest }, versions }))
      return
    }
  }
  if (url.pathname.startsWith('/tarballs/')) {
    const path = tarballFiles.get(url.pathname.slice('/tarballs/'.length))
    if (path) {
      const bytes = readFileSync(path)
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length })
      res.end(bytes)
      return
    }
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{}')
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const baseUrl = `http://127.0.0.1:${server.address().port}`
console.log(`  stand-in listening at ${baseUrl}`)

// HttpService (protocol shape) over node fetch — transport only.
const httpService = async (req) => {
  const res = await globalThis.fetch(req.url, {
    method: req.method ?? 'GET',
    headers: req.headers,
    signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
  })
  const headers = {}
  res.headers.forEach((v, k) => {
    headers[k] = v
  })
  return {
    status: res.status,
    headers,
    url: res.url,
    text: () => res.text(),
    json: async () => res.json(),
    bytes: async () => new Uint8Array(await res.arrayBuffer()),
    stream: () => res.body,
  }
}
httpService.get = async () => {
  throw new Error('pilot http: get() not exercised')
}
httpService.post = async () => {
  throw new Error('pilot http: post() not exercised')
}
httpService.download = async () => {
  throw new Error('pilot http: download() not exercised')
}
httpService.cookies = {}

// Composition data comes from the target: real builtin manifests that
// contribute the services the entry requires, plus any synthetic
// manifests for shell-provided services.
function compositionManifests() {
  const manifests = {}
  for (const rel of target.worldManifests ?? []) {
    const m = JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'))
    manifests[m.id] = m
  }
  for (const m of target.syntheticManifests ?? []) {
    manifests[m.id] = m
  }
  return manifests
}

/**
 * In-memory stand-in for the two core tables plugin-manager's
 * capability-grant ledger touches (W1). Both real shells bootstrap a db
 * service before the manager runs, so the world models one too;
 * pattern-matches the ledger's fixed SQL and enforces its foreign key
 * (a grants row without the `plugin_records` parent throws).
 */
function makeFakeDb() {
  const records = new Map()
  const grants = new Map()
  const db = {
    async exec(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.startsWith('INSERT INTO plugin_records')) {
        records.set(String(params[0]), { version: String(params[1]), source: String(params[2]) })
        return { changes: 1, lastInsertRowid: 1 }
      }
      if (s.startsWith('DELETE FROM capability_grants')) {
        return { changes: grants.delete(String(params[0])) ? 1 : 0, lastInsertRowid: 0 }
      }
      if (s.startsWith('INSERT INTO capability_grants')) {
        const pluginId = String(params[0])
        if (!records.has(pluginId)) throw new Error('FOREIGN KEY constraint failed')
        const list = grants.get(pluginId) ?? []
        list.push(String(params[1]))
        grants.set(pluginId, list)
        return { changes: 1, lastInsertRowid: 1 }
      }
      if (s.startsWith('DELETE FROM plugin_records')) {
        grants.delete(String(params[0]))
        records.delete(String(params[0]))
        return { changes: 1, lastInsertRowid: 0 }
      }
      throw new Error(`pilot fake db: unexpected exec: ${s}`)
    },
    async query(sql) {
      if (sql.includes('FROM capability_grants')) {
        return [...grants.entries()].flatMap(([plugin_id, caps]) =>
          caps.map((capability) => ({ plugin_id, capability })),
        )
      }
      throw new Error(`pilot fake db: unexpected query: ${sql}`)
    },
    async get() {
      return undefined
    },
    async transaction(fn) {
      return fn(db)
    },
  }
  return db
}

function makeWorld({ hostReactVersion, pluginsDir }) {
  const ctx = new Context()
  const storeData = new Map()
  const store = {
    get: async (k) => storeData.get(k),
    set: async (k, v) => void storeData.set(k, v),
    delete: async (k) => void storeData.delete(k),
    keys: async () => [...storeData.keys()],
    namespace: () => store,
  }
  ctx.store = store
  ctx.db = makeFakeDb()
  ctx.inspector = { snapshot: () => ({ root: undefined }) }
  ctx.http = httpService
  const settingsObj = {
    ...protocol.DEFAULT_APP_SETTINGS,
    downloadRegion: 'global',
    npmRegistryUrl: `${baseUrl}/npm`,
    githubRawBaseUrl: `${baseUrl}/raw`,
  }
  ctx.settings = { getSync: () => settingsObj, get: async () => settingsObj }
  ctx.secrets = {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
  }
  ctx.device = { appVersion: '0.1.0' }
  const plugin = new PluginManagerPlugin(ctx, { platform: 'desktop', manifests: compositionManifests() })
  const bridgeCalls = []
  const bridge = {
    loadPlugin: async (id) => {
      bridgeCalls.push(['loadPlugin', id])
    },
    unloadPlugin: async (id) => {
      bridgeCalls.push(['unloadPlugin', id])
    },
    uninstallPlugin: async (id) => {
      bridgeCalls.push(['uninstallPlugin', id])
      await rmSync(join(pluginsDir, id), { recursive: true, force: true })
    },
    installPlugin: async (id, files) => {
      bridgeCalls.push(['installPlugin', id])
      for (const [rel, content] of Object.entries(files)) {
        const p = join(pluginsDir, id, rel)
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, content)
      }
    },
  }
  plugin.setLifecycleBridge(bridge)
  plugin.setHostVersions({ react: hostReactVersion, 'react-dom': hostReactVersion })
  return { ctx, plugin, storeData, bridgeCalls, pluginsDir }
}

// --- world A: host reports the real React version ---------------------------
const worldA = makeWorld({ hostReactVersion: HOST_VERSION, pluginsDir: join(tmp, 'plugins-a') })
const planA = await worldA.plugin.resolveInstallPlan(PLUGIN_ID)
check('plan targets the assembled version', planA.target.version === V1, JSON.stringify(planA.target))
check(
  'plan closure matches the target expectation (registry dependencies resolved)',
  JSON.stringify(planA.closure.map((p) => p.id)) === JSON.stringify(EXPECTED_CLOSURE),
  JSON.stringify(planA.closure.map((p) => p.id)),
)
check('plan reports no missing services', planA.missingServices.length === 0, planA.missingServices.join(','))
check('plan has no warnings when the host React satisfies the peer range', planA.warnings.length === 0, planA.warnings.join(' | '))

await worldA.plugin.installPlugin(PLUGIN_ID)
check(
  'bridge installed the closure in dependency order, target last',
  JSON.stringify(worldA.bridgeCalls.filter(([m]) => m === 'installPlugin').map(([, id]) => id)) ===
    JSON.stringify([...EXPECTED_CLOSURE, PLUGIN_ID]),
  JSON.stringify(worldA.bridgeCalls),
)
const installedDirA = join(worldA.pluginsDir, PLUGIN_ID)
check(
  'installed files on disk equal the tarball contents',
  JSON.stringify(listFiles(installedDirA)) === JSON.stringify(packV1.listing),
  listFiles(installedDirA).join(', '),
)
const recordsA = worldA.storeData.get('npm:installed') ?? {}
const recordA = recordsA[PLUGIN_ID]
check('lock record written for the plugin', Boolean(recordA), JSON.stringify(Object.keys(recordsA)))
check(
  'lock record carries npm name, version and tarball sha256',
  recordA?.npm === NPM_NAME && recordA?.version === V1 && recordA?.sha256 === sha256HexOf(packV1.bytes),
  JSON.stringify(recordA),
)
check(
  'lock record entrySha256 hashes the on-disk entry main file',
  recordA?.entrySha256 === sha256HexOf(readFileSync(join(installedDirA, 'dist/index.js'))),
  recordA?.entrySha256,
)
check(
  'plugin-manager list() now includes the installed plugin',
  worldA.plugin.list().some((p) => p.id === PLUGIN_ID),
)
if (depPacks.length > 0) {
  check(
    'lock records written for every closure package (npm, version, tarball sha256)',
    depPacks.every((dep) => {
      const rec = recordsA[dep.def.pluginId]
      return (
        rec?.npm === dep.def.npmName &&
        rec?.version === dep.version &&
        rec?.sha256 === sha256HexOf(dep.pack.bytes) &&
        existsSync(join(worldA.pluginsDir, dep.def.pluginId, 'dist/index.js'))
      )
    }),
    JSON.stringify(recordsA),
  )
}

// --- world B: host misreports an older React → peer warning, install proceeds
const worldB = makeWorld({ hostReactVersion: OLDER_HOST_VERSION, pluginsDir: join(tmp, 'plugins-b') })
const planB = await worldB.plugin.resolveInstallPlan(PLUGIN_ID)
check(
  'peer warning appears when the host React is a major behind',
  planB.warnings.some(
    (w) => w.includes('peer react') && w.includes(HOST_PEER_RANGE) && w.includes(OLDER_HOST_VERSION),
  ),
  planB.warnings.join(' | '),
)
await worldB.plugin.installPlugin(PLUGIN_ID)
check(
  'install still proceeds with a peer warning (warning, not a gate)',
  worldB.bridgeCalls.some(([m]) => m === 'installPlugin') && existsSync(join(worldB.pluginsDir, PLUGIN_ID, 'dist/index.js')),
)

// --- world C (targets with dependencies): negative control ---------------
// The dependency entry disappears from the index: resolution must fail
// loudly and leave no half-installed state behind.
if (depTargets.length > 0) {
  stage('stage 3b — negative control: dependency entry missing from the index')
  const depIds = depTargets.map((d) => d.def.pluginId)
  indexOverride = {
    ...fixtureIndex,
    entries: fixtureIndex.entries.filter((e) => !depIds.includes(e.id)),
  }
  const worldC = makeWorld({ hostReactVersion: HOST_VERSION, pluginsDir: join(tmp, 'plugins-c') })
  let negErr = null
  try {
    await worldC.plugin.installPlugin(PLUGIN_ID)
  } catch (err) {
    negErr = err
  }
  check(
    'install is refused when a closure dependency is missing from the index',
    negErr?.code === 'DEPENDENCY_NOT_FOUND',
    negErr ? `${negErr.code}: ${negErr.message}` : 'no error thrown',
  )
  check(
    'the refused install made no bridge install calls',
    worldC.bridgeCalls.filter(([m]) => m === 'installPlugin').length === 0,
    JSON.stringify(worldC.bridgeCalls),
  )
  check(
    'the refused install wrote no lock records',
    Object.keys(worldC.storeData.get('npm:installed') ?? {}).length === 0,
    JSON.stringify(worldC.storeData.get('npm:installed')),
  )
  check(
    'the refused install left no plugin files on disk',
    !existsSync(join(worldC.pluginsDir, PLUGIN_ID)) &&
      depIds.every((id) => !existsSync(join(worldC.pluginsDir, id))),
  )
  indexOverride = null
}

// ---------------------------------------------------------------------------
// Stage 4 — real dynamic-loader against the installed directory
// ---------------------------------------------------------------------------

stage('stage 4 — load via dynamic-loader; UI resolves React to the host chunk (same instance)')

function fileImporter(pluginsDir, cacheBust) {
  return (url) => {
    const m = /^bbebee-plugin:\/\/app\/([^/]+)\/(.+)$/.exec(url)
    if (!m) throw new Error(`unexpected plugin url: ${url}`)
    const fileUrl = pathToFileURL(join(pluginsDir, decodeURIComponent(m[1]), decodeURIComponent(m[2])))
    if (cacheBust) fileUrl.search = cacheBust
    return import(fileUrl.href)
  }
}

// Loads the target through the real loader path and applies it to a
// fresh Cordis context. Targets with an `activationChain` first load
// and apply those closure packages (from the same installed directory)
// into the same context, so services the target consumes come from the
// real installed packages, not from stubs.
async function activateInstalled(pluginsDir, cacheBust) {
  const importer = fileImporter(pluginsDir, cacheBust)
  const ctx = new Context()
  const uiCalls = { registerView: [], contribute: [] }
  const uiStub = {
    registerView: (id, comp) => {
      uiCalls.registerView.push([id, comp])
      return () => {}
    },
    contribute: (desc) => {
      uiCalls.contribute.push(desc)
      return () => {}
    },
  }
  const settingsObj = { ...protocol.DEFAULT_APP_SETTINGS }
  // The loop supplies the recording `ui` stub and a functional
  // `settings` stub; the target's plain edge-service values merge over
  // them (and may replace either under the same key).
  const edgeServices = {
    settings: { getSync: () => settingsObj, get: async () => settingsObj },
    ui: uiStub,
    ...(target.edgeServices ?? {}),
  }
  for (const [name, value] of Object.entries(edgeServices)) {
    ctx.provide(name, value)
  }
  const mods = {}
  const defs = {}
  for (const id of [...(target.activationChain ?? []), PLUGIN_ID]) {
    const manifest = JSON.parse(readFileSync(join(pluginsDir, id, 'BBeBee.plugin.json'), 'utf8'))
    const entry = makeExternalEntry(id, manifest, importer)
    defs[id] = await entry.load()
    const modUrl = (rel) => {
      const u = pathToFileURL(join(pluginsDir, id, rel))
      if (cacheBust) u.search = cacheBust
      return u.href
    }
    mods[id] = {
      headless: await import(modUrl('dist/index.js')),
      ui: manifest.entry?.ui?.desktop ? await import(modUrl('dist/ui-desktop.js')) : null,
    }
    ctx.plugin(defs[id])
  }
  const started = Date.now()
  const deadline = started + 5000
  while (Date.now() < deadline) {
    const settled = target.activationSettled
      ? target.activationSettled({ uiCalls, ctx })
      : Date.now() - started > 300
    if (settled) break
    await new Promise((r) => delay(r, 25))
  }
  return { def: defs[PLUGIN_ID], ctx, uiCalls, mods }
}

const headlessMod = await import(pathToFileURL(join(installedDirA, 'dist/index.js')).href)
const uiMod = hasUi ? await import(pathToFileURL(join(installedDirA, 'dist/ui-desktop.js')).href) : null
const act1 = await activateInstalled(worldA.pluginsDir)

if (hasUi) {
  check('loader returns the composite def (not the headless def alone)', act1.def !== headlessMod.default)
  check('composite def is named by the plugin id', act1.def?.name === PLUGIN_ID, String(act1.def?.name))
  const registered = []
  act1.def.apply({ plugin: (d) => registered.push(d) })
  check(
    'composite apply registers headless first, UI second (same module objects)',
    registered.length === 2 && registered[0] === headlessMod.default && registered[1] === uiMod.default,
  )
} else {
  check('loader returns the headless def itself (no UI declared)', act1.def === headlessMod.default)
}
if (hasUi) {
  const probes = globalThis.__bbebeePilotProbes
  const hostReact = await import(hostReactUrl)
  check(
    'the React the UI bundle received IS the host chunk React (object identity)',
    Boolean(probes?.reactNamespace) && probes.reactNamespace.default === hostReact.default,
  )
  check('host React version is the expected one', hostReact.version === HOST_VERSION, hostReact.version)
  const log = readFileSync(resolutionLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  const fromUi = log.filter((r) => (r.parent ?? '').endsWith('dist/ui-desktop.js'))
  check(
    'UI bundle resolutions for react/react-dom were served by the import-map stand-in',
    fromUi.some((r) => r.specifier === 'react') && fromUi.some((r) => r.specifier === 'react-dom'),
    JSON.stringify(fromUi.map((r) => r.specifier)),
  )
  check(
    'exactly one react target across the whole run (single instance by construction)',
    new Set(log.filter((r) => r.specifier === 'react').map((r) => r.url)).size === 1,
  )
}
// Target-specific activation assertions live with the target.
target.verifyActivation?.({
  check,
  uiCalls: act1.uiCalls,
  ctx: act1.ctx,
  headlessMod,
  uiMod,
  mods: act1.mods,
})

// ---------------------------------------------------------------------------
// Stage 5 — update round
// ---------------------------------------------------------------------------

stage(`stage 5 — update ${V1} → ${V2} (checkUpdates, rollback staging, version flip)`)

const featureCopy = join(tmp, 'feature-copy')
cpSync(join(repoRoot, target.featureDir), featureCopy, {
  recursive: true,
  filter: (src) => !src.includes('node_modules'),
})
const copyIndexPath = join(featureCopy, target.updateMarker.file)
const copyIndexOrig = readFileSync(copyIndexPath, 'utf8')
check('marker base text present in the feature build', copyIndexOrig.includes(MARKER_BASE))
writeFileSync(copyIndexPath, copyIndexOrig.replace(MARKER_BASE, `${MARKER_BASE} — ${MARKER}`))

const pkgDirV2 = join(tmp, `pkg-${V2}`)
if (TARGET_SOURCE === 'own') {
  stagePrebuilt({ sourceDir: featureCopy, version: V2, outDir: pkgDirV2 })
} else {
  assemble({ featureDir: featureCopy, version: V2, outDir: pkgDirV2 })
}
const packV2 = npmPack(pkgDirV2)
const packageJsonV2 = JSON.parse(readFileSync(join(pkgDirV2, 'package.json'), 'utf8'))
check(
  `re-assembled ${V2} package carries the marker and the publication id`,
  readFileSync(join(pkgDirV2, target.updateMarker.file), 'utf8').includes(MARKER) &&
    JSON.parse(readFileSync(join(pkgDirV2, 'BBeBee.plugin.json'), 'utf8')).id === PLUGIN_ID,
)

registerPackage(NPM_NAME, V2, packV2, packageJsonV2)

const updates = await worldA.plugin.checkUpdates(true)
check(
  'checkUpdates reports the pending update',
  updates.length === 1 && updates[0].id === PLUGIN_ID && updates[0].installed === V1 && updates[0].latest === V2,
  JSON.stringify(updates),
)
requestLog.length = 0
await worldA.plugin.updatePlugin(PLUGIN_ID)
check(
  'rollback staging re-fetched the old tarball during the update',
  requestLog.some((l) => l === `GET /tarballs/${tarballFileName(NPM_NAME, V1)}`),
  requestLog.join(' | '),
)
check(
  'the new tarball was downloaded during the update',
  requestLog.some((l) => l === `GET /tarballs/${tarballFileName(NPM_NAME, V2)}`),
  requestLog.join(' | '),
)
const recordA2 = (worldA.storeData.get('npm:installed') ?? {})[PLUGIN_ID]
check('lock record flipped to the new version', recordA2?.version === V2, JSON.stringify(recordA2))
check(
  'installed entry file now carries the marker',
  readFileSync(join(installedDirA, target.updateMarker.file), 'utf8').includes(MARKER),
)
const act2 = await activateInstalled(worldA.pluginsDir, `pilot=${V2}`)
// Target-specific observability of the update lives with the target.
target.verifyUpdate?.({ check, uiCalls: act2.uiCalls, ctx: act2.ctx, mods: act2.mods, tag: MARKER })

// ---------------------------------------------------------------------------
// Stage 6 — uninstall
// ---------------------------------------------------------------------------

stage('stage 6 — uninstall removes files + lock record, keeps user data')

worldA.storeData.set('pilot-user-data', { likedTracks: 3 })
await worldA.plugin.uninstall(PLUGIN_ID)
check(
  'bridge uninstallPlugin called with the plugin id',
  worldA.bridgeCalls.some(([m, id]) => m === 'uninstallPlugin' && id === PLUGIN_ID),
)
check('plugin directory removed from disk', !existsSync(installedDirA))
check(
  'lock record removed',
  !((worldA.storeData.get('npm:installed') ?? {})[PLUGIN_ID]),
  JSON.stringify(worldA.storeData.get('npm:installed')),
)
check(
  'plugin-manager list() no longer includes the plugin',
  !worldA.plugin.list().some((p) => p.id === PLUGIN_ID),
)
if (EXPECTED_CLOSURE.length > 0) {
  check(
    'closure packages stay installed when the dependent is uninstalled (no cascade)',
    EXPECTED_CLOSURE.every(
      (id) =>
        existsSync(join(worldA.pluginsDir, id, 'dist/index.js')) &&
        Boolean((worldA.storeData.get('npm:installed') ?? {})[id]),
    ),
    JSON.stringify(worldA.storeData.get('npm:installed')),
  )
}
check(
  'unrelated store data (user data) survives the uninstall',
  JSON.stringify(worldA.storeData.get('pilot-user-data')) === JSON.stringify({ likedTracks: 3 }),
)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

server.close()
console.log(`\n== summary: ${passed} passed, ${failed} failed`)
if (failures.length > 0) {
  console.log(`failed assertions:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exitCode = 1
}
console.log(`pilot artifacts kept under ${tmp}`)
