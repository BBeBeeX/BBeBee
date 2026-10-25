/**
 * The unload-is-total claim, applied to the mobile core stack.
 *
 * The twin of `core-fs-desktop`'s `leak.test.ts`, over the Expo
 * implementations (`PathsExpo`, `FsExpo`, `DbExpo`) plus the platform-neutral
 * pieces (`core-store-fs`, the Layer 3 log transports). The mobile file
 * system has one extra way to leak — the SAF cache and the picker
 * subscriptions — which makes the byte-for-byte teardown assertion matter
 * more here, not less.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import { PathsExpo } from '@bbebee/core-paths-mobile'
import { StoreFs } from '@bbebee/core-store-fs'
import { DbExpo } from '@bbebee/core-db-mobile'
import logBuffer from '@bbebee/plugin-log-buffer'
import logConsole from '@bbebee/plugin-log-console'
import logFile from '@bbebee/plugin-log-file'
import { FsExpo } from './index.js'

let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-fs-expo-leak')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A context whose sandbox root is a fresh temp dir, like the conformance suite. */
async function baseContext(deps: 'none' | 'paths' | 'fs') {
  const dir = await mkdtemp(join(root, 'ctx-'))
  process.env['BBEBEE_EXPO_FS_ROOT'] = dir
  const ctx = new Context()
  if (deps !== 'none') await ctx.plugin(PathsExpo)
  if (deps === 'fs') await ctx.plugin(FsExpo)
  return ctx
}

interface Case {
  name: string
  deps: 'none' | 'paths' | 'fs'
  load: (ctx: Context) => PromiseLike<{ dispose: () => Promise<void> }>
}

const cases: Case[] = [
  {
    name: 'core-paths-mobile',
    deps: 'none',
    load: (ctx) => ctx.plugin(PathsExpo),
  },
  { name: 'core-fs-mobile', deps: 'paths', load: (ctx) => ctx.plugin(FsExpo) },
  {
    name: 'core-store-fs',
    deps: 'fs',
    load: (ctx) => ctx.plugin(StoreFs, { flushDelayMs: 0 }),
  },
  {
    name: 'core-db-mobile',
    deps: 'fs',
    load: (ctx) =>
      ctx.plugin(DbExpo, { databaseName: ':memory:', skipCoreMigrations: true }),
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

describe('unload is total (mobile)', () => {
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
    // The realistic mobile bootstrap, torn down at once.
    const ctx = await baseContext('none')
    const before = snapshotContext(ctx)

    const fibers = [
      await ctx.plugin(PathsExpo),
      await ctx.plugin(FsExpo),
      await ctx.plugin(StoreFs, { flushDelayMs: 0 }),
      await ctx.plugin(DbExpo, { databaseName: ':memory:', skipCoreMigrations: true }),
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
