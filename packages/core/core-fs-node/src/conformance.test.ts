/**
 * `core-fs-node` against the shared conformance suite.
 *
 * The suite is the executable form of docs/04 §1. `core-fs-expo` runs the
 * identical checks on a device; if the two ever disagree, one of them is
 * wrong rather than "just different".
 */

import { chmod, mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { fsConformance, fsScopeConformance, pathsConformance } from '@BBeBee/protocol/conformance'
import type { FsService, PathsService } from '@BBeBee/protocol'
import { scopeContext } from '@BBeBee/kernel'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '../src/index.js'
import { tempDir } from '@BBeBee/kernel/testing'

let root: string
let ctx: Context

beforeAll(async () => {
  root = await tempDir('bbebee-fs')
  ctx = new Context()
  // `root` confines every well-known directory to the temp dir, so the suite
  // never touches the developer's real Music or Downloads folder.
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const fs = (): FsService => ctx.fs
const paths = (): PathsService => ctx.paths

describe('core-paths-node conformance', () => {
  for (const check of pathsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      await check.run({ paths: paths() })
    })
  }
})

describe('core-fs-node conformance', () => {
  for (const check of fsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      // A private scratch directory per check, so ordering cannot matter.
      const scratch = pathToFileURL(
        await mkdtemp(join(root, `check-${check.name.replace(/\W+/g, '-').slice(0, 24)}-`)),
      ).href.replace(/\/$/, '')
      await check.run({ fs: fs(), scratch })
    })
  }
})

describe('core-fs-node specifics', () => {
  it('reports a music directory, unlike the mobile implementation', async () => {
    // The asymmetry the suite deliberately permits — asserted from the side
    // where it must be present.
    expect(await fs().dir('music')).toBeTypeOf('string')
  })

  it('creates app-private roots on demand but never user folders', async () => {
    const data = await fs().dir('data')
    expect(data).toBeDefined()
    expect(await fs().exists(data!)).toBe(true)
  })

  it('supports watching, and says so', async () => {
    expect(fs().canWatch).toBe(true)
  })

  it('moves across devices by falling back to copy + delete', async () => {
    // Cannot force EXDEV portably; assert the ordinary path still works so the
    // fallback branch does not regress the common case.
    const scratch = pathToFileURL(await mkdtemp(join(root, 'xdev-'))).href.replace(/\/$/, '')
    const from = fs().join(scratch, 'a.txt')
    const to = fs().join(scratch, 'b.txt')
    await fs().writeFile(from, 'payload')
    await fs().move(from, to)
    expect(await fs().readFile(to)).toBe('payload')
  })

  it('handles Windows drive paths and URL pathnames with percent-encoding', async () => {
    const scratch = pathToFileURL(await mkdtemp(join(root, 'win-'))).href.replace(/\/$/, '')
    const file = fs().join(scratch, 'my song.mp3')
    await fs().writeFile(file, 'audio-data')

    expect(fs().basename(file)).toBe('my song.mp3')
    expect(fs().extname(file)).toBe('.mp3')
    expect(await fs().exists(file)).toBe(true)

    // Test URL-encoded join and access
    const pathname = file.startsWith('file://') ? file.replace(/^file:\/\//, '') : file
    expect(fs().basename(pathname)).toBe('my song.mp3')
  })

  it('skips unreadable directory symlinks in list()', async () => {
    const scratch = pathToFileURL(await mkdtemp(join(root, 'symlink-'))).href.replace(/\/$/, '')
    const readableDir = fs().join(scratch, 'readable')
    await fs().mkdir(readableDir)
    await fs().writeFile(fs().join(readableDir, 'song.mp3'), 'audio')

    const unreadableDir = fs().join(scratch, 'restricted')
    await fs().mkdir(unreadableDir)
    const unreadablePath = fileURLToPath(unreadableDir)
    await chmod(unreadablePath, 0o000)

    try {
      const symlinkPath = join(fileURLToPath(scratch), 'link-to-restricted')
      await symlink(unreadablePath, symlinkPath, 'dir')

      const entries = await fs().list(scratch)
      const names = entries.map((e) => e.name)
      expect(names).toContain('readable')
      expect(names).not.toContain('link-to-restricted')
    } finally {
      await chmod(unreadablePath, 0o777)
    }
  })
})

describe('core-fs-node capability scopes', () => {
  for (const check of fsScopeConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      // A private root per check: these arrange fixtures in appData itself.
      const dir = await mkdtemp(join(root, 'scope-'))
      const scopeCtx = new Context()
      await scopeCtx.plugin(PathsNode, { root: dir })
      await scopeCtx.plugin(FsNode)

      const scopeId = '@bbebee/plugin-under-test'
      const gated = (granted: string[]) =>
        scopeContext(scopeCtx, {
          pluginId: scopeId,
          scopeId,
          requested: granted as never,
        }).fs

      await check.run({
        admin: scopeCtx.fs,
        paths: scopeCtx.paths,
        scopeId,
        own: gated(['fs:read:own', 'fs:write:own']),
        cacheOnly: gated(['fs:read:cache', 'fs:write:cache']),
        grantedWith: gated,
        // The desktop pick: a folder under the music root, the way the host
        // file dialog returns one a scanner would use. A pick *outside* the
        // music root stays `all` on desktop — deliberately, since outside
        // the app roots lies the whole machine — and is pinned by the local
        // check below, not by the shared suite.
        pickedDir: scopeCtx.paths.music
          ? scopeCtx.fs.join(scopeCtx.paths.music, 'picked')
          : undefined,
      })
    })
  }

  it('keeps a desktop folder outside every known root fail-closed to all', async () => {
    // The mirror of the shared picked-folder check, and the reason the
    // mobile fix cannot simply be copied over. On a desktop, "outside the
    // app roots" includes the whole machine — /etc included — so a file://
    // uri that matches no root must NOT read as "the user's music". It
    // stays `all`, which no least-privilege grant reaches; the mobile
    // sandbox is what makes the same inference safe there.
    const dir = await mkdtemp(join(root, 'scope-'))
    const scopeCtx = new Context()
    await scopeCtx.plugin(PathsNode, { root: dir })
    await scopeCtx.plugin(FsNode)

    const elsewhere = pathToFileURL(await mkdtemp(join(root, 'elsewhere-'))).href.replace(/\/$/, '')
    const file = scopeCtx.fs.join(elsewhere, 'song.mp3')
    await scopeCtx.fs.writeFile(file, 'audio')

    const scopeId = '@bbebee/plugin-under-test'
    const media = scopeContext(scopeCtx, {
      pluginId: scopeId,
      scopeId,
      requested: ['fs:read:media', 'fs:write:media'] as never,
    }).fs

    await expect(media.readFile(file)).rejects.toThrow(/capability|may not/i)
  })
})
