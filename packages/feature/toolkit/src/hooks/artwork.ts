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
import type { ArtworkRef, CacheService, Uri } from '@BBeBee/protocol'
import { serviceOf } from './react.js'

/** An already-local location needs no caching; the platform can render it as-is. */
function isLocalUri(uri: string | undefined): boolean {
  return uri === undefined || /^(file|content|data|bbebee-file):/i.test(uri)
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
export function useResolvedArtwork(ctx: Context, artwork?: ArtworkRef): ArtworkRef | undefined {
  const [resolution, setResolution] = useState<Resolution | undefined>(undefined)
  const id = artwork?.id
  const sourceUrl = artwork?.sourceUrl

  useEffect(() => {
    if (!id) {
      setResolution(undefined)
      return
    }
    if (sourceUrl && isLocalUri(sourceUrl)) {
      setResolution({ id, uri: sourceUrl, settled: true })
      return
    }
    const cache = serviceOf<CacheService>(ctx, 'cache')
    if (!cache) {
      setResolution(undefined)
      return
    }

    let active = true
    setResolution({ id, settled: false })
    void cache.artwork(sourceUrl ? { id, sourceUrl } : { id }).then(
      (uri) => {
        if (active) setResolution({ id, ...(uri ? { uri } : {}), settled: true })
      },
      () => {
        if (active) setResolution({ id, settled: true })
      },
    )
    return () => {
      active = false
    }
  }, [ctx, id, sourceUrl])

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
  // refused fetch — so the remote URL is the honest fallback.
  if (current?.settled) return artwork
  // In flight (or not started yet): render the fallback rather than the CDN.
  if (isLocalUri(artwork.sourceUrl)) return artwork
  return { ...artwork, sourceUrl: undefined }
}
