import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBuiltinPluginRegistry } from './dynamic-loader.js'
import { SHELL_MANIFEST } from './plugins.js'
import { bundled as mobileBundled } from '../../mobile/generated/plugins.js'
import { PLUGIN_MANIFESTS } from '../../../packages/ui/plugin-inspector-ui-desktop/src/pcb-manifests.generated.js'
import type { PluginManifest } from '@BBeBee/protocol'

const desktopBundled = getBuiltinPluginRegistry()

function assertManifestStandard(id: string, manifest: PluginManifest) {
  expect(manifest.id, `${id} id`).toBeDefined()
  expect(manifest.name, `${id} name`).toBeDefined()
  expect(manifest.displayName, `${id} displayName`).toBeDefined()
  expect(manifest.description, `${id} description`).toBeDefined()
  expect(manifest.version, `${id} version`).toBeDefined()
  expect(manifest.author, `${id} author`).toBeDefined()
  expect(manifest.engines, `${id} engines`).toBeDefined()
  expect(manifest.engines.BBeBee, `${id} engines.BBeBee`).toBeDefined()
  expect(typeof manifest.enabled, `${id} enabled`).toBe('boolean')
  expect(Array.isArray(manifest.dependencies), `${id} dependencies`).toBe(true)
  expect(manifest.systemId, `${id} systemId`).toBeDefined()
  expect(manifest.systemId, `${id} systemId layer range`).toMatch(/^layer-[1-5]$/)
  expect(manifest.moduleId, `${id} moduleId`).toBeDefined()
  expect(manifest.entry, `${id} entry`).toBeDefined()
  expect(Array.isArray(manifest.capabilities), `${id} capabilities`).toBe(true)
  expect(typeof manifest.contributes, `${id} contributes`).toBe('object')
  expect('effect' in manifest, `${id} effect`).toBe(true)
}

describe('Plugin Manifest Standards across Registries', () => {
  it('validates all desktop bundled plugins against the standard 14 fields', () => {
    const keys = Object.keys(desktopBundled)
    expect(keys.length).toBeGreaterThan(20)
    for (const key of keys) {
      assertManifestStandard(key, desktopBundled[key]!.manifest)
    }
  })

  it('validates all mobile bundled plugins against the standard 14 fields', () => {
    const keys = Object.keys(mobileBundled)
    expect(keys.length).toBeGreaterThan(20)
    for (const key of keys) {
      assertManifestStandard(key, mobileBundled[key]!.manifest)
    }
  })

  it('validates all inspector PLUGIN_MANIFESTS entries against standard 14 fields', () => {
    const keys = Object.keys(PLUGIN_MANIFESTS)
    expect(keys.length).toBeGreaterThan(30)
    for (const key of keys) {
      assertManifestStandard(key, PLUGIN_MANIFESTS[key]!)
    }
  })

  it('verifies that layer-5 UI plugins declare layer-5 and proper moduleId', () => {
    const sourcesUi = desktopBundled['@BBeBee/plugin-sources-ui-desktop']
    expect(sourcesUi).toBeDefined()
    expect(sourcesUi!.manifest.systemId).toBe('layer-5')
    expect(sourcesUi!.manifest.moduleId).toBe('sources')
    expect(sourcesUi!.manifest.dependencies).toContain('@BBeBee/plugin-ui')
    expect(sourcesUi!.manifest.dependencies).toContain('@BBeBee/plugin-sources')
  })
})

/**
 * Manifest completeness gate: every service the desktop composition
 * actually registers must be *declared* — covered by some bundled
 * manifest's `contributes.services`, or by the shell's own declaration
 * (`SHELL_MANIFEST` in plugins.ts).
 *
 * Why this exists: plugin-manager judges install-time service
 * availability against manifests, not against the live `ctx`. A service
 * that exists at runtime but is declared nowhere is invisible to that
 * check, and any npm plugin honestly listing it in its registry entry's
 * `services` is refused on every machine. This gate makes that class of
 * drift fail here, at composition time, instead of in the market.
 *
 * Enumeration scope (deliberate, documented approximations):
 * - "Actually registers" is read from source: literal keys in
 *   `super(ctx, '<key>')` (Cordis Service registration) and
 *   `ctx.provide('<key>')`, scanned over the `src/` trees of exactly the
 *   packages in the desktop bundled registry, plus this directory's own
 *   non-test sources (the shell: `boot.ts` registers `audio` via
 *   DesktopAudioService). Test files and `.d.ts` are skipped.
 * - Registrations through a variable or constant (`super(ctx, SOME_KEY)`)
 *   are invisible to a literal scan. None exist in the scanned set today
 *   (verified when this gate was added); if one is ever introduced, its
 *   key must be declared and this scan widened in the same change.
 * - The package set is the bundled registry, a superset of what ENABLED
 *   loads (it also holds the bootstrap-wired core packages). Stricter
 *   than the runtime composition, deliberately: those manifests are what
 *   plugin-manager is fed, so their declarations are the contract.
 * - Services of npm-installed external plugins are out of scope: they
 *   arrive with their own manifests, which is the mechanism being gated.
 */
describe('Manifest completeness: runtime-registered services are declared', () => {
  // Same manifest glob dynamic-loader uses, so the package set below is
  // the bundled registry's, located on disk for source scanning.
  const manifestFiles = import.meta.glob<PluginManifest>(
    [
      '../../../packages/{core,logs,feature,ui}/**/BBeBee.plugin.json',
      '!../../../packages/**/*-expo/**',
      '!../../../packages/**/*-rn/**',
      '!../../../packages/**/*-mobile/**',
    ],
    { eager: true, import: 'default' },
  )

  const SERVICE_REGISTRATION =
    /super\(\s*ctx\s*,\s*['"]([^'"]+)['"]\s*\)|ctx\.provide\(\s*['"]([^'"]+)['"]\s*\)/g

  function scanFile(path: string, into: Map<string, string>) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(SERVICE_REGISTRATION)) {
      const key = match[1] ?? match[2]
      if (key && !into.has(key)) into.set(key, path)
    }
  }

  function scanTree(dir: string, into: Map<string, string>) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        scanTree(path, into)
      } else if (
        /\.tsx?$/.test(entry) &&
        !entry.includes('.test.') &&
        !entry.endsWith('.d.ts')
      ) {
        scanFile(path, into)
      }
    }
  }

  it('covers every registered service key with a manifest declaration', () => {
    const declared = new Map<string, string>()
    for (const [id, entry] of Object.entries(desktopBundled)) {
      for (const s of entry.manifest.contributes?.services ?? []) {
        if (!declared.has(s)) declared.set(s, id)
      }
    }
    for (const s of SHELL_MANIFEST.contributes?.services ?? []) {
      if (!declared.has(s)) declared.set(s, SHELL_MANIFEST.id)
    }

    const registered = new Map<string, string>()
    // Package sources of exactly the bundled registry's packages.
    for (const [relPath, manifest] of Object.entries(manifestFiles)) {
      if (!desktopBundled[manifest.id]) continue
      const pkgDir = dirname(fileURLToPath(new URL(relPath, import.meta.url)))
      scanTree(join(pkgDir, 'src'), registered)
    }
    // The shell's own sources beside this test (boot.ts & siblings).
    scanTree(fileURLToPath(new URL('.', import.meta.url)), registered)

    // The scan must actually see the composition — an empty result would
    // mean the enumeration broke, not that nothing is registered.
    expect(registered.size).toBeGreaterThan(20)

    const uncovered = [...registered.entries()]
      .filter(([key]) => !declared.has(key))
      .map(([key, file]) => `${key} (registered in ${file})`)
    expect(
      uncovered,
      'services registered at runtime but declared in no manifest — ' +
        'declare them in the providing package’s BBeBee.plugin.json ' +
        'contributes.services, or in SHELL_MANIFEST if the shell wires them directly',
    ).toEqual([])
  })
})
