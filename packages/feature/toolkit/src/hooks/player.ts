/**
 * View hooks for `ctx.player`.
 *
 * They live in the shared headless **toolkit**, not in any one view package,
 * and that is the whole reason ADR-2 stays affordable: the part with actual
 * logic — which events invalidate which state, how a position is interpolated
 * — is written once, and only the JSX is written twice (docs/08 4).
 *
 * If you are about to write the same `if` in both view packages, it belongs
 * here instead. The player feature's `./hooks` subpath re-exports these under
 * `@BBeBee/plugin-player/hooks` for its own view packages and older consumers.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {
  NowPlayingMeta,
  PlayHistoryHeatmapDay,
  PlayHistoryStats,
  PlayMode,
  PlayRecord,
  PlayerService,
  QueueItem,
  SourcesService,
  Track,
  TransportState,
} from '@BBeBee/protocol'
import { serviceOf, useServiceState } from './react.js'
import { shallowArrayEqual } from './store.js'

/** The transport, re-read whenever it changes. */
export function useTransport(ctx: Context): TransportState {
  return useServiceState(
    ctx,
    ['player/state-changed', 'player/track-changed'],
    () => ctx.player.state,
  )
}

/** The current playback mode (shuffle, sequence, single-loop, list-loop). */
export function usePlayMode(ctx: Context): PlayMode {
  const state = useTransport(ctx)
  return state.playMode
}

/** The currently playing track's metadata (artwork, title, artist, album). */
export function useNowPlaying(ctx: Context): NowPlayingMeta | undefined {
  const state = useTransport(ctx)
  return state.nowPlaying
}

/**
 * The queue.
 *
 * Compared element-wise: `queue/changed` hands out a fresh array of the same
 * items, and re-rendering a 5,000-row list because the wrapper changed is the
 * difference between a scroll and a stutter.
 */
export function useQueue(ctx: Context): readonly QueueItem[] {
  return useServiceState(ctx, ['queue/changed'], () => ctx.player.queue, {
    isEqual: shallowArrayEqual,
  })
}

/**
 * The real upcoming order.
 *
 * Under shuffle this is the seeded permutation after the current item, not
 * the queue's row order (docs/05 §2) — a page listing "up next" in row order
 * while shuffle is on shows an order nothing will ever play. Re-read on queue
 * changes and on transport changes (the cut point moves with `currentItemId`),
 * compared element-wise like the queue itself.
 */
export function useUpcoming(ctx: Context): readonly QueueItem[] {
  return useServiceState(
    ctx,
    ['queue/changed', 'player/state-changed'],
    () => ctx.player.upcoming(),
    { isEqual: shallowArrayEqual },
  )
}

/**
 * The catalogue rows behind a list of URNs — what a queue row shows instead
 * of the URN itself.
 *
 * The queue holds URNs, not tracks (docs/05 §2); the display data arrives
 * with the catalogue read this hook does for the list, one chunked
 * `getTracks` per set of URNs. Resolutions are cached for the session, and
 * `library/changed` — a scan landing mid-session, a source updated — drops
 * the cache.
 *
 * Read through `serviceOf` rather than a property, deliberately: the
 * catalogue is an *enhancement* here, not a requirement. A context with no
 * sources service (or URNs it cannot answer — a removed source, a track still
 * being scanned) resolves to nothing, and the view falls back to
 * `queueTrackFallback` rather than throwing or rendering an empty row.
 */
export function useTracksByUrn(ctx: Context, urns: readonly string[]): ReadonlyMap<string, Track> {
  const [cache, setCache] = useState<ReadonlyMap<string, Track>>(() => new Map())
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const off = ctx.on('library/changed', () => {
      setCache(new Map())
      setGeneration((n) => n + 1)
    })
    return () => void off()
  }, [ctx])

  // Contents, not identity: `queue.map(…)` hands the hook a fresh array every
  // render, so the read is keyed on the URNs themselves.
  const key = [...new Set(urns)].sort().join('\n')

  useEffect(() => {
    const sources = serviceOf<SourcesService>(ctx, 'sources')
    if (!sources || key === '') return
    const missing = key.split('\n').filter((urn) => !cacheRef.current.has(urn))
    if (missing.length === 0) return
    let cancelled = false
    sources
      .getTracks(missing)
      .then((tracks) => {
        if (cancelled || tracks.length === 0) return
        setCache((prev) => {
          const next = new Map(prev)
          for (const track of tracks) next.set(track.urn, track)
          return next
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [ctx, key, generation])

  return cache
}

/**
 * What a queue row shows before — or instead of — the catalogue's answer.
 *
 * **Never the URN.** A queue is a list of things to play, and a URN is an
 * implementation detail the user never typed; showing it is what an
 * unresolved row looks like when nobody decided what it should look like
 * instead. The playing item borrows the transport's own metadata — the
 * player resolves that for the lock screen, so it can arrive before the
 * catalogue read does — and every other unresolved row says it is loading.
 * A row that says "Loading…" forever is a caching bug to fix, not a URN to
 * fall back to.
 */
export function queueTrackFallback(
  item: QueueItem,
  nowPlaying: NowPlayingMeta | undefined,
  isCurrent: boolean,
): Track {
  if (isCurrent && nowPlaying) {
    return {
      urn: item.trackUrn,
      title: nowPlaying.title,
      // A display-only credit: the transport carries a name, not an entity,
      // and TrackRow reads the names only.
      artists: nowPlaying.artist
        ? [{ urn: `${item.trackUrn}#artist`, name: nowPlaying.artist, role: 'main', ordinal: 0 }]
        : [],
      ...(nowPlaying.artwork ? { artwork: nowPlaying.artwork } : {}),
    }
  }
  return { urn: item.trackUrn, title: 'Loading…', artists: [] }
}

/**
 * Playback position, interpolated between the service's 1 Hz ticks.
 *
 * `player/position` fires once a second (docs/07 5) because at 60 Hz it would
 * dominate the event bus for no benefit. A progress bar driven straight off it
 * visibly steps. So the event resynchronises and `requestAnimationFrame`
 * fills the gap — which is why this is a hook and not a selector.
 *
 * ⚠️ It deliberately returns a number that changes ~60 times a second. Use it
 * for the scrubber and the elapsed-time label, never for a component that
 * renders a list.
 */
export function usePosition(ctx: Context): number {
  const state = useTransport(ctx)
  const [position, setPosition] = useState(state.positionMs)

  // The last authoritative reading, and when we received it.
  const anchor = useRef({ positionMs: state.positionMs, at: now() })

  useEffect(() => {
    const off = ctx.on('player/position', (positionMs: number) => {
      anchor.current = { positionMs, at: now() }
      setPosition(positionMs)
    })
    return () => void off()
  }, [ctx])

  // Re-anchor on any transport change: a seek, a pause, or a new track all
  // move the position without a tick, and interpolating from a stale anchor
  // shows time advancing through a paused track.
  useEffect(() => {
    anchor.current = { positionMs: state.positionMs, at: now() }
    setPosition(state.positionMs)
  }, [state.positionMs, state.trackUrn, state.status])

  useEffect(() => {
    if (state.status !== 'playing') return
    let frame = 0
    const tick = () => {
      const { positionMs, at } = anchor.current
      const elapsed = now() - at
      // Clamped to the duration: interpolating past the end shows a scrubber
      // overshooting in the moment before the track-change event lands.
      const bound = state.durationMs > 0 ? state.durationMs : Number.POSITIVE_INFINITY
      setPosition(Math.min(positionMs + elapsed, bound))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ctx, state.status, state.durationMs])

  return position
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Which transport controls are usable right now.
 *
 * Derived once here rather than as four `disabled=` expressions written twice.
 * A control that is present but does nothing is worse than an absent one.
 */
export interface TransportAvailability {
  canPlay: boolean
  canPause: boolean
  canSeek: boolean
  canNext: boolean
  canPrevious: boolean
}

/**
 * Whether the transport is playing, from the user's point of view.
 *
 * ⚠️ `stalled` counts. A buffer underrun is not a pause — docs/05 §2 keeps the
 * lock screen reporting *playing* through one precisely so nothing flickers —
 * and a bar that swapped to a play button mid-buffer would contradict the lock
 * screen a foot away from it. `loading` counts for the same reason: the user
 * pressed play and is waiting.
 */
export function isPlayingLike(status: TransportState['status']): boolean {
  return status === 'playing' || status === 'stalled' || status === 'loading'
}

export function useTransportAvailability(ctx: Context): TransportAvailability {
  const state = useTransport(ctx)
  const queue = useQueue(ctx)
  const index = queue.findIndex((item) => item.id === state.currentItemId)
  const playing = isPlayingLike(state.status)

  return {
    canPlay: !playing && queue.length > 0,
    canPause: playing,
    // A live stream has no duration to seek within.
    canSeek: state.durationMs > 0,
    canNext: queue.length > 0 && (state.repeat === 'all' || index < queue.length - 1),
    // `previous` restarts the current track before the threshold, so it is
    // available even on the first item — that is the behaviour, not a bug.
    canPrevious: queue.length > 0,
  }
}

/**
 * The track's duration, or `undefined` when there is not one.
 *
 * `TransportState.durationMs` is `0` both for "not known yet" and for a live
 * stream, and rendering that through `formatDuration` produces `0:00` — which
 * tells the user the stream is zero seconds long. The distinction is shared
 * logic, so it lives here rather than as a `|| undefined` written twice.
 */
export function useDuration(ctx: Context): number | undefined {
  const state = useTransport(ctx)
  return state.durationMs > 0 ? state.durationMs : undefined
}

/* ── history hooks ─────────────────────────────────────────────────────── */

export interface UsePlayHistoryResult {
  records: readonly PlayRecord[]
  loading: boolean
  refresh: () => void
}

export function usePlayHistory(
  ctx: Context,
  opts: { limit?: number; date?: string } = {},
): UsePlayHistoryResult {
  const [records, setRecords] = useState<readonly PlayRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setRecords([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    player
      .getHistory(opts)
      .then((data) => {
        if (!cancelled) {
          setRecords(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    const off = ctx.on('player/history-changed', () => {
      refresh()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, opts.limit, opts.date, tick, refresh])

  return { records, loading, refresh }
}

export interface UsePlayHistoryStatsResult {
  stats: PlayHistoryStats
  loading: boolean
  refresh: () => void
}

const DEFAULT_STATS: PlayHistoryStats = {
  totalPlays: 0,
  totalMsPlayed: 0,
  todayPlays: 0,
  completedPlays: 0,
}

export function usePlayHistoryStats(ctx: Context): UsePlayHistoryStatsResult {
  const [stats, setStats] = useState<PlayHistoryStats>(DEFAULT_STATS)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setStats(DEFAULT_STATS)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    player
      .getHistoryStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    const off = ctx.on('player/history-changed', () => {
      refresh()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, tick, refresh])

  return { stats, loading, refresh }
}

export interface UsePlayHistoryHeatmapResult {
  heatmap: readonly PlayHistoryHeatmapDay[]
  loading: boolean
  refresh: () => void
}

export function usePlayHistoryHeatmap(ctx: Context, days = 365): UsePlayHistoryHeatmapResult {
  const [heatmap, setHeatmap] = useState<readonly PlayHistoryHeatmapDay[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setHeatmap([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    player
      .getHistoryHeatmap(days)
      .then((data) => {
        if (!cancelled) {
          setHeatmap(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    const off = ctx.on('player/history-changed', () => {
      refresh()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, days, tick, refresh])

  return { heatmap, loading, refresh }
}

