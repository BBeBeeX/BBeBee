/**
 * Conformance suite for the `ctx.fs` capability gate.
 *
 * Separate from `fsConformance` because it needs a *gated* filesystem — one
 * derived through `scopeContext` with a specific grant — where the main suite
 * runs ungated. These are the checks that keep `fs:read:own` meaning "my own
 * data" rather than "the whole application directory".
 */

import type { FsService, PathsService, Uri } from '../index.js'
import { assert, assertRejects, type ConformanceSuite } from './harness.js'

export interface FsScopeSubject {
  /** Ungated, for arranging fixtures. */
  admin: FsService
  paths: PathsService
  /** The scope id the gated services below were scoped to. */
  scopeId: string
  /** `fs` as seen by a plugin granted exactly `fs:read:own` + `fs:write:own`. */
  own: FsService
  /** `fs` as seen by a plugin granted exactly `fs:read:cache` + `fs:write:cache`. */
  cacheOnly: FsService
  /** Build an `fs` for an arbitrary grant set, for exhaustiveness checks. */
  grantedWith(capabilities: string[]): FsService
}

const denied = /capability|may not/i

export const fsScopeConformance: ConformanceSuite<FsScopeSubject> = {
  service: 'fs (capability scopes)',
  checks: [
    {
      name: 'a plugin can reach its own data directory',
      because: 'fs:*:own would be useless otherwise',
      async run({ own, paths, scopeId }) {
        const dir = paths.pluginData(scopeId)
        await own.mkdir(dir, { recursive: true })
        const file = own.join(dir, 'mine.txt')
        await own.writeFile(file, 'ok')
        assert((await own.readFile(file)) === 'ok', 'own directory must be readable')
      },
    },
    {
      name: 'fs:read:own does NOT reach another plugin data directory',
      because: 'every plugin data directory lives under appData; own must mean *own*',
      async run({ admin, own, paths }) {
        const victim = paths.pluginData('@bbebee/plugin-victim')
        await admin.mkdir(victim, { recursive: true })
        const secret = admin.join(victim, 'secret.txt')
        await admin.writeFile(secret, 'TOP SECRET')

        await assertRejects(
          () => own.readFile(secret),
          'cross-plugin read must be denied',
          denied,
        )
      },
    },
    {
      name: 'fs:write:own does NOT overwrite another plugin files',
      because: 'read access is not the only way to do damage',
      async run({ admin, own, paths }) {
        const victim = paths.pluginData('@bbebee/plugin-victim2')
        await admin.mkdir(victim, { recursive: true })
        const target = admin.join(victim, 'data.txt')
        await admin.writeFile(target, 'original')

        await assertRejects(
          () => own.writeFile(target, 'clobbered'),
          'cross-plugin write must be denied',
          denied,
        )
        assert((await admin.readFile(target)) === 'original', 'victim file was modified')
      },
    },
    {
      name: 'fs:read:own does NOT reach the shared settings store',
      because: 'store.json holds every plugin settings, including other plugins',
      async run({ admin, own, paths }) {
        const store = admin.join(paths.appData, 'store.json')
        await admin.writeFile(store, '{"other-plugin:token":"secret"}')
        await assertRejects(() => own.readFile(store), 'store read must be denied', denied)
      },
    },
    {
      name: 'a sibling directory sharing a name prefix is not inside the root',
      because: 'startsWith() says …/BBeBee-backup is inside …/BBeBee, and it is not',
      async run({ admin, own, paths }) {
        // e.g. an unrelated backup directory next to the app's own.
        const sibling: Uri = `${paths.appData}-backup`
        await admin.mkdir(sibling, { recursive: true })
        const outside = admin.join(sibling, 'outside.txt')
        await admin.writeFile(outside, 'OUTSIDE')

        await assertRejects(
          () => own.readFile(outside),
          'sibling root must be outside every scope',
          denied,
        )
      },
    },
    {
      name: 'temp counts as cache, not as an ungrantable scope',
      because: 'downloads land in temp and are moved into place; docs/04 §1 says so',
      async run({ cacheOnly, paths }) {
        const file = cacheOnly.join(paths.temp, 'staging.part')
        await cacheOnly.mkdir(paths.temp, { recursive: true })
        // Must NOT throw: a plugin granted cache access can stage a download.
        await cacheOnly.writeFile(file, 'partial')
        assert((await cacheOnly.readFile(file)) === 'partial', 'temp must be writable under cache')
      },
    },
    {
      name: 'every well-known directory is reachable by some specific grant',
      because:
        'a directory that classifies as `all` can only be used by a plugin granted everything',
      async run({ admin, grantedWith }) {
        // The gap this catches: `WellKnownDir` and `FsScope` are separate
        // lists, and nothing tied them together. `logs` sits inside appData
        // but is nobody's `own`, so after `own` was narrowed to per-plugin the
        // log transport could not write its own file — and the only fix that
        // would have worked was `fs:write:all`.
        const scopes = ['own', 'media', 'cache', 'downloads', 'logs'] as const
        const unreachable: string[] = []

        // `data` is deliberately absent: the appData *root* holds `store.json`
        // and every plugin's directory, so no plugin should reach it. `own`
        // grants a subdirectory of it, which is the point.
        for (const kind of ['cache', 'temp', 'downloads', 'logs', 'music'] as const) {
          const dir = await admin.dir(kind)
          if (!dir) continue // Legitimately absent on this platform (iOS music).
          const probe = admin.join(dir, '.scope-probe')

          // `exists` is async, so a gate denial arrives as a *rejection*, not a
          // synchronous throw — each probe has to be awaited or the check
          // silently passes everything (and leaks unhandled rejections).
          let reachable = false
          for (const scope of scopes) {
            const fs = grantedWith([`fs:read:${scope}`, `fs:write:${scope}`])
            try {
              await fs.exists(probe)
              reachable = true
              break
            } catch {
              // Denied for this scope; try the next.
            }
          }
          if (!reachable) unreachable.push(kind)
        }

        assert(
          unreachable.length === 0,
          `these well-known directories need "fs:*:all" to touch, which means no ` +
            `least-privilege grant can use them: ${unreachable.join(', ')}`,
        )
      },
    },
    {
      name: 'a cache-only grant cannot reach app data',
      because: 'scopes are not a hierarchy; cache does not imply own',
      async run({ cacheOnly, paths }) {
        await assertRejects(
          () => cacheOnly.readFile(cacheOnly.join(paths.appData, 'store.json')),
          'cache grant must not reach appData',
          denied,
        )
      },
    },
  ],
}
