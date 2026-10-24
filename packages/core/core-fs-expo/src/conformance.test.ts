/**
 * `core-fs-expo` against the shared conformance suite.
 *
 * ⚠️ **Why this file exists.** `core-fs-node`'s twin says the Expo
 * implementation "runs the identical checks on a device; if the two ever
 * disagree, one of them is wrong rather than just different". It did disagree,
 * and nothing said so: Expo's `File.move` refuses an existing destination
 * where `rename(2)` replaces it, so `ctx.store`'s write-temp-then-move stopped
 * persisting from a device's second launch onward while CI stayed green.
 *
 * `expo-file-system` is aliased to `node:fs` behind the SDK 54+ surface
 * (`test/stubs/expo-file-system.ts`), and the stub reproduces that refusal
 * rather than papering over it — so this file fails if the adapter stops
 * clearing the destination. What stays on the device is what is genuinely of
 * the device: SAF `content://` trees, the directory picker, and the platform's
 * own permission model.
 */

import { rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { fsConformance, fsScopeConformance, pathsConformance } from '@BBeBee/protocol/conformance'
import type { FsService, PathsService } from '@BBeBee/protocol'
import { scopeContext } from '@BBeBee/kernel'
import { PathsExpo } from '@BBeBee/core-paths-expo'
import { tempDir } from '@BBeBee/kernel/testing'
import { FsExpo } from './index.js'

let root: string
let ctx: Context

beforeAll(async () => {
  root = await tempDir('bbebee-fs-expo')
  // The sandbox `Paths.document` / `Paths.cache` resolve to, confined to a
  // temp dir so the suite never touches anything real. An env var rather than
  // an import: `tsc` resolves `expo-file-system` to the real package, so a
  // stub-only export would not typecheck (see the stub's own note).
  process.env['BBEBEE_EXPO_FS_ROOT'] = root
  ctx = new Context()
  await ctx.plugin(PathsExpo)
  await ctx.plugin(FsExpo)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const fs = (): FsService => ctx.fs
const paths = (): PathsService => ctx.paths

describe('core-paths-expo conformance', () => {
  for (const check of pathsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      await check.run({ paths: paths() })
    })
  }
})

describe('core-fs-expo conformance', () => {
  for (const check of fsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const scratch = pathToFileURL(
        await mkdtemp(join(root, `check-${check.name.replace(/\W+/g, '-').slice(0, 24)}-`)),
      ).href.replace(/\/$/, '')
      await check.run({ fs: fs(), scratch })
    })
  }
})

describe('core-fs-expo specifics', () => {
  it('reports no music directory, unlike the desktop implementation', async () => {
    // The asymmetry the suite deliberately permits — asserted from the side
    // where it must be absent. Neither OS exposes a readable shared music
    // folder, so callers fall back to `pickDirectory()`.
    expect(await fs().dir('music')).toBeUndefined()
  })

  it('does not claim to watch, so the scanner polls', async () => {
    expect(fs().canWatch).toBe(false)
  })

  it('replaces an existing file on move, the way rename does', async () => {
    /*
     * The regression, named. Expo's own `move` throws "Destination already
     * exists"; this adapter clears the destination first so both platforms
     * behave like `rename(2)`. Without it, every atomic write in the codebase
     * fails on its second run — which is what took `ctx.store` down on device.
     */
    const scratch = pathToFileURL(await mkdtemp(join(root, 'replace-'))).href.replace(/\/$/, '')
    const from = fs().join(scratch, 'new.txt')
    const to = fs().join(scratch, 'live.txt')
    await fs().writeFile(to, 'stale')
    await fs().writeFile(from, 'fresh')

    await fs().move(from, to)

    expect(await fs().readFile(to)).toBe('fresh')
    expect(await fs().exists(from)).toBe(false)
  })
})

describe('core-fs-expo capability scopes', () => {
  for (const check of fsScopeConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const dir = await mkdtemp(join(root, 'scope-'))
      process.env['BBEBEE_EXPO_FS_ROOT'] = dir
      const scopeCtx = new Context()
      await scopeCtx.plugin(PathsExpo)
      await scopeCtx.plugin(FsExpo)

      const scopeId = '@bbebee/plugin-under-test'
      const gated = (granted: string[]) =>
        scopeContext(scopeCtx, {
          pluginId: scopeId,
          scopeId,
          requested: granted as never,
        }).fs

      try {
        await check.run({
          admin: scopeCtx.fs,
          paths: scopeCtx.paths,
          scopeId,
          own: gated(['fs:read:own', 'fs:write:own']),
          cacheOnly: gated(['fs:read:cache', 'fs:write:cache']),
          grantedWith: gated,
        })
      } finally {
        // Other suites in this file resolve against the shared root.
        process.env['BBEBEE_EXPO_FS_ROOT'] = root
      }
    })
  }
})
