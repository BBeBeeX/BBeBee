/**
 * The layer model of docs/02 §1, checked over the real workspace.
 *
 * `eslint.config.js` is where the layer rules are *enforced*; these tests
 * exist for the two claims a lint rule cannot make about itself:
 *
 *  1. The kernel's plugin surface — the pinned Cordis re-exports every layer
 *     may import — is duplicated in `eslint.config.js` as an allow-list. Two
 *     copies of one list drift. This pins them together, so adding an export
 *     to `index.ts` forces a deliberate answer to "which surface is it?".
 *  2. `createApp` is called only from the composition root. That is the
 *     narrowest of docs/02 §1's three deliberate exceptions, and the one most
 *     likely to be widened by accident: a second `createApp` call site is a
 *     second bootstrap, and the lint exemption list would quietly grow to
 *     accommodate it.
 *
 * Both are textual scans for the same reason `conventions.test.ts` is: a check
 * whose detector is itself testable beats a cleverer one that is not.
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// `packages/kernel/src` → the repo root: three levels. Layers 0 and 1 are
// single packages, so they sit one level shallower than the layered ones.
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
// Derived from this file rather than spelled out, so moving the kernel — as
// the layer restructure of docs/09 §1 did — cannot silently point it at
// nothing. `readFile` would throw, but a test that skips its subject is worse.
const kernelSrc = fileURLToPath(new URL('.', import.meta.url))
const kernelIndex = join(kernelSrc, 'index.ts')
const eslintConfig = join(workspaceRoot, 'eslint.config.js')

/** The modules whose re-exports form the plugin surface. */
const PLUGIN_SURFACE_SOURCES = ['cordis', './fiber-state.js']

/**
 * Split `index.ts`'s re-exports by the module they come from.
 *
 * Handles the two shapes the file actually uses — `export { … } from '…'` and
 * `export type { … } from '…'`, single- or multi-line — and resolves
 * `A as B` to the exported name `B`, which is what an importer writes.
 */
export function reExportsBySource(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const pattern = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g
  for (const match of source.matchAll(pattern)) {
    const names = match[1] ?? ''
    const from = match[2]
    if (!from) continue
    const parsed = names
      .split(',')
      .map((n) => n.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
      // `Inject as InjectSpec` is imported elsewhere as `InjectSpec`.
      .map((n) => (n.includes(' as ') ? (n.split(' as ')[1] ?? n).trim() : n))
    out.set(from, [...(out.get(from) ?? []), ...parsed])
  }
  return out
}

/** Every single-quoted string inside one top-level `const NAME = [ … ]`. */
function arrayLiteral(config: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\]`).exec(config)
  const body = match?.[1]
  if (body === undefined) throw new Error(`${name} not found in eslint.config.js`)
  return [...body.matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []))
}

/** The `KERNEL_PLUGIN_SURFACE` array literal, as written in the lint config. */
export function pluginSurfaceAllowList(config: string): string[] {
  return arrayLiteral(config, 'KERNEL_PLUGIN_SURFACE')
}

/** The `COMPOSITION_ROOT` array literal, as written in the lint config. */
export function compositionRoot(config: string): string[] {
  return arrayLiteral(config, 'COMPOSITION_ROOT')
}

/**
 * Does this source actually bootstrap a kernel?
 *
 * A call or an import of `createApp` — not a mention of it. The first draft
 * matched the bare word and flagged `core-desktop-bridge`, whose only
 * `createApp` is the phrase "before `createApp`" in a doc comment. Comment
 * lines are dropped first, so a sentence about the bootstrap is not a
 * bootstrap.
 */
export function bootstrapsAKernel(source: string): boolean {
  return source
    .split('\n')
    .filter((raw) => {
      const line = raw.trim()
      return !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')
    })
    .some((line) => /\bcreateApp\s*\(/.test(line) || /import\s*\{[^}]*\bcreateApp\b/.test(line))
}

/** Every non-test `.ts`/`.tsx` under `apps/` and `packages/`, repo-relative. */
async function sourceFiles(): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full)
    }
  }
  for (const root of ['apps', 'packages']) {
    await walk(join(workspaceRoot, root)).catch(() => undefined)
  }
  return out.map((f) => relative(workspaceRoot, f).split('\\').join('/'))
}

describe('the re-export parser', () => {
  it('reads names, aliases and type-only exports', () => {
    const parsed = reExportsBySource(
      [
        "export { Context, Service } from 'cordis'",
        "export type { Plugin, Inject as InjectSpec } from 'cordis'",
        "export { createApp } from './app.js'",
      ].join('\n'),
    )
    expect(parsed.get('cordis')).toEqual(['Context', 'Service', 'Plugin', 'InjectSpec'])
    expect(parsed.get('./app.js')).toEqual(['createApp'])
  })

  it('survives a multi-line export list', () => {
    const parsed = reExportsBySource("export {\n  a,\n  b,\n} from './x.js'")
    expect(parsed.get('./x.js')).toEqual(['a', 'b'])
  })
})

describe('the bootstrap detector', () => {
  it('sees a call and an import', () => {
    expect(bootstrapsAKernel("const app = createApp({ target: 'mobile' })")).toBe(true)
    expect(bootstrapsAKernel("import { createApp } from '@BBeBee/kernel'")).toBe(true)
  })

  it('ignores a comment that merely names it', () => {
    expect(bootstrapsAKernel('/** Call once, before `createApp`. */')).toBe(false)
    expect(bootstrapsAKernel(' * Ask main for paths before createApp() runs.')).toBe(false)
    expect(bootstrapsAKernel('// createApp(ctx)')).toBe(false)
  })
})

/**
 * `@BBeBee/plugin-*` specifiers this source reaches for as *values*.
 *
 * `import type` / `export type` and all-inline-typed specifier lists are not
 * values — the import matrix permits L4→L4 types. Everything else that names
 * a plugin package is: static imports, re-exports, side-effect imports, and
 * dynamic `import()` / `require()`. Kept deliberately syntactic, like the
 * other detectors in this file: it only has to agree with the lint rule on
 * the shapes the rule itself can see.
 */
export function valueImportsOfPlugin(source: string): string[] {
  const out: string[] = []
  const isPlugin = (spec: string): boolean => /^@BBeBee\/plugin-[^/]+(\/|$)/.test(spec)

  /** True when a static import/export clause carries no runtime binding. */
  const clauseIsTypeOnly = (typeKeyword: string | undefined, clause: string): boolean => {
    if (typeKeyword) return true
    const trimmed = clause.trim()
    if (!trimmed) return false
    if (trimmed === '*') return false
    const inner = trimmed.startsWith('{') && trimmed.endsWith('}')
      ? trimmed.slice(1, -1)
      : trimmed
    const specifiers = inner.split(',').map((s) => s.trim()).filter(Boolean)
    if (specifiers.length === 0) return false
    return specifiers.every((s) => /^type\s/.test(s))
  }

  const fromRe =
    /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(fromRe)) {
    const spec = match[4]
    if (!spec || !isPlugin(spec)) continue
    if (clauseIsTypeOnly(match[2], match[3] ?? '')) continue
    out.push(spec)
  }

  const sideEffectRe = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(sideEffectRe)) {
    const spec = match[1]
    if (spec && isPlugin(spec)) out.push(spec)
  }

  const dynamicRe = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(dynamicRe)) {
    const spec = match[1]
    if (spec && isPlugin(spec)) out.push(spec)
  }

  return out
}

describe('the value-import detector', () => {
  it('sees value imports of plugin packages', () => {
    expect(valueImportsOfPlugin("import { x } from '@BBeBee/plugin-a/hooks'")).toEqual([
      '@BBeBee/plugin-a/hooks',
    ])
    expect(valueImportsOfPlugin("export * from '@BBeBee/plugin-a'")).toEqual(['@BBeBee/plugin-a'])
    expect(valueImportsOfPlugin("import '@BBeBee/plugin-a'")).toEqual(['@BBeBee/plugin-a'])
    expect(valueImportsOfPlugin("const m = await import('@BBeBee/plugin-a/hooks')")).toEqual([
      '@BBeBee/plugin-a/hooks',
    ])
    expect(valueImportsOfPlugin("const m = require('@BBeBee/plugin-a')")).toEqual([
      '@BBeBee/plugin-a',
    ])
    expect(valueImportsOfPlugin("import d, { x } from '@BBeBee/plugin-a'")).toEqual([
      '@BBeBee/plugin-a',
    ])
  })

  it('lets type-only imports through', () => {
    expect(valueImportsOfPlugin("import type { X } from '@BBeBee/plugin-a'")).toEqual([])
    expect(valueImportsOfPlugin("import { type X } from '@BBeBee/plugin-a'")).toEqual([])
    expect(valueImportsOfPlugin("export type { X } from '@BBeBee/plugin-a'")).toEqual([])
    expect(valueImportsOfPlugin("export type * from '@BBeBee/plugin-a'")).toEqual([])
  })

  it('still sees a mixed import that carries a value', () => {
    expect(valueImportsOfPlugin("import { type X, y } from '@BBeBee/plugin-a'")).toEqual([
      '@BBeBee/plugin-a',
    ])
  })

  it('ignores shared libraries and relative imports', () => {
    expect(valueImportsOfPlugin("import { x } from '@BBeBee/toolkit/hooks'")).toEqual([])
    expect(valueImportsOfPlugin("import { x } from './hooks.js'")).toEqual([])
    expect(valueImportsOfPlugin("import type { Ctx } from 'cordis'")).toEqual([])
  })
})

describe('the kernel has two surfaces', () => {
  it('the lint allow-list is exactly the pinned Cordis surface', async () => {
    const parsed = reExportsBySource(await readFile(kernelIndex, 'utf8'))
    const surface = PLUGIN_SURFACE_SOURCES.flatMap((from) => parsed.get(from) ?? [])
    const allowed = pluginSurfaceAllowList(await readFile(eslintConfig, 'utf8'))

    expect(surface.length).toBeGreaterThan(0)
    expect(
      [...allowed].sort(),
      'eslint.config.js KERNEL_PLUGIN_SURFACE has drifted from the re-export block at the ' +
        'top of kernel/src/index.ts. A new export there is a decision: in that block and ' +
        'every layer may import it, below it and only Layer 2 may (docs/02 §1).',
    ).toEqual([...surface].sort())
  })

  it('the bootstrap surface is non-empty and disjoint from it', async () => {
    const parsed = reExportsBySource(await readFile(kernelIndex, 'utf8'))
    const surface = new Set(PLUGIN_SURFACE_SOURCES.flatMap((from) => parsed.get(from) ?? []))
    const bootstrap = [...parsed]
      .filter(([from]) => !PLUGIN_SURFACE_SOURCES.includes(from))
      .flatMap(([, names]) => names)

    // If this ever empties, the kernel stopped being a kernel.
    expect(bootstrap).toContain('createApp')
    expect(bootstrap.filter((name) => surface.has(name))).toEqual([])
  })
})

/**
 * Layer 3 — the log transports.
 *
 * The layer's whole value is that nothing above it knows which transport is
 * loaded: a feature plugin calls `ctx.logger`, Cordis routes it, and the shell
 * decides whether that ends up on a console, in a ring buffer, or in a file
 * (docs/04 §16). An import from Layer 4 or 5 would undo that in one line — it
 * pins one transport into code that must not care, and it keeps that transport
 * alive for as long as the importer lives, so disabling logging stops working.
 *
 * `eslint.config.js` bans the import; this checks the ban against the real
 * workspace, because a lint pattern that matches nothing — which is what the
 * first spelling of it did — bans nothing and reads exactly the same.
 */
describe('the logs layer', () => {
  it('is reached through ctx.logger, never by import', async () => {
    const allowed = new Set(compositionRoot(await readFile(eslintConfig, 'utf8')))
    const offenders: string[] = []

    for (const file of await sourceFiles()) {
      // The transports may name each other; the composition root loads them
      // into the bootstrap array, which is the whole point of it being the
      // composition root; the generated registries are codegen.
      if (file.startsWith('packages/logs/')) continue
      if (allowed.has(file)) continue
      if (/^apps\/[^/]+\/generated\//.test(file)) continue

      const source = await readFile(join(workspaceRoot, file), 'utf8')
      if (/from '@BBeBee\/plugin-log-/.test(source)) offenders.push(file)
    }

    expect(
      offenders,
      'a transport imported directly, instead of logging through ctx.logger ' +
        `(docs/04 §16):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('depends on nothing above it', async () => {
    // A transport that imported a feature package would be a feature: it could
    // not be unloaded without taking that feature with it, and the layer would
    // have stopped being a layer.
    const base = join(workspaceRoot, 'packages/logs')
    const offenders: string[] = []

    for (const pkg of await readdir(base)) {
      const manifest = join(base, pkg, 'package.json')
      const parsed = JSON.parse(await readFile(manifest, 'utf8')) as {
        dependencies?: Record<string, string>
      }
      for (const dep of Object.keys(parsed.dependencies ?? {})) {
        // `@BBeBee/plugin-log-*` is a sibling; anything else under
        // `@BBeBee/plugin-*` or `@BBeBee/ui-*` is above this layer, and
        // `core-*` is below but reachable only as a service key.
        const above = /^@BBeBee\/(ui-|core-)/.test(dep) ||
          (dep.startsWith('@BBeBee/plugin-') && !dep.startsWith('@BBeBee/plugin-log-'))
        if (above) offenders.push(`${pkg} depends on ${dep}`)
      }
    }

    expect(offenders, offenders.join('\n  ')).toEqual([])
  })
})

/**
 * Layer 4 — the feature plugins, reaching each other.
 *
 * A feature plugin reaches another feature through a `ctx.*` service, an
 * event, or a shared binding in `@BBeBee/toolkit` — never by importing the
 * other plugin's module (docs/02 §1, the import matrix's "types only").
 * `eslint.config.js` bans the value import; this checks the ban against the
 * real workspace, because a lint pattern that matches nothing bans nothing
 * and reads exactly the same.
 */
describe('the feature layer', () => {
  /** `@BBeBee/*` package name of `packages/feature/<dir>`, cached. */
  const packageNames = new Map<string, string>()
  async function packageNameOf(featureDir: string): Promise<string | undefined> {
    const cached = packageNames.get(featureDir)
    if (cached !== undefined) return cached
    try {
      const manifest = join(workspaceRoot, 'packages/feature', featureDir, 'package.json')
      const parsed = JSON.parse(await readFile(manifest, 'utf8')) as { name?: string }
      if (parsed.name) packageNames.set(featureDir, parsed.name)
      return parsed.name
    } catch {
      return undefined
    }
  }

  it('reaches other features through ctx services, never by import', async () => {
    const offenders: string[] = []

    for (const file of await sourceFiles()) {
      if (!file.startsWith('packages/feature/')) continue
      const featureDir = file.split('/')[2]
      if (!featureDir) continue
      const ownName = await packageNameOf(featureDir)

      const source = await readFile(join(workspaceRoot, file), 'utf8')
      for (const spec of valueImportsOfPlugin(source)) {
        // A package may address its own subpaths; that is not another plugin.
        const targetPkg = spec.split('/').slice(0, 2).join('/')
        if (targetPkg === ownName) continue
        offenders.push(`${file} imports ${spec}`)
      }
    }

    expect(
      offenders,
      'a feature plugin imported another plugin as a value, instead of reaching it ' +
        'through a ctx service, an event, or @BBeBee/toolkit (docs/02 §1):\n  ' +
        offenders.join('\n  '),
    ).toEqual([])
  })
})

describe('the composition root', () => {
  it('is the only place that calls createApp', async () => {
    const allowed = new Set(compositionRoot(await readFile(eslintConfig, 'utf8')))
    const offenders: string[] = []

    for (const file of await sourceFiles()) {
      // The kernel defines it; the generated registries are codegen output and
      // are the codegen'd half of the same composition root.
      if (file.startsWith(relative(workspaceRoot, kernelSrc).split('\\').join('/'))) continue
      if (/^apps\/[^/]+\/generated\//.test(file)) continue
      const source = await readFile(join(workspaceRoot, file), 'utf8')
      if (!bootstrapsAKernel(source)) continue
      if (!allowed.has(file)) offenders.push(file)
    }

    expect(
      offenders,
      'createApp outside the composition root — a second bootstrap is a second kernel ' +
        `(docs/02 §1, "three deliberate exceptions"):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('every file the lint config exempts still exists', async () => {
    const listed = compositionRoot(await readFile(eslintConfig, 'utf8'))
    const present = new Set(await sourceFiles())
    // A stale path does not fail the lint run, it just stops exempting
    // anything — so the exemption list has to be checked here instead.
    expect(listed.filter((f) => !present.has(f))).toEqual([])
  })
})
