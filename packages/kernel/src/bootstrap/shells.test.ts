/**
 * The two shells, checked against the registry they load.
 *
 * ⚠️ **Why this file exists.** Every M1 package was built, tested and green
 * while the desktop shell had `plugin-player` commented out — because
 * `ctx.audio` was in no bootstrap array — and the mobile shell was still
 * running the M0 set. A milestone can be complete package by package and
 * deliver nothing, because the exit criteria are about the *app*.
 *
 * Neither `boot.ts` can be imported here: one reaches for Electron and the
 * preload bridge, the other for `react-native` and every Expo module. So the
 * part that can go wrong without anything noticing — the allowlist, the
 * registry and the dependency graph agreeing — is read as data, from the
 * `plugins.ts` each shell keeps beside its boot file, from the generated
 * registry, and from the manifests.
 *
 * What this cannot check is that `BOOTSTRAP_SERVICES` matches the actual
 * `bootstrap:` array. That one is checked at runtime instead: each `boot()`
 * awaits `app.ready(BOOTSTRAP_SERVICES)`, so a name nothing registers is a
 * startup error that says which service is missing.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PluginManifest } from '@BBeBee/protocol'

// `packages/kernel/src/bootstrap` → the repo root. One less `..` than the
// layered packages need: Layer 1 is a package, not a directory of them.
const workspaceRoot = fileURLToPath(new URL('../../../..', import.meta.url))

interface Shell {
  name: 'desktop' | 'mobile'
  /** The module holding `ENABLED` and `BOOTSTRAP_SERVICES`. */
  configFile: string
  /** The committed output of `pnpm gen:plugins` (mobile only). */
  registryFile?: string
}

const SHELLS: Shell[] = [
  {
    name: 'desktop',
    configFile: 'apps/desktop/renderer/plugins.ts',
  },
  {
    name: 'mobile',
    configFile: 'apps/mobile/src/plugins.ts',
    registryFile: 'apps/mobile/generated/plugins.ts',
  },
]

/**
 * Every workspace package, by directory name → absolute path.
 *
 * Packages live at `packages/<layer>/<package>` (docs/09 §1), so a name alone
 * no longer locates one. Scanning both levels rather than hardcoding the layer
 * directories keeps this working if a package moves layer — which is the one
 * event the layer model expects to be a plain `git mv`.
 */
async function packageDirs(): Promise<Map<string, string>> {
  const base = join(workspaceRoot, 'packages')
  const out = new Map<string, string>()
  for (const layer of await readdir(base, { withFileTypes: true })) {
    if (!layer.isDirectory()) continue
    for (const pkg of await readdir(join(base, layer.name)).catch(() => [])) {
      out.set(pkg, join(base, layer.name, pkg))
    }
  }
  return out
}

/** Every workspace package that declares itself a plugin. */
async function manifests(): Promise<Map<string, PluginManifest>> {
  const out = new Map<string, PluginManifest>()
  for (const dir of (await packageDirs()).values()) {
    try {
      const raw = await readFile(join(dir, 'BBeBee.plugin.json'), 'utf8')
      const manifest = JSON.parse(raw) as PluginManifest
      out.set(manifest.id, manifest)
    } catch {
      // Not a plugin package. The majority of entries.
    }
  }
  return out
}

/**
 * Read a shell's declared lists.
 *
 * Parsed rather than imported: importing `plugins.ts` would be fine, but doing
 * it by hand keeps this test working if either file ever grows an import that
 * only a bundler can resolve — which is exactly how the shells got into the
 * state this file exists to prevent.
 */
async function shellLists(shell: Shell): Promise<{ enabled: string[]; bootstrap: string[] }> {
  const source = await readFile(join(workspaceRoot, shell.configFile), 'utf8')

  const enabledBlock = source.slice(source.indexOf('export const ENABLED'))
  const enabled = [...enabledBlock.matchAll(/'(@BBeBee\/[^']+)':/g)].map((m) => m[1]!)

  /*
   * The array literal only, not the block around it.
   *
   * Matching `'name',` across the whole declaration would depend on a trailing
   * comma — drop one and the last service silently stops being checked, which
   * weakens this file without ever failing it. Slicing to the brackets also
   * keeps a quoted word in the doc comment above from being read as a service.
   */
  const declaration = source.indexOf('export const BOOTSTRAP_SERVICES')
  const bootstrapBlock = source.slice(
    source.indexOf('[', declaration) + 1,
    source.indexOf(']', declaration),
  )
  const bootstrap = [...bootstrapBlock.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]!)

  expect(enabled.length, `${shell.name}: ENABLED parsed as empty`).toBeGreaterThan(0)
  expect(bootstrap.length, `${shell.name}: BOOTSTRAP_SERVICES parsed as empty`).toBeGreaterThan(0)
  return { enabled, bootstrap }
}

/** The plugin ids present in a shell (from generated registry or dynamic workspace discovery). */
async function registryIds(shell: Shell): Promise<string[]> {
  if (shell.registryFile) {
    const source = await readFile(join(workspaceRoot, shell.registryFile), 'utf8')
    return [...source.matchAll(/^ {2}"(@BBeBee\/[^"]+)": \{$/gm)].map((m) => m[1]!)
  }
  // Desktop shell dynamically discovers all workspace plugins targeted for desktop
  const all = await manifests()
  const ids: string[] = []
  for (const [id, manifest] of all.entries()) {
    if (!manifest.platforms || manifest.platforms.includes(shell.name)) {
      ids.push(id)
    }
  }
  return ids
}

/**
 * The services a package requires, read from its source.
 *
 * Both spellings the codebase uses: `static inject = [...]` on a Service, and
 * `export const inject = [...]` on a functional plugin. A nested
 * `ctx.inject([...], …)` is deliberately *not* matched — that form is how a
 * plugin says a dependency is optional (docs/03 §2), and treating it as
 * required is what would make this check reject a correct shell.
 */
async function requiredInjects(packageDir: string): Promise<string[]> {
  const pkg = (await packageDirs()).get(packageDir)
  const src = join(pkg ?? join(workspaceRoot, 'packages', packageDir), 'src')
  let entries: string[]
  try {
    entries = await readdir(src)
  } catch {
    return []
  }
  for (const file of ['index.ts', 'index.tsx']) {
    if (!entries.includes(file)) continue
    const source = await readFile(join(src, file), 'utf8')
    const match =
      /^\s*static inject = \[([^\]]*)\]/m.exec(source) ??
      /^export const inject = \[([^\]]*)\]/m.exec(source)
    if (match) return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  }
  return []
}

/** `@BBeBee/plugin-player` → `plugin-player`. */
const dirOf = (id: string): string => id.replace(/^@BBeBee\//, '')

describe.each(SHELLS)('the $name shell', (shell) => {
  it('enables only plugins that are actually bundled or available', async () => {
    const { enabled } = await shellLists(shell)
    const bundled = new Set(await registryIds(shell))

    // The exact bug this catches: the desktop config listed
    // `@BBeBee/core-http-node` with no registry entry behind it, so the loader
    // recorded it `missing`, `ctx.http` never existed, and every imported
    // source sat PENDING behind a warning nobody read.
    const absent = enabled.filter((id) => !bundled.has(id))
    expect(
      absent,
      `configured but not available in ${shell.name} plugins — ` +
        `the package is missing a BBeBee.plugin.json or target mismatch:\n  ${absent.join('\n  ')}`,
    ).toEqual([])
  })

  it('provides every service its plugins require', async () => {
    const { enabled, bootstrap } = await shellLists(shell)
    const all = await manifests()

    // What exists once this shell has booted: the bootstrap array, plus every
    // service a configured plugin contributes.
    const available = new Set<string>(bootstrap)
    for (const id of enabled) {
      for (const service of all.get(id)?.contributes?.services ?? []) available.add(service)
    }

    const unmet: string[] = []
    for (const id of enabled) {
      for (const service of await requiredInjects(dirOf(id))) {
        if (!available.has(service)) unmet.push(`${id} injects ctx.${service}`)
      }
    }

    // A required dependency that nothing provides is not an error at boot —
    // the fiber simply waits, forever, and the screen it was going to fill
    // renders empty. That is how `plugin-local-scanner` sat PENDING for want
    // of `ctx.codec` while the app looked like it had started fine.
    expect(
      unmet,
      `no bootstrap entry or configured plugin provides these:\n  ${unmet.join('\n  ')}`,
    ).toEqual([])
  })

  it('runs the same feature set as the other shell', async () => {
    // ADR-2 accepts writing views twice. It does not accept the two shells
    // having different *features* — that is the split UI having become a split
    // product, the last entry in docs/10's "what would make this design wrong".
    const mine = new Set(
      (await shellLists(shell)).enabled.map((id) => id.replace(/-ui-(desktop|mobile)$/, '')),
    )
    const other = SHELLS.find((s) => s.name !== shell.name)!
    const theirs = new Set(
      (await shellLists(other)).enabled.map((id) => id.replace(/-ui-(desktop|mobile)$/, '')),
    )

    // Desktop has the inspector's view package and mobile does not, which is a
    // *view*, not a feature — both shells enable `plugin-inspector` itself.
    const missing = [...theirs].filter((id) => !mine.has(id))
    expect(
      missing,
      `${other.name} runs these and ${shell.name} does not:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })
})

/**
 * The arrangement `ui.missingViews()` exists for (docs/11 §4.12).
 *
 * A contribution with no view on one target must be a normal state, and the
 * only way to know the shells still handle it is for one to actually be in
 * that state. `plugin-inspector` is it: both shells run the plugin, only
 * desktop has a view package for it, and mobile shows "not available on this
 * platform" rather than a hole.
 *
 * Asserted rather than left to the comment above, because the day someone adds
 * `plugin-inspector-ui-mobile` the path stops being covered and nothing else
 * would say so.
 */
/**
 * Where the logs layer comes up (docs/09 §1).
 *
 * It is Layer 3 — above the core services it writes through, below the feature
 * plugins it records — and that ordering is not decoration: a transport loaded
 * from the registry subscribes to `ctx.logger` *while* the features are
 * starting, so the lines it misses are the first ones each of them wrote, which
 * are the lines worth having when one of them did not start.
 *
 * The only place that ordering exists is the `bootstrap:` array, so this checks
 * the two halves that can drift apart: nothing enables a transport through the
 * config allowlist, and each shell's boot file actually loads all three.
 */
describe.each(SHELLS)('the $name shell logs layer', (shell) => {
  const bootFile = shell.configFile.replace(/plugins\.ts$/, 'boot.ts')

  it('is not enabled through the registry', async () => {
    const { enabled } = await shellLists(shell)
    const throughRegistry = enabled.filter((id) => id.startsWith('@BBeBee/plugin-log-'))
    expect(
      throughRegistry,
      `${shell.name}: a transport in ENABLED starts alongside the features it is ` +
        `meant to be recording; it belongs in the bootstrap array:\n  ${throughRegistry.join('\n  ')}`,
    ).toEqual([])
  })

  it('is loaded from the bootstrap array instead', async () => {
    const source = await readFile(join(workspaceRoot, bootFile), 'utf8')
    for (const transport of ['plugin-log-buffer', 'plugin-log-console', 'plugin-log-file']) {
      expect(source, `${shell.name}: ${bootFile} does not load ${transport}`).toContain(
        `@BBeBee/${transport}`,
      )
    }
  })
})

describe('a contribution with no view on one target', () => {
  it('is genuinely configured, so missingViews() is exercised', async () => {
    const desktop = await shellLists(SHELLS.find((s) => s.name === 'desktop')!)
    const mobile = await shellLists(SHELLS.find((s) => s.name === 'mobile')!)

    expect(mobile.enabled, 'both shells run the headless plugin').toContain(
      '@BBeBee/plugin-inspector',
    )
    expect(desktop.enabled).toContain('@BBeBee/plugin-inspector-ui-desktop')
    expect(
      mobile.enabled.some((id) => id.endsWith('inspector-ui-mobile')),
      'if this ever gains a mobile view, point this check at another contribution',
    ).toBe(false)
  })
})
