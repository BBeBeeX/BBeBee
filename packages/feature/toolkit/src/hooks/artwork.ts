/**
 * View hooks for `ctx.cache`.
 *
 * Covers are the one cache entry a user *sees*, so the resolution has to be a
 * hook rather than a fire-and-forget warm-up, and the contract is stricter
 * than "return the local URI when there is one": **the remote URL must not be
 * handed to an image element while the cache is fetching it.** Doing that is
 * a second request for the same bytes, and on a phone it is a broken image
 * when the network is the thing that failed.
 *
 * So the hook returns the ref to *render*: `sourceUrl` is the local file once
 * the cache has it, `undefined` while the fetch is in flight (the component
 * paints its `dominantColor`/identicon fallback), and the original remote URL
 * only when the cache is absent or has definitively failed.
 *
 * The hook lives in the shared toolkit (every view package may import it); the
 * cache feature's `./hooks` subpath re-exports it under
 * `@BBeBee/plugin-cache/hooks` for its own view packages and older consumers.
 *
 * See docs/08 §4.
 */

import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { ArtworkRef, CacheService, FsService, Uri } from '@BBeBee/protocol'
import { serviceOf } from './react.js'

/** An already-local location needs no caching; the platform can render it as-is. */
function isLocalUri(uri: string | undefined): boolean {
  return (
    uri === undefined ||
    /^(file|content|data|bbebee-file):/i.test(uri) ||
    /^[a-zA-Z]:[\\/]/.test(uri) ||
    uri.startsWith('/')
  )
}

interface Resolution {
  id: string
  uri?: Uri
  settled: boolean
}

/**
 * The artwork ref to render, with its cover resolved through `ctx.cache`.
 *
 * `undefined` means there is nothing to render and the caller's fallback
 * stands. A ref that is returned unchanged (same `sourceUrl`) is the status
 * quo: a local file, a remote URL with no cache loaded, or a cache that tried
 * and failed.
 */

/**
 * In-memory LRU cache of resolved artwork URIs, keyed by artwork ID.
 * Avoids re-running the async DB lookup when remounting (e.g., switching
 * pages back and forth) — the cover appears instantly instead of flashing
 * the fallback. Bounded to 1000 entries; evicts least-recently-used.
 */
const RESOLVED_CACHE_MAX = 1000
const resolvedUriCache = new Map<string, string | null>()

function cacheGet(id: string): string | null | undefined {
  const v = resolvedUriCache.get(id)
  if (v !== undefined) {
    // Move to end (most-recently-used)
    resolvedUriCache.delete(id)
    resolvedUriCache.set(id, v)
  }
  return v
}

function cacheSet(id: string, uri: string | null): void {
  // Delete first to refresh recency if key exists
  resolvedUriCache.delete(id)
  resolvedUriCache.set(id, uri)
  // Evict oldest if over capacity
  while (resolvedUriCache.size > RESOLVED_CACHE_MAX) {
    const oldest = resolvedUriCache.keys().next().value
    if (oldest === undefined) break
    resolvedUriCache.delete(oldest)
  }
}

/**
 * Clears the in-memory resolved-URI cache. Test-only: the module-level cache
 * otherwise leaks resolutions between tests that reuse artwork IDs.
 */
export function clearResolvedArtworkCache(): void {
  resolvedUriCache.clear()
}

export function useResolvedArtwork(
  ctx: Context,
  artwork?: ArtworkRef,
  priority: 0 | 1 | 2 = 1,
): ArtworkRef | undefined {
  const id = artwork?.id
  const sourceUrl = artwork?.sourceUrl
  const [resolution, setResolution] = useState<Resolution | undefined>(() => {
    if (!id) return undefined
    const cached = cacheGet(id)
    return cached !== undefined ? { id, ...(cached ? { uri: cached } : {}), settled: true } : undefined
  })

  useEffect(() => {
    if (!id) {
      setResolution(undefined)
      return
    }
    let active = true

    // Memory cache hit: return synchronously, no flicker on remount.
    const cached = cacheGet(id)
    if (cached !== undefined) {
      setResolution((prev) =>
        prev?.id === id && prev.settled && prev.uri === (cached || undefined)
          ? prev
          : { id, ...(cached ? { uri: cached } : {}), settled: true },
      )
      return
    }

    // Helper: set resolution and populate memory cache.
    const settle = (uri?: string) => {
      if (!active) return
      cacheSet(id, uri ?? null)
      setResolution({ id, ...(uri ? { uri } : {}), settled: true })
    }

    // A local URI is usually usable as-is (scanner-extracted cover), but the
    // file may have been deleted (e.g. cache cleared) while the ref still
    // points at it. Verify existence before trusting it; if gone, fall through
    // to the cache lookup which will re-fetch from the original source.
    const checkLocalThenResolve = async (): Promise<void> => {
      if (sourceUrl && isLocalUri(sourceUrl)) {
        const fs = serviceOf<FsService>(ctx, 'fs')
        if (fs) {
          try {
            // fs.exists speaks file://, not bbebee-file:// — convert back.
            // bbebee-file://localhost/path -> file:///path
            // bbebee-file:///path -> file:///path
            let fsUri = sourceUrl
            if (fsUri.startsWith('bbebee-file://localhost/')) {
              fsUri = 'file:///' + fsUri.slice('bbebee-file://localhost/'.length)
            } else if (fsUri.startsWith('bbebee-file:///')) {
              fsUri = 'file:///' + fsUri.slice('bbebee-file:///'.length)
            } else if (fsUri.startsWith('bbebee-file:')) {
              fsUri = 'file:' + fsUri.slice('bbebee-file:'.length)
            }
            if (await fs.exists(fsUri)) {
              // Guard: only trust local URIs with image extensions. A lazy:
              // ref's sourceUrl is the audio file itself; returning it as-is
              // would put an audio file in an <img> tag.
              const lower = sourceUrl.toLowerCase().split('?')[0]!
              if (/\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i.test(lower)) {
                if (active) settle(sourceUrl)
                return
              }
              // Not an image — fall through to cache lookup below.
            }
            // File is gone — fall through to cache re-fetch below.
          } catch {
            // Existence check failed; fall through to cache lookup.
          }
        } else {
          // No fs service (e.g. tests): trust the local URI as before, but
          // only if it looks like an image.
          const lower = (sourceUrl ?? '').toLowerCase().split('?')[0]!
          if (/\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i.test(lower)) {
            if (active) settle(sourceUrl)
            return
          }
          // Not an image — fall through to cache lookup.
        }
      }

      const cache = serviceOf<CacheService>(ctx, 'cache')
      if (!cache) {
        if (active) setResolution(undefined)
        return
      }

      if (active) setResolution({ id, settled: false })
      try {
        const uri = await cache.artwork(sourceUrl ? { id, sourceUrl } : { id }, undefined, priority)
        settle(uri ?? undefined)
      } catch {
        settle(undefined)
      }
    }

    void checkLocalThenResolve()
    return () => {
      active = false
    }
  }, [ctx, id, sourceUrl, priority])

  if (!artwork) return undefined
  const cache = serviceOf<CacheService>(ctx, 'cache')
  // Without the cache plugin a remote cover renders directly, exactly as it
  // did before the cache existed.
  if (!cache) return artwork

  const current = resolution?.id === id ? resolution : undefined
  if (current?.uri) {
    return current.uri === artwork.sourceUrl ? artwork : { ...artwork, sourceUrl: current.uri }
  }
  // Settled with no URI: the cache could not help — a disabled plugin, a
  // refused fetch — so the remote URL is the honest fallback, BUT only if
  // it's actually an image. A lazy: ref's sourceUrl is the audio file itself;
  // returning it would put FLAC/MP3 in an <img> tag.
  const sourceIsImage = (u?: string) =>
    !!u && /\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)(\?|$)/i.test(u)
  if (current?.settled) {
    return sourceIsImage(artwork.sourceUrl) ? artwork : { ...artwork, sourceUrl: undefined }
  }
  // In flight (or not started yet): render the fallback rather than the CDN.
  if (isLocalUri(artwork.sourceUrl)) {
    return sourceIsImage(artwork.sourceUrl) ? artwork : { ...artwork, sourceUrl: undefined }
  }
  return { ...artwork, sourceUrl: undefined }
}
