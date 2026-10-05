/**
 * React hooks for `@BBeBee/plugin-now-playing`.
 *
 * `useNowPlayingStyle` subscribes to the `now-playing/style-changed` event and
 * returns the current style id together with a setter. Both the desktop and
 * mobile view packages import this single hook so the preference is shared.
 *
 * `useTrackDetails` binds the headless aggregation in `details.ts` — the data
 * behind the "查看播放内容" modal — so the view holds no domain reads itself.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingService, NowPlayingStyleId, Track } from '@BBeBee/protocol'
import { DEFAULT_NOW_PLAYING_STYLE } from '@BBeBee/protocol'
import { resolveTrackDetails, type TrackDetails } from './details.js'

export type { TrackDetails }

/**
 * Safely resolves the `nowPlaying` service from context without throwing
 * if called from a scoped context that has not declared `nowPlaying` in inject.
 */
function getNowPlayingService(ctx: Context): NowPlayingService | undefined {
  try {
    const reflect = (ctx as unknown as { reflect?: { get(key: string, required: boolean): unknown } })
      .reflect
    if (reflect && typeof reflect.get === 'function') {
      return reflect.get('nowPlaying', false) as NowPlayingService | undefined
    }
    return (ctx as unknown as { nowPlaying?: NowPlayingService }).nowPlaying
  } catch {
    return undefined
  }
}

/**
 * Read and write the now-playing layout style preference.
 *
 * The style id is managed by `ctx.nowPlaying` and broadcast via `now-playing/style-changed`.
 */
export function useNowPlayingStyle(ctx: Context): {
  styleId: NowPlayingStyleId
  setStyle: (id: NowPlayingStyleId) => void
} {
  const [styleId, setLocalStyle] = useState<NowPlayingStyleId>(() => {
    const service = getNowPlayingService(ctx)
    return service ? service.getStyle() : DEFAULT_NOW_PLAYING_STYLE
  })

  useEffect(() => {
    const service = getNowPlayingService(ctx)
    if (service) {
      setLocalStyle(service.getStyle())
    }

    const off = ctx.on('now-playing/style-changed', (id: NowPlayingStyleId) => {
      setLocalStyle(id)
    })
    return () => void off()
  }, [ctx])

  const setStyle = useCallback(
    (id: NowPlayingStyleId) => {
      const service = getNowPlayingService(ctx)
      if (service) {
        service.setStyle(id)
      }
    },
    [ctx],
  )

  return { styleId, setStyle }
}

/**
 * The display-ready details of a track, resolved while the info modal is open.
 *
 * `loading` covers the aggregation's async reads (db bindings, fs stat, codec
 * metadata); a closed modal or a missing track answers `null`. Reads are
 * best-effort — an absent service degrades to the next fallback inside
 * {@link resolveTrackDetails}, it does not throw.
 */
export function useTrackDetails(
  ctx: Context,
  track: Track | null,
  open: boolean,
): { details: TrackDetails | null; loading: boolean } {
  const [details, setDetails] = useState<TrackDetails | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !track) {
      setDetails(null)
      return
    }

    let active = true
    setLoading(true)
    resolveTrackDetails(ctx, track)
      .then((resolved) => {
        if (active) setDetails(resolved)
      })
      .catch((err: unknown) => {
        ctx.logger?.error('Failed to load track details: %o', err)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, track, ctx])

  return { details, loading }
}
