/**
 * Codegen for the static plugin registry.
 *
 * Metro cannot resolve a module path computed at runtime, so every plugin
 * import on mobile has to be statically analysable. This scans the workspace
 * for packages carrying a `BBeBee.plugin.json` and emits a module of literal
 * `import` statements — the shape `plugin-loader-static` consumes.
 *
 * The output is committed, so a clean checkout builds without running codegen
 * first and CI can assert the file is up to date rather than regenerating it.
 *
 * See docs/03-plugin-system.md §6.1.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { PluginManifest } from '@BBeBee/protocol'

export interface DiscoveredPlugin {
  manifest: PluginManifest
  /** Package directory, absolute. */
  dir: string
  /**
   * The JS package name from the directory's package.json (the import
   * specifier that actually resolves). This is deliberately NOT derived
   * from the manifest id, even though the two now agree for built-in
   * plugins (both `@bbebee/`): a package.json name is the source of
   * truth for what resolves, and deriving it from the manifest id
   * would silently emit unresolvable specifiers if they ever diverged.
   */
  pkgName: string
}

export interface GenerateOptions {
  /** Workspace root. */
  root: string
  /** Directories to scan, relative to root. */
  packagesDirs?: string[]
  /** Which UI entrypoint to wire up. */
  target: 'mobile' | 'desktop'
  /** Where to write the generated module. */
  outFile: string
}

/** A directory's plugin manifest, or `undefined` if it has none. */
async function readManifest(dir: string): Promise<PluginManifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'BBeBee.plugin.json'), 'utf8')) as PluginManifest
  } catch {
    return undefined
  }
}

/** A directory's JS package name, falling back to its manifest id. */
async function readPkgName(dir: string, manifestId: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      name?: unknown
    }
    return typeof pkg.name === 'string' && pkg.name ? pkg.name : manifestId
  } catch {
    return manifestId
  }
}

/** Find every workspace package that declares itself a BBeBee plugin. */
export async function discover(
  root: string,
  packagesDirs: string[] = ['packages'],
): Promise<DiscoveredPlugin[]> {
  const found: DiscoveredPlugin[] = []

  for (const rel of packagesDirs) {
    const base = join(root, rel)
    let entries: string[]
    try {
      entries = await readdir(base)
    } catch {
      continue
    }

    for (const entry of entries.sort()) {
      const dir = join(base, entry)
      const manifest = await readManifest(dir)
      if (manifest) {
        found.push({ manifest, dir, pkgName: await readPkgName(dir, manifest.id) })
        continue
      }
      /*
       * Not a package — a *layer* directory. Packages live at
       * `packages/<layer>/<package>` (docs/09 §1), so the scan descends one
       * level when it finds no manifest. One extra level, not a full walk: a
       * plugin nested any deeper is a mistake this should surface by missing
       * it, not absorb by searching harder.
       */
      for (const nested of (await readdir(dir).catch(() => [])).sort()) {
        const nestedDir = join(dir, nested)
        const nestedManifest = await readManifest(nestedDir)
        if (nestedManifest) {
          found.push({
            manifest: nestedManifest,
            dir: nestedDir,
            pkgName: await readPkgName(nestedDir, nestedManifest.id),
          })
        }
      }
    }
  }
  return found
}

/**
 * Render the registry module.
 *
 * Import identifiers are derived from the package id and deduplicated, because
 * two packages differing only in punctuation would otherwise emit the same
 * binding and fail to compile — loudly, but confusingly.
 */
/**
 * Keep only the plugins that belong in this shell.
 *
 * A manifest with no `platforms` runs everywhere — that is the default and the
 * point of the architecture. The exceptions are the `core-*` implementations,
 * which are platform-specific by nature: without this the mobile registry
 * imported desktop-specific modules, and nothing said so, because a bundler resolving
 * desktop modules in React Native fails at run time rather than at build time.
 */
export function forTarget(
  plugins: DiscoveredPlugin[],
  target: 'mobile' | 'desktop',
): DiscoveredPlugin[] {
  return plugins.filter((p) => !p.manifest.platforms || p.manifest.platforms.includes(target))
}

export function render(plugins: DiscoveredPlugin[], target: 'mobile' | 'desktop'): string {
  const existingIds = new Set(plugins.map((p) => p.manifest.id))
  const rows = plugins.map((p) => ({
    id: p.manifest.id,
    pkgName: p.pkgName,
    ui: p.manifest.entry.ui?.[target],
    manifest: p.manifest,
  }))

  const lines: string[] = [
    '// GENERATED by @BBeBee/tooling-gen-plugins — do not edit.',
    `// Target: ${target}. Run \`pnpm gen:plugins\` to refresh.`,
    '',
    "import type { PluginRegistry } from '@BBeBee/kernel'",
    '',
    'export const bundled: PluginRegistry = {',
  ]

  const emitted = new Set<string>()

  for (const row of rows) {
    if (emitted.has(row.id)) continue
    emitted.add(row.id)
    lines.push(`  ${JSON.stringify(row.id)}: {`)
    lines.push(`    load: () => import('${row.pkgName}'),`)
    lines.push(`    manifest: ${JSON.stringify(row.manifest)},`)
    // Workspace plugins are first-party, so the capability gate trusts their
    // manifests without a user grant (docs/03 §7).
    lines.push('    builtin: true,')
    lines.push('  },')
    if (row.ui) {
      const uiId = `${row.id}-ui-${target}`
      if (!existingIds.has(uiId) && !emitted.has(uiId)) {
        emitted.add(uiId)
        lines.push(`  ${JSON.stringify(uiId)}: {`)
        lines.push(`    load: () => import('${row.pkgName}-ui-${target}'),`)
        lines.push(
          `    manifest: ${JSON.stringify({
            ...row.manifest,
            id: uiId,
            name: uiId,
            displayName: `${row.manifest.displayName ?? row.manifest.name ?? row.id} (${target} views)`,
            systemId: 'layer-5',
            capabilities: row.manifest.capabilities ?? [],
            entry: { main: row.ui },
          })},`,
        )
        lines.push('    builtin: true,')
        lines.push('  },')
      }
    }
  }
  lines.push('}', '')
  return lines.join('\n')
}

/**
 * Render the static manifest dictionary for topology and inspector consumers.
 */
export function renderManifests(plugins: DiscoveredPlugin[]): string {
  const map: Record<string, PluginManifest> = {}
  for (const p of plugins) {
    const m = p.manifest
    map[m.id] = m
    const shortName = m.id.replace(/^@bbebee\//i, '')
    map[shortName] = m
  }

  const lines: string[] = [
    '// GENERATED by @BBeBee/tooling-gen-plugins — do not edit.',
    '// Run `pnpm gen:plugins` to refresh.',
    '',
    "import type { PluginManifest } from '@BBeBee/protocol'",
    '',
    `export const PLUGIN_MANIFESTS: Record<string, PluginManifest> = ${JSON.stringify(map, null, 2)}`,
    '',
  ]
  return lines.join('\n')
}

export async function generate(options: GenerateOptions): Promise<string> {
  const plugins = await discover(options.root, options.packagesDirs)
  const source = render(forTarget(plugins, options.target), options.target)
  await writeFile(options.outFile, source, 'utf8')
  return relative(options.root, options.outFile)
}

export async function generateManifests(options: {
  root: string
  outFile: string
  packagesDirs?: string[]
}): Promise<string> {
  const plugins = await discover(options.root, options.packagesDirs)
  const source = renderManifests(plugins)
  await writeFile(options.outFile, source, 'utf8')
  return relative(options.root, options.outFile)
}

/**
 * The service-key universe: every Cordis service key the app composition
 * can provide, as data.
 *
 * Single source of truth for "which service keys exist". Install-time
 * availability inside the app is judged against manifests (the gate in
 * `apps/desktop/renderer/manifest-standards.test.ts` keeps runtime
 * registrations covered by them), and the community registry validates
 * entry `services` against this same set — it vendors a copy of this
 * artifact (`scripts/lib/service-keys.generated.json` in
 * B_Be_Bee-registry, refreshed by its `scripts/sync-service-keys.mjs`)
 * instead of maintaining a second, hand-written list.
 *
 * The set is the union of `contributes.services` over every discovered
 * manifest, plus whatever the shell declares for itself
 * (`SHELL_MANIFEST` — services wired by the composition root with no
 * providing package manifest). There is deliberately no hand-written
 * supplement: a key that is missing here is missing because no manifest
 * declares it, and the fix belongs in that manifest, not in this file.
 */
/**
 * The critical service keys (policy, decided 2026-10-20): services whose
 * substitution by a third-party plugin would compromise the system —
 * credentials, code execution, the data layer, all plugin traffic, global
 * config, the content/library pipeline, and the playback core. Registry
 * entries may not claim `provides` for these keys, and the settings UI
 * never offers an off switch for their built-in providers. Every other
 * key is replaceable: third-party providers are allowed and the user may
 * choose which provider is active. This list is the single declaration;
 * it is emitted into the generated artifact and vendored by the registry.
 * Generation fails if a critical key is no longer provided by anything,
 * so renaming or removing a critical service cannot slip past the policy.
 */
export const CRITICAL_SERVICE_KEYS: readonly string[] = [
  'audio',
  'codec',
  'contentRegistry',
  'db',
  'downloads',
  'fs',
  'http',
  'js',
  'library',
  'paths',
  'player',
  'plugin-manager',
  'scanner',
  'secrets',
  'securityAudit',
  'settings',
  'store',
]

export interface ServiceKeysArtifact {
  description: string
  generatedBy: string
  sources: string[]
  /** Every service key, sorted. */
  serviceKeys: string[]
  /** The critical subset of `serviceKeys` (see CRITICAL_SERVICE_KEYS), sorted. */
  criticalKeys: string[]
  /** Key → manifest ids that declare it in `contributes.services`. */
  providers: Record<string, string[]>
}

export function collectServiceKeys(
  plugins: DiscoveredPlugin[],
  shellServices: readonly string[] = [],
  shellProviderId = '@BBeBee/app-shell',
): ServiceKeysArtifact {
  const providers = new Map<string, Set<string>>()
  const add = (key: string, provider: string) => {
    let set = providers.get(key)
    if (!set) providers.set(key, (set = new Set()))
    set.add(provider)
  }
  for (const p of plugins) {
    for (const s of p.manifest.contributes?.services ?? []) add(s, p.manifest.id)
  }
  for (const s of shellServices) add(s, shellProviderId)

  const serviceKeys = [...providers.keys()].sort()
  const providersRecord: Record<string, string[]> = {}
  for (const key of serviceKeys) providersRecord[key] = [...providers.get(key)!].sort()

  const criticalKeys = [...CRITICAL_SERVICE_KEYS].sort()
  const missing = criticalKeys.filter((k) => !providers.has(k))
  if (missing.length > 0) {
    throw new Error(
      `CRITICAL_SERVICE_KEYS names services nothing provides anymore: ${missing.join(', ')}. ` +
        'Update the policy list in tooling-gen-plugins together with the service change.',
    )
  }

  return {
    description:
      'Every Cordis service key the BBeBee app can provide: the union of ' +
      'contributes.services across all plugin manifests, plus the shell’s ' +
      'own declaration. This file is the single source of truth for the ' +
      'service-key allowlist — the community registry vendors a copy of ' +
      'it rather than maintaining its own list. `criticalKeys` is the ' +
      'protected subset: registry entries may not claim to provide them, ' +
      'and their built-in providers cannot be disabled in settings.',
    generatedBy:
      '@BBeBee/tooling-gen-plugins — do not edit by hand; run `pnpm gen:plugins` to regenerate.',
    sources: [
      'contributes.services of every BBeBee.plugin.json under packages/',
      'SHELL_MANIFEST.contributes.services in apps/desktop/renderer/plugins.ts',
    ],
    serviceKeys,
    criticalKeys,
    providers: providersRecord,
  }
}

export function renderServiceKeys(artifact: ServiceKeysArtifact): string {
  return JSON.stringify(artifact, null, 2) + '\n'
}

/**
 * Renders the artifact as a TypeScript module for `@BBeBee/protocol`,
 * so app code (settings UI, plugin-manager, the desktop boot) consumes
 * the same generated facts through the normal import graph instead of
 * reading the JSON at runtime. Data only, plus two lookups the
 * consumers all need.
 */
export function renderServiceKeysModule(artifact: ServiceKeysArtifact): string {
  const lines: string[] = [
    '/**',
    ' * GENERATED by @BBeBee/tooling-gen-plugins — do not edit by hand.',
    ' * Regenerate with `pnpm gen:plugins`. The data mirrors',
    ' * `packages/protocol/service-keys.json` from the same generation',
    ' * pass: every service key is the union of `contributes.services`',
    ' * across all plugin manifests plus the shell declaration;',
    ' * `criticalKeys` is the protected subset (registry entries may not',
    ' * claim to provide them, and their built-in providers cannot be',
    ' * disabled in settings).',
    ' */',
    '',
    `export const SERVICE_KEYS: readonly string[] = ${JSON.stringify(artifact.serviceKeys)}`,
    '',
    `export const CRITICAL_SERVICE_KEYS: readonly string[] = ${JSON.stringify(artifact.criticalKeys)}`,
    '',
    'export const SERVICE_KEY_PROVIDERS: Readonly<Record<string, readonly string[]>> = ' +
      JSON.stringify(artifact.providers, null, 2),
    '',
    'const CRITICAL_SERVICE_KEY_SET: ReadonlySet<string> = new Set(CRITICAL_SERVICE_KEYS)',
    '',
    '/** True when `key` is a critical (protected, non-replaceable) service key. */',
    'export function isCriticalServiceKey(key: string): boolean {',
    '  return CRITICAL_SERVICE_KEY_SET.has(key)',
    '}',
    '',
    '/**',
    ' * The critical service keys the given plugin manifest id provides',
    ' * (empty when it provides none). These are the providers the',
    ' * settings UI locks on and the service layer refuses to disable.',
    ' */',
    'export function criticalServiceKeysOfProvider(manifestId: string): string[] {',
    '  return artifactProvidersOf(manifestId).filter((key) => CRITICAL_SERVICE_KEY_SET.has(key))',
    '}',
    '',
    '/** Every service key the given plugin manifest id declares in `contributes.services`. */',
    'export function serviceKeysOfProvider(manifestId: string): string[] {',
    '  return artifactProvidersOf(manifestId)',
    '}',
    '',
    'function artifactProvidersOf(manifestId: string): string[] {',
    '  const keys: string[] = []',
    '  for (const [key, providers] of Object.entries(SERVICE_KEY_PROVIDERS)) {',
    '    if (providers.includes(manifestId)) keys.push(key)',
    '  }',
    '  return keys.sort()',
    '}',
    '',
  ]
  return lines.join('\n')
}

export async function generateServiceKeys(options: {
  root: string
  outFile: string
  /** Also emit the artifact as a TypeScript module (for `@BBeBee/protocol`). */
  tsOutFile?: string
  shellServices?: readonly string[]
  shellProviderId?: string
  packagesDirs?: string[]
}): Promise<string> {
  const plugins = await discover(options.root, options.packagesDirs)
  const artifact = collectServiceKeys(
    plugins,
    options.shellServices ?? [],
    options.shellProviderId,
  )
  await writeFile(options.outFile, renderServiceKeys(artifact), 'utf8')
  if (options.tsOutFile) {
    await writeFile(options.tsOutFile, renderServiceKeysModule(artifact), 'utf8')
  }
  return relative(options.root, options.outFile)
}
