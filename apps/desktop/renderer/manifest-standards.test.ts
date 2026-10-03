import { describe, expect, it } from 'vitest'
import { getBuiltinPluginRegistry } from './dynamic-loader.js'
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
