/**
 * Architectural conventions, checked over the real workspace.
 *
 * These exist because the same defect shape bit twice while building M0: a
 * wrapper that spawns a child plugin without awaiting it. `app.start()` now
 * settles the graph so the mistake is no longer *harmful*, but it still makes
 * a plugin's readiness unreportable to anyone loading it directly — so it is
 * worth catching at the source.
 *
 * A scan rather than a lint rule on purpose: the detector itself is tested
 * below, which a hand-written esquery selector would not be.
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { servicesForCapability, type PluginManifest } from '@BBeBee/protocol'

/*
 * `packages/kernel/src` → the repo root: three levels, not four.
 *
 * ⚠️ It was four, and every check in this file silently scanned a directory
 * that does not exist — `readdir` of a missing path throws, and the scans that
 * swallow their errors returned nothing to inspect, which is indistinguishable
 * from a clean workspace. Layers 0 and 1 are single packages rather than
 * directories of them, so they sit one level shallower than
 * `packages/<layer>/<package>`; see the include globs in `vitest.config.ts`,
 * which had the matching hole.
 */
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Find `ctx.plugin(...)` calls whose result is neither awaited nor returned.
 *
 * Deliberately textual and conservative: it looks only for the two shapes that
 * actually occurred (`const x = ctx.plugin(`, and a bare or `void`-ed call),
 * and treats anything with `await` in front as fine. A parser would be more
 * precise, but this is checkable — see the self-test.
 */
export function findUnawaitedPlugin(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  source.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*')) return
    if (!/\bctx\.plugin\(|\bthis\.ctx\.plugin\(/.test(line)) return
    // `await ctx.plugin(`, `return ctx.plugin(` and `=> ctx.plugin(` all
    // propagate readiness to the caller.
    if (/\bawait\s+(this\.)?ctx\.plugin\(/.test(line)) return
    if (/\breturn\s+(this\.)?ctx\.plugin\(/.test(line)) return
    if (/=>\s*(this\.)?ctx\.plugin\(/.test(line)) return
    hits.push({ line: index + 1, text: line })
  })
  return hits
}

/**
 * Find a plugin entry point declared as a plain (non-async) `function`.
 *
 * Cordis decides "is this a class?" with `!!func.prototype`, and a classic
 * function declaration has one — so `export function apply(ctx) { … }` is
 * `new`-ed as if it were a service, and **the disposer it returns is thrown
 * away**. The plugin loads and works; it just never unloads, which is the one
 * thing this architecture claims is impossible (docs/03 §2).
 *
 * `async function`, arrow functions and object-method shorthand all have no
 * prototype and are safe. So is a class, which is meant to be constructed.
 */
export function findSyncFunctionApply(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  source.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*')) return
    if (/^(export\s+)?function\s+apply\s*\(/.test(line)) {
      hits.push({ line: index + 1, text: line })
    }
  })
  return hits
}

async function sourceFiles(): Promise<string[]> {
  const packagesDir = join(workspaceRoot, 'packages')
  const out: string[] = []

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        await walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        out.push(full)
      }
    }
  }

  // packages/<layer>/<package>/src — docs/09 §1. Layers 2, 3 and 4 are the
  // ones this scan is about; the UI layer has its own conventions.
  for (const layer of ['core', 'logs', 'feature']) {
    const base = join(packagesDir, layer)
    for (const pkg of await readdir(base).catch(() => [])) {
      await walk(join(base, pkg, 'src')).catch(() => undefined)
    }
  }
  return out
}

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

/** Every workspace package that declares itself a plugin, by manifest id. */
async function pluginManifests(): Promise<Map<string, PluginManifest>> {
  const out = new Map<string, PluginManifest>()
  for (const dir of (await packageDirs()).values()) {
    try {
      const raw = await readFile(join(dir, 'BBeBee.plugin.json'), 'utf8')
      const manifest = JSON.parse(raw) as PluginManifest
      out.set(manifest.id, manifest)
    } catch {
      // Not a plugin package.
    }
  }
  return out
}

/** One package's non-test sources, read once. */
async function packageSources(dir: string): Promise<string[]> {
  const pkg = (await packageDirs()).get(dir)
  const root = join(pkg ?? join(workspaceRoot, 'packages', dir), 'src')
  const out: string[] = []
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        await walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        out.push(await readFile(full, 'utf8'))
      }
    }
  }
  await walk(root).catch(() => undefined)
  return out
}

describe('the detector itself', () => {
  it('flags the shapes that actually occurred', () => {
    expect(findUnawaitedPlugin('  const fiber = ctx.plugin(Svc)')).toHaveLength(1)
    expect(findUnawaitedPlugin('  void ctx.plugin(Svc)')).toHaveLength(1)
    expect(findUnawaitedPlugin('  ctx.plugin(Svc, config)')).toHaveLength(1)
    expect(findUnawaitedPlugin('  const f = this.ctx.plugin(Svc)')).toHaveLength(1)
  })

  it('accepts the forms that propagate readiness', () => {
    expect(findUnawaitedPlugin('  const fiber = await ctx.plugin(Svc)')).toEqual([])
    expect(findUnawaitedPlugin('  return ctx.plugin(Svc)')).toEqual([])
    expect(findUnawaitedPlugin('  await this.ctx.plugin(Svc)')).toEqual([])
  })

  it('ignores comments, so prose about the rule does not trip it', () => {
    expect(findUnawaitedPlugin('  // never write ctx.plugin(Svc) without await')).toEqual([])
  })
})

describe('the apply-shape detector', () => {
  it('flags the shape whose disposer is silently dropped', () => {
    expect(findSyncFunctionApply('export function apply(ctx: Context) {')).toHaveLength(1)
    expect(findSyncFunctionApply('function apply(ctx) {')).toHaveLength(1)
  })

  it('accepts the shapes cordis treats as functions', () => {
    expect(findSyncFunctionApply('export async function apply(ctx: Context) {')).toEqual([])
    expect(findSyncFunctionApply('export const apply = (ctx: Context) => {')).toEqual([])
    expect(findSyncFunctionApply('  apply(ctx: Context) {')).toEqual([])
  })
})

describe('workspace conventions', () => {
  it('no plugin entry point is a plain function declaration', async () => {
    // Cordis `new`s anything with a prototype, and drops what it returns.
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      const source = await readFile(file, 'utf8')
      for (const hit of findSyncFunctionApply(source)) {
        offenders.push(`${relative(workspaceRoot, file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(
      offenders,
      'a plain `function apply` is constructed by cordis and its disposer is discarded; ' +
        `use \`async function\` or an arrow:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('no plugin spawns a child without awaiting it', async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      const source = await readFile(file, 'utf8')
      for (const hit of findUnawaitedPlugin(source)) {
        offenders.push(`${relative(workspaceRoot, file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(
      offenders,
      `un-awaited ctx.plugin() — readiness is not propagated to the caller:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * M1's definition of done: "no plugin holds a capability it does not use."
   *
   * It matters most in M5, when an install-time prompt reads the manifest out
   * loud: a plugin asking for the filesystem it never touches teaches users to
   * click through the prompt, which is the whole mechanism failing quietly.
   * Cheaper to keep true from the first milestone than to audit later.
   *
   * `servicesForCapability` is the same mapping the gate uses, so this cannot
   * drift from enforcement. A capability that mediates no service — a flag
   * like `background` maps to one, but a future grant may not — is skipped
   * rather than guessed at: this check is for the ones it can be sure about.
   */
  it('no plugin holds a capability it does not use', async () => {
    const offenders: string[] = []

    for (const [id, manifest] of await pluginManifests()) {
      const dir = id.replace(/^@bbebee\//i, '')
      const sources = await packageSources(dir)
      if (sources.length === 0) continue
      const text = sources.join('\n')

      for (const capability of manifest.capabilities ?? []) {
        const services = servicesForCapability(capability)
        if (services.length === 0) continue
        // Both spellings: `ctx.fs`/`scoped.fs` reads, and the `inject` lists
        // that declare the dependency in the first place.
        const used = services.some(
          (service) =>
            new RegExp(`\\.${service}\\b`).test(text) || new RegExp(`'${service}'`).test(text),
        )
        if (!used) offenders.push(`${id} declares '${capability}' and never reaches ${services.join('/')}`)
      }
    }

    expect(offenders, offenders.join('\n  ')).toEqual([])
  })

  /**
   * Every feature plugin logs, and logs through Layer 3.
   *
   * `ctx.logger` is the only way up to the transports: Cordis provides it,
   * already scoped to the plugin's name, and `plugin-log-{buffer,console,file}`
   * subscribe to it (docs/04 §16). A feature plugin that says nothing is not
   * being tidy — it is the one whose failure arrives as an empty screen, with
   * nothing in the ring buffer the log viewer reads and nothing in the file a
   * bug report attaches. The scanner sitting PENDING for want of `ctx.codec`
   * is the case that cost a day.
   *
   * The lint rules close the two ways around it: `no-console` in Layer 4, and
   * a ban on importing `@BBeBee/plugin-log-*` so nobody reaches a transport
   * directly. This is the other half — that the logging actually happens.
   *
   * Only plugin packages are asked. `source-rules` is pure logic with no
   * Context to log through, which is why it carries no manifest.
   */
  it('every feature plugin logs through the logs layer', async () => {
    const base = join(workspaceRoot, 'packages', 'feature')
    const silent: string[] = []

    for (const pkg of (await readdir(base)).sort()) {
      const isPlugin = await readFile(join(base, pkg, 'BBeBee.plugin.json'), 'utf8')
        .then(() => true)
        .catch(() => false)
      if (!isPlugin) continue

      const sources = await packageSources(pkg)
      if (!sources.some((source) => /\bctx\.logger\./.test(source))) silent.push(pkg)
    }

    expect(
      silent,
      'a feature plugin that never calls ctx.logger has no way to report a failure — ' +
        `the log viewer and the log file are both empty for it (docs/04 §16):\n  ${silent.join('\n  ')}`,
    ).toEqual([])
  })
})
