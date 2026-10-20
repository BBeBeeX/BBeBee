/**
 * Installed-plugin discovery for the desktop sidecar.
 *
 * One directory per installed plugin under `<userData>/installed-plugins/`.
 * Manifest discovery order inside a plugin directory:
 *
 *   1. `BBeBee.plugin.json` — the canonical manifest. This is what
 *      npm-installed plugins carry (the client requires it in the tarball)
 *      and what plugin-manager registers: its `id` is the registry entry id,
 *      NOT the npm package name. It must win over every other candidate or a
 *      restarted app would resurrect the plugin under its npm package name
 *      with an `entry.main` fallback that does not match the install record.
 *   2. `manifest.json` — legacy external plugins.
 *   3. `package.json` — an embedded `manifest` field when present, otherwise
 *      a manifest synthesized from the package fields.
 *
 * A candidate that exists but does not parse (or parses to a non-object)
 * falls through to the next one.
 *
 * The reported `sha256` is over the entry main file
 * (`manifest.entry.main`), which is the basis the renderer's dynamic loader
 * uses for its tamper check.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface InstalledPluginInfo {
  id: string
  version: string
  manifest: unknown
  dirName: string
  sha256?: string
}

const MANIFEST_CANDIDATES = ['BBeBee.plugin.json', 'manifest.json'] as const

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Unreadable/corrupt — the caller falls through to the next candidate.
  }
  return undefined
}

/** Finds the manifest for one installed plugin directory, in priority order. */
export function discoverPluginManifest(pluginDir: string): Record<string, unknown> | undefined {
  for (const name of MANIFEST_CANDIDATES) {
    const candidate = join(pluginDir, name)
    if (!existsSync(candidate)) continue
    const manifest = readJsonObject(candidate)
    if (manifest) return manifest
  }

  const pkgPath = join(pluginDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = readJsonObject(pkgPath)
    if (pkg) {
      if (pkg['manifest'] && typeof pkg['manifest'] === 'object') {
        return pkg['manifest'] as Record<string, unknown>
      }
      return {
        id: pkg['name'],
        version: pkg['version'] ?? '1.0.0',
        displayName: pkg['displayName'] ?? pkg['name'],
        entry: { main: pkg['main'] ?? './index.js' },
        capabilities: pkg['capabilities'] ?? [],
      }
    }
  }
  return undefined
}

/** `manifest.entry.main` normalized the same way the renderer loader does. */
export function entryMainOf(manifest: Record<string, unknown>): string {
  const entry = manifest['entry']
  const main =
    entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['main'] === 'string'
      ? ((entry as Record<string, unknown>)['main'] as string)
      : './index.js'
  return main.replace(/^\.?\//, '')
}

/** Lists every installed plugin under `root` (missing root → empty list). */
export function listInstalledPlugins(root: string): InstalledPluginInfo[] {
  if (!existsSync(root)) return []
  const plugins: InstalledPluginInfo[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pluginDir = join(root, entry.name)
    const manifest = discoverPluginManifest(pluginDir)
    if (!manifest || !manifest['id']) continue

    const mainFilePath = join(pluginDir, entryMainOf(manifest))
    let sha256: string | undefined
    if (existsSync(mainFilePath)) {
      try {
        sha256 = createHash('sha256').update(readFileSync(mainFilePath)).digest('hex')
      } catch {
        // ignore — the plugin is listed without a tamper-check hash
      }
    }
    plugins.push({
      id: String(manifest['id']),
      version: String(manifest['version'] ?? '1.0.0'),
      manifest,
      dirName: entry.name,
      ...(sha256 ? { sha256 } : {}),
    })
  }
  return plugins
}
