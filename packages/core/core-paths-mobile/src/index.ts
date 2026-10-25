/**
 * `ctx.paths` for iOS and Android.
 *
 * Expo gives two real roots — `document` (backed up, survives updates) and
 * `cache` (the OS may reclaim it) — and everything else is carved out of
 * those. See docs/04-core-services.md §10.
 */

import { Paths } from 'expo-file-system'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import { pluginDirName } from '@BBeBee/protocol'
import type { PathsService, Uri, WellKnownDir } from '@BBeBee/protocol'

const trim = (uri: string): Uri => uri.replace(/\/$/, '')

export class PathsExpo extends Service implements PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  /**
   * Always undefined.
   *
   * ⚠️ Neither iOS nor Android exposes a shared music folder an app may read
   * without user action. Callers must fall back to `ctx.fs.pickDirectory()`,
   * which is why `PathsService.music` is optional at all — reporting a
   * plausible-looking path here would just produce failures further away
   * from the cause. See docs/04-core-services.md §1.
   */
  readonly music: Uri | undefined = undefined

  private readonly dataUri: string

  constructor(ctx: Context) {
    super(ctx, 'paths')

    const document = trim(Paths.document.uri)
    const cache = trim(Paths.cache.uri)

    this.dataUri = document
    this.appData = document
    this.cache = cache
    // No OS temp directory is exposed, so scratch space lives under cache —
    // correct semantics anyway, since the OS may reclaim both.
    this.temp = `${cache}/tmp`
    this.logs = `${document}/logs`
    // Sandboxed: "downloads" is app-private, not the shared Downloads folder.
    this.downloads = `${document}/downloads`
  }

  pluginData(pluginId: string): Uri {
    // Shared with core-paths-desktop so both platforms agree; see that file.
    return `${this.dataUri}/plugins/${pluginDirName(pluginId)}`
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

export default PathsExpo
