/**
 * Conformance suite for `ctx.paths`.
 *
 * Small, but it pins the one thing that differs meaningfully between the
 * platforms: whether a shared music folder exists at all.
 */

import type { PathsService } from '../index.js'
import { assert, assertEqual, type ConformanceSuite } from './harness.js'

export interface PathsSubject {
  paths: PathsService
}

const REQUIRED = ['appData', 'cache', 'temp', 'logs', 'downloads'] as const

export const pathsConformance: ConformanceSuite<PathsSubject> = {
  service: 'paths',
  checks: [
    {
      name: 'provides every required directory as a uri',
      because: 'ctx.fs joins onto these; a missing one is a boot failure',
      async run({ paths }) {
        for (const key of REQUIRED) {
          const value = paths[key]
          assert(typeof value === 'string' && value.length > 0, `${key} must be a non-empty uri`)
          assert(!value.endsWith('/'), `${key} must not have a trailing slash`)
        }
      },
    },
    {
      name: 'get() agrees with the named properties',
      because: 'two ways to reach the same value must not diverge',
      async run({ paths }) {
        assertEqual(paths.get('data'), paths.appData, 'data')
        assertEqual(paths.get('cache'), paths.cache, 'cache')
        assertEqual(paths.get('temp'), paths.temp, 'temp')
        assertEqual(paths.get('logs'), paths.logs, 'logs')
        assertEqual(paths.get('downloads'), paths.downloads, 'downloads')
        assertEqual(paths.get('music'), paths.music, 'music')
      },
    },
    {
      name: 'music is either a uri or explicitly undefined',
      because: 'iOS has no shared music folder; a plausible-looking lie is worse',
      async run({ paths }) {
        const music = paths.music
        assert(
          music === undefined || (typeof music === 'string' && music.length > 0),
          'music must be a uri or undefined, never empty string',
        )
        assertEqual(paths.get('music'), music, 'get() agrees')
      },
    },
    {
      name: 'pluginData is stable, distinct, and path-safe',
      because: 'package ids contain @ and /, neither of which belongs in a path',
      async run({ paths }) {
        const a = paths.pluginData('@bbebee/plugin-source-subsonic')
        const b = paths.pluginData('@bbebee/plugin-source-jellyfin')

        assertEqual(a, paths.pluginData('@bbebee/plugin-source-subsonic'), 'stable across calls')
        assert(a !== b, 'different plugins must get different directories')
        const tail = a.slice(paths.appData.length)
        assert(!tail.includes('@'), 'must not leak @ into the path')
        assert(
          tail.split('/').filter(Boolean).length === 2,
          `expected <root>/plugins/<id>, got ${tail}`,
        )
      },
    },
    {
      name: 'directories are distinct from one another',
      because: 'clearing the cache must not delete the database',
      async run({ paths }) {
        assert(paths.appData !== paths.cache, 'data and cache must differ')
        assert(paths.logs !== paths.cache, 'logs and cache must differ')
      },
    },
  ],
}
