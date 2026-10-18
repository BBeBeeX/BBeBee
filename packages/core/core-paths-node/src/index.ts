/**
 * `ctx.paths` for Node and Desktop.
 *
 * Trivial as a service, but having it separate is what lets `ctx.fs` stay
 * path-agnostic: plugins ask for a well-known directory and join onto it,
 * and never learn what a path looks like on the host.
 *
 * On desktop this is fed by the native host through the `resolve` option, so
 * the renderer gets the OS's real answers rather than these fallbacks.
 * See docs/04-core-services.md §10.
 */

import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import { pluginDirName } from '@BBeBee/protocol'
import type { PathsService, Uri, WellKnownDir } from '@BBeBee/protocol'

export interface PathsNodeConfig {
  /** Used to build per-app directories. */
  appName?: string
  /**
   * The host OS path resolver. When present its answers win, so the renderer
   * agrees with the OS rather than with our XDG guesswork.
   */
  resolve?: (kind: 'userData' | 'cache' | 'temp' | 'logs' | 'music' | 'downloads') => string | undefined
  /** Force every directory under one root. Used by tests. */
  root?: string
}

/** Where an app's private data goes, per platform convention. */
function defaultDataRoot(appName: string): string {
  return resolveSystemPath('userData', appName)
}

function defaultCacheRoot(appName: string): string {
  return resolveSystemPath('cache', appName)
}

/**
 * Resolve a well-known directory to a native path, per platform convention.
 *
 * The Node-side authority for "where does the OS put X". The desktop sidecar
 * and any other Node host use this at bootstrap instead of reimplementing
 * the platform switch.
 */
export function resolveSystemPath(kind: string, appName = 'BBeBee'): string {
  const home = homedir()
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  switch (kind) {
    case 'userData':
    case 'appData':
      if (process.env['BBEBEE_DATA_DIR']) return process.env['BBEBEE_DATA_DIR']
      if (isMac) return join(home, 'Library', 'Application Support', appName)
      if (isWin) return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), appName)
      return join(process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), appName)

    case 'cache':
      if (isMac) return join(home, 'Library', 'Caches', appName)
      if (isWin) return join(process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), appName, 'Cache')
      return join(process.env['XDG_CACHE_HOME'] ?? join(home, '.cache'), appName)

    case 'temp':
      return tmpdir()

    case 'logs':
      return join(resolveSystemPath('userData', appName), 'logs')

    case 'downloads':
      return join(home, 'Downloads')

    case 'music':
      return join(home, 'Music')

    case 'desktop':
      return join(home, 'Desktop')

    case 'documents':
      return join(home, 'Documents')

    case 'home':
      return home

    default:
      return join(home, appName)
  }
}

const toUri = (path: string): Uri => pathToFileURL(path).href.replace(/\/$/, '')

export class PathsNode extends Service implements PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  readonly music?: Uri

  private readonly dataPath: string

  constructor(ctx: Context, config: PathsNodeConfig = {}) {
    super(ctx, 'paths')

    const appName = config.appName ?? 'BBeBee'
    const resolve = config.resolve ?? (() => undefined)

    const dataPath = config.root ?? resolve('userData') ?? defaultDataRoot(appName)
    const cachePath = config.root
      ? join(config.root, 'cache')
      : (resolve('cache') ?? defaultCacheRoot(appName))

    this.dataPath = dataPath
    this.appData = toUri(dataPath)
    this.cache = toUri(cachePath)
    this.temp = toUri(config.root ? join(config.root, 'tmp') : (resolve('temp') ?? tmpdir()))
    this.logs = toUri(resolve('logs') ?? join(dataPath, 'logs'))
    this.downloads = toUri(
      config.root
        ? join(config.root, 'downloads')
        : (resolve('downloads') ?? join(homedir(), 'Downloads')),
    )

    // Unlike iOS, desktop always has a music folder — but respect the host OS
    // answer when it has one, since the user may have relocated it.
    const musicPath = config.root
      ? join(config.root, 'music')
      : (resolve('music') ?? join(homedir(), 'Music'))
    this.music = toUri(musicPath)
  }

  pluginData(pluginId: string): Uri {
    // `pluginDirName` sanitises AND disambiguates: sanitising alone maps
    // `plugin/x` and `plugin_x` to the same directory, which would put each
    // plugin inside the other's `fs:*:own` scope.
    return toUri(join(this.dataPath, 'plugins', pluginDirName(pluginId)))
  }

  get(kind: WellKnownDir): Uri | undefined {
    switch (kind) {
      case 'data':
        return this.appData
      case 'cache':
        return this.cache
      case 'temp':
        return this.temp
      case 'logs':
        return this.logs
      case 'downloads':
        return this.downloads
      case 'music':
        return this.music
      default:
        return undefined
    }
  }
}

export default PathsNode
