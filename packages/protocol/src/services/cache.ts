/**
 * `ctx.cache` — the media cache plugin's surface.
 *
 * Two kinds of bytes go through here, and neither is a download: **artwork**
 * (a cover is fetched once, then every `<Artwork>` reads a local file — which
 * is also what lets `ctx.mediaSession` receive a local `Uri` on mobile) and
 * **remote audio streams** (a track plays from the network once, is written
 * beside the cache while it plays, and every later play opens the file).
 *
 * The distinction from `ctx.downloads` matters: a download is a file the user
 * asked to keep; a cache entry is evictable, is never shown as "Downloaded",
 * and an app with `plugin-cache` disabled simply streams. The player learns
 * nothing either way — the substitution happens on the
 * `player/before-resolve` waterfall, answered with `kind: 'local'`.
 *
 * Entries are tracked in `cache_entries` (docs/07 §4.11) and evicted LRU
 * within a class, because evicting artwork costs a re-fetch and a flicker
 * while evicting a stream costs the user a re-download.
 *
 * See docs/05 §2.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Uri } from '../common.js'
import type { ArtworkRef } from '../entities/catalog.js'

/**
 * The eviction classes, each with its own byte budget.
 *
 * `http` and `codec` are reserved: the schema names them and a settings
 * screen may clear them, but nothing writes them yet.
 */
export type CacheClass = 'artwork' | 'http' | 'stream' | 'codec'

/** One `cache_entries` row, as the settings surface sees it. */
export interface CacheEntry {
  key: string
  className: CacheClass
  uri: Uri
  sizeBytes: number
  lastAccessAt: number
  createdAt: number
  expiresAt?: number
}

export interface CacheStats {
  entries: number
  bytes: number
}

export interface CacheService {
  /**
   * The local file for a piece of artwork, fetching and caching it when the
   * cache does not hold it yet.
   *
   * Resolves to `undefined` when there is nothing to serve — no `sourceUrl`
   * and no local copy, a refused or non-image response, or writing disabled —
   * and the caller renders its `dominantColor`/identicon fallback. A hit
   * touches `last_access_at`, which is the clock eviction reads.
   *
   * When the catalogue already knows a `local_uri` (the scanner's embedded
   * covers), that file is returned without touching the network.
   */
  artwork(ref: ArtworkRef, size?: number, priority?: 0 | 1 | 2): Promise<Uri | undefined>

  /** Entries and bytes currently held, for one class or all of them. */
  stats(className?: CacheClass): Promise<CacheStats>

  /** Delete cached files, all classes or one. Returns how many were dropped. */
  clear(className?: CacheClass): Promise<number>
}

declare module 'cordis' {
  interface Context {
    cache: CacheService
  }
}
