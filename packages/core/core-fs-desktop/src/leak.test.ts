/**
 * The unload-is-total claim, applied to every core service.
 *
 * docs/09 §6 calls for this test to be run over every plugin in the workspace.
 * This is that, for the services that exist so far: load each, dispose it, and
 * assert the context is byte-for-byte where it started — no listeners, no
 * services, no effects, no timers.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { StoreFs } from '@bbebee/core-store-fs'
import { DbNode } from '@BBeBee/core-db-desktop'
import logBuffer from '@bbebee/plugin-log-buffer'
import logConsole from '@bbebee/plugin-log-console'
import logFile from '@bbebee/plugin-log-file'
import { FsNode } from '../src/index.js'

let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-leak')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A context with the prerequisites a service under test needs. */
async function baseContext(deps: 'none' | 'paths' | 'fs') {
  const dir = await mkdtemp(join(root, 'ctx-'))
  const ctx = new Context()
  if (deps !== 'none') await ctx.plugin(PathsNode, { root: dir })
  if (deps === 'fs') await ctx.plugin(FsNode)
  return ctx
}

interface Case {
  name: string
  deps: 'none' | 'paths' | 'fs'
  load: (ctx: Context) => PromiseLike<{ dispose: () => Promise<void> }>
}

const cases: Case[] = [
  {
    name: 'core-paths-desktop',
    deps: 'none',
    load: (ctx) => ctx.plugin(PathsNode, { root }),
  },
  { name: 'core-fs-desktop', deps: 'paths', load: (ctx) => ctx.plugin(FsNode) },
  {
    name: 'core-store-fs',
    deps: 'fs',
    load: (ctx) => ctx.plugin(StoreFs, { flushDelayMs: 0 }),
  },
  {
    name: 'core-db-desktop',
    deps: 'fs',
    load: (ctx) => ctx.plugin(DbNode, { fileName: ':memory:', skipCoreMigrations: true }),
  },
  { name: 'plugin-log-console', deps: 'none', load: (ctx) => ctx.plugin(logConsole, {}) },
  { name: 'plugin-log-buffer', deps: 'none', load: (ctx) => ctx.plugin(logBuffer, {}) },
  {
    name: 'plugin-log-file',
    deps: 'fs',
    // A live batch window, so a leaked timer would be caught.
    load: (ctx) => ctx.plugin(logFile, { flushDelayMs: 5000 }),
  },
]

describe('unload is total', () => {
  for (const testCase of cases) {
    it(`${testCase.name} leaves nothing behind`, async () => {
      const ctx = await baseContext(testCase.deps)
      await tick()

      const before = snapshotContext(ctx)
      const fiber = await testCase.load(ctx)
      await tick()
      await fiber.dispose()
      await tick()

      const problems = diffSnapshots(before, snapshotContext(ctx))
      expect(problems, problems?.join('; ')).toBeUndefined()
    })
  }

  it('a full stack unwinds cleanly in reverse', async () => {
    // The realistic case: the whole M0 bootstrap, torn down at once.
    const dir = await mkdtemp(join(root, 'stack-'))
    const ctx = new Context()
    const before = snapshotContext(ctx)

    const fibers = [
      await ctx.plugin(PathsNode, { root: dir }),
      await ctx.plugin(FsNode),
      await ctx.plugin(StoreFs, { flushDelayMs: 0 }),
      await ctx.plugin(DbNode, { fileName: ':memory:' }),
      await ctx.plugin(logBuffer, {}),
      await ctx.plugin(logFile, { flushDelayMs: 5000 }),
    ]
    await tick()

    // Prove it actually worked before tearing it down.
    await ctx.store.set('k', 'v')
    expect(await ctx.store.get('k')).toBe('v')
    expect(await ctx.db.query('SELECT 1 AS n')).toEqual([{ n: 1 }])

    for (const fiber of fibers.reverse()) await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
    // Every service key is gone.
    expect(ctx.fs).toBeUndefined()
    expect(ctx.db).toBeUndefined()
    expect(ctx.store).toBeUndefined()
  })
})
