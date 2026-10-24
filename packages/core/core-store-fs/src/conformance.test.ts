/**
 * `core-store-fs` against the shared conformance suite.
 *
 * One implementation serves both platforms here, so this suite runs once —
 * but it runs over the real `ctx.fs`, which is what makes it meaningful: the
 * store's behaviour on a device is whatever `core-fs-expo` does underneath.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { storeConformance } from '@BBeBee/protocol/conformance'
import { scopeContext } from '@BBeBee/kernel'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { StoreFs } from '../src/index.js'
import { tempDir } from '@BBeBee/kernel/testing'

let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-store')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function freshStore(fileName?: string) {
  const dir = await mkdtemp(join(root, 'store-'))
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: dir })
  await ctx.plugin(FsNode)
  // Flush synchronously so assertions do not race the batch window.
  await ctx.plugin(StoreFs, { flushDelayMs: 0, ...(fileName ? { fileName } : {}) })
  return ctx
}

describe('core-store-fs conformance', () => {
  for (const check of storeConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = await freshStore()
      await check.run({ store: ctx.store })
    })
  }
})

describe('core-store-fs specifics', () => {
  it('persists across a restart', async () => {
    const dir = await mkdtemp(join(root, 'persist-'))

    const boot = async () => {
      const ctx = new Context()
      await ctx.plugin(PathsNode, { root: dir })
      await ctx.plugin(FsNode)
      const fiber = await ctx.plugin(StoreFs, { flushDelayMs: 0 })
      return { ctx, fiber }
    }

    const first = await boot()
    await first.ctx.store.set('volume', 0.8)
    await first.fiber.dispose()

    const second = await boot()
    expect(await second.ctx.store.get('volume')).toBe(0.8)
  })

  it('writes atomically, leaving no temp file behind', async () => {
    const ctx = await freshStore()
    await ctx.store.set('a', 1)

    const data = await ctx.fs.dir('data')
    const names = (await ctx.fs.list(data!)).map((s) => s.name)
    expect(names).toContain('store.json')
    // A crash mid-write must leave the previous store intact, not a truncated
    // one — hence temp-then-rename. The temp file must not survive.
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('quarantines a corrupt store instead of failing to boot', async () => {
    const dir = await mkdtemp(join(root, 'corrupt-'))
    const setup = new Context()
    await setup.plugin(PathsNode, { root: dir })
    await setup.plugin(FsNode)
    const dataDir = await setup.fs.dir('data')
    await setup.fs.writeFile(setup.fs.join(dataDir!, 'store.json'), '{ this is not json')

    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: dir })
    await ctx.plugin(FsNode)
    await ctx.plugin(StoreFs, { flushDelayMs: 0 })

    // Settings are recoverable; an unbootable app is not.
    expect(await ctx.store.get('anything')).toBeUndefined()
    await ctx.store.set('fresh', true)
    expect(await ctx.store.get('fresh')).toBe(true)

    const names = (await ctx.fs.list(dataDir!)).map((s) => s.name)
    expect(names.some((n) => n.includes('.corrupt-')), 'bad file kept for diagnosis').toBe(true)
  })

  it('flushes batched writes on dispose', async () => {
    const dir = await mkdtemp(join(root, 'flush-'))
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: dir })
    await ctx.plugin(FsNode)
    // A real batch window: the write must survive shutdown anyway.
    const fiber = await ctx.plugin(StoreFs, { flushDelayMs: 10_000 })
    await ctx.store.set('late', 'value')
    await fiber.dispose()

    const ctx2 = new Context()
    await ctx2.plugin(PathsNode, { root: dir })
    await ctx2.plugin(FsNode)
    await ctx2.plugin(StoreFs, { flushDelayMs: 0 })
    expect(await ctx2.store.get('late')).toBe('value')
  })

  it('keeps namespaces isolated on disk as well as in memory', async () => {
    const ctx = await freshStore()
    await ctx.store.namespace('plugin-a').set('key', 'a')
    await ctx.store.namespace('plugin-b').set('key', 'b')

    const data = await ctx.fs.dir('data')
    const raw = JSON.parse(
      await ctx.fs.readFile(ctx.fs.join(data!, 'store.json')),
    ) as Record<string, unknown>

    expect(raw['plugin-a:key']).toBe('a')
    expect(raw['plugin-b:key']).toBe('b')
  })
})

describe('core-store-fs under the capability gate', () => {
  it('writes store.json as itself, not as the plugin that called set()', async () => {
    const ctx = await freshStore()
    // `plugin-sources` is granted nothing that touches the filesystem, yet its
    // settings must still persist: `store.json` belongs to the store, not to
    // whichever plugin happens to be calling (docs/03 §4, "The one exception").
    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-sources',
      requested: ['db:read:core', 'db:write:core'],
    })
    await scoped.store.set('pageSize', 50)

    const data = await ctx.fs.dir('data')
    const raw = JSON.parse(
      await ctx.fs.readFile(ctx.fs.join(data!, 'store.json')),
    ) as Record<string, unknown>
    expect(raw['@bbebee/plugin-sources:pageSize']).toBe(50)
  })

  it('carries legacy @BBeBee/ namespaced keys over to @bbebee/', async () => {
    const dir = await mkdtemp(join(root, 'migrate-'))

    const boot = async () => {
      const ctx = new Context()
      await ctx.plugin(PathsNode, { root: dir })
      await ctx.plugin(FsNode)
      const fiber = await ctx.plugin(StoreFs, { flushDelayMs: 0 })
      return { ctx, fiber }
    }

    const first = await boot()
    const legacySettings = scopeContext(first.ctx, { pluginId: '@BBeBee/plugin-settings', requested: [] })
    await legacySettings.store.set('theme', 'dark')
    const legacyManager = scopeContext(first.ctx, { pluginId: '@BBeBee/plugin-manager', requested: [] })
    await legacyManager.store.set('enabled', { '@BBeBee/plugin-player': false })
    await legacyManager.store.set('service-providers', { visualizer: '@BBeBee/plugin-visualizer' })
    await first.fiber.dispose()

    const second = await boot()
    const settings = scopeContext(second.ctx, { pluginId: '@bbebee/plugin-settings', requested: [] })
    expect(await settings.store.get('theme')).toBe('dark')
    const manager = scopeContext(second.ctx, { pluginId: '@bbebee/plugin-manager', requested: [] })
    expect(await manager.store.get('enabled')).toEqual({ '@bbebee/plugin-player': false })
    expect(await manager.store.get('service-providers')).toEqual({
      visualizer: '@bbebee/plugin-visualizer',
    })
    // Copy, not move: the legacy scope still reads its own keys.
    const legacyAgain = scopeContext(second.ctx, { pluginId: '@BBeBee/plugin-settings', requested: [] })
    expect(await legacyAgain.store.get('theme')).toBe('dark')
  })
})
