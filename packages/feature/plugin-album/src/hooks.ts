/**
 * View hooks for `plugin-album`.
 *
 * One read, written once for both shells (docs/08 §4). The album's data is a
 * catalogue row, so the read goes to `ctx.sources` — this hook exists so the
 * two view packages cannot grow two different ideas of what "album not found"
 * means.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { AlbumDetail } from '@BBeBee/protocol'
import type { AsyncState } from '@BBeBee/ui-core'

export interface AlbumRead extends AsyncState<AlbumDetail> {
  hasMore?: boolean
  loadingMore?: boolean
  loadMore?: () => void
}

/**
 * One album with its tracks. `undefined` data means "no such album".
 *
 * `error` is used for a missing album as well as a failed read, deliberately:
 * a screen has the same thing to say either way — this album cannot be shown —
 * and a distinct empty state for a URN nobody has would be a distinction
 * without a difference.
 */
export function useAlbum(ctx: Context, urn: string | undefined): AlbumRead {
  const [state, setState] = useState<AsyncState<AlbumDetail> & { hasMore?: boolean; loadingMore?: boolean }>({
    status: 'idle',
    hasMore: false,
    loadingMore: false,
  })
  const cursorRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!urn) {
      cursorRef.current = undefined
      setState({ status: 'idle', hasMore: false, loadingMore: false })
      return
    }
    let cancelled = false
    cursorRef.current = undefined
    setState({ status: 'loading', hasMore: false, loadingMore: false })

    ctx.sources
      .getAlbum(urn, { limit: 30 })
      .then((album) => {
        if (cancelled) return
        cursorRef.current = album?.cursor
        setState(
          album
            ? {
                status: 'ready',
                data: album,
                hasMore: Boolean(album.hasMore),
                loadingMore: false,
              }
            : { status: 'error', error: new Error(`no album ${urn}`), hasMore: false, loadingMore: false },
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          hasMore: false,
          loadingMore: false,
        })
      })
    return () => void (cancelled = true)
  }, [ctx, urn])

  const loadMore = useCallback(() => {
    if (!urn || !state.hasMore || state.loadingMore || !cursorRef.current) return
    setState((prev) => ({ ...prev, loadingMore: true }))

    ctx.sources
      .getAlbum(urn, { cursor: cursorRef.current, limit: 30 })
      .then((nextAlbum) => {
        cursorRef.current = nextAlbum?.cursor
        setState((prev) => {
          if (!prev.data || !nextAlbum) return { ...prev, loadingMore: false }
          const existingUrns = new Set(prev.data.tracks.map((t) => t.urn))
          const newTracks = nextAlbum.tracks.filter((t) => !existingUrns.has(t.urn))
          return {
            ...prev,
            loadingMore: false,
            hasMore: Boolean(nextAlbum.hasMore),
            data: {
              ...prev.data,
              tracks: [...prev.data.tracks, ...newTracks],
            },
          }
        })
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loadingMore: false }))
      })
  }, [ctx, urn, state.hasMore, state.loadingMore])

  return { ...state, loadMore }
}
