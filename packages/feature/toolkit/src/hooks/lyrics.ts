/**
 * View hooks for `ctx.lyrics`.
 *
 * Provides reactive bindings for lyrics state and active line synchronization,
 * decoupled from high-frequency transport position updates.
 *
 * The hooks live in the shared toolkit; the lyrics feature's `./hooks` subpath
 * re-exports them under `@BBeBee/plugin-lyrics/hooks`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {
  Lyrics,
  LyricsService,
  LyricsState,
  LyricsStatus,
  PlayerService,
  TransportState,
} from '@BBeBee/protocol'
import { findActiveLyricIndex, parseLrc, type LyricLine, type ParsedLyrics } from '../lyrics.js'
import { serviceOf, useServiceState } from './react.js'

export interface UseLyricsResult {
  status: LyricsStatus
  trackUrn?: string
  lyrics?: Lyrics
  parsed: ParsedLyrics
  error?: string
  offsetMs: number
  supportsLyricSource?: boolean
  sourceType?: 'lyric-source' | 'audio-provider' | 'cache'
  retry: () => Promise<void>
  setOffset: (offsetMs: number) => void
}

const EMPTY_PARSED: ParsedLyrics = {
  lines: [],
  synced: false,
}

const IDLE_LYRICS_STATE: LyricsState = {
  status: 'idle',
  offsetMs: 0,
}

const IDLE_TRANSPORT_STATE: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
} as TransportState

/**
 * Returns current lyrics state and parsed lines.
 * Updates when the track changes or lyrics state updates.
 */
export function useLyrics(ctx: Context): UseLyricsResult {
  const getLyrics = () => serviceOf<LyricsService>(ctx, 'lyrics')

  const state = useServiceState<LyricsState>(
    ctx,
    ['lyrics/changed'],
    () => getLyrics()?.state ?? IDLE_LYRICS_STATE,
  )

  const parsed = useMemo(() => {
    if (!state.lyrics?.content) return EMPTY_PARSED
    return parseLrc(state.lyrics.content, { offsetMs: state.offsetMs })
  }, [state.lyrics?.content, state.offsetMs])

  const retry = useCallback(async () => {
    await getLyrics()?.retry?.()
  }, [ctx])

  const setOffset = useCallback(
    (offsetMs: number) => {
      getLyrics()?.setOffset?.(offsetMs)
    },
    [ctx],
  )

  return {
    status: state.status,
    trackUrn: state.trackUrn,
    lyrics: state.lyrics,
    parsed,
    error: state.error,
    offsetMs: state.offsetMs,
    supportsLyricSource: state.supportsLyricSource,
    sourceType: state.sourceType,
    retry,
    setOffset,
  }
}

/**
 * High-performance hook for active lyric line index.
 *
 * Interpolates playback position smoothly, but strictly updates React state
 * ONLY when the active line index transitions, preventing 60Hz full-page re-renders.
 */
export function useActiveLyricIndex(
  ctx: Context,
  lines: readonly LyricLine[],
  offsetMs = 0,
): number {
  const getPlayer = () => serviceOf<PlayerService>(ctx, 'player')
  const initialPos = getPlayer()?.state?.positionMs ?? 0
  const [activeIndex, setActiveIndex] = useState<number>(() =>
    findActiveLyricIndex(lines, initialPos, offsetMs),
  )
  const lastIndexRef = useRef<number>(activeIndex)
  lastIndexRef.current = activeIndex

  // Transport state and position interpolation anchor
  const anchor = useRef({
    positionMs: initialPos,
    at: performance.now(),
    status: getPlayer()?.state?.status ?? ('idle' as TransportState['status']),
  })

  useEffect(() => {
    // Re-anchor on position or state changes
    const currentPlayer = getPlayer()
    if (currentPlayer?.state) {
      anchor.current = {
        positionMs: currentPlayer.state.positionMs,
        at: performance.now(),
        status: currentPlayer.state.status,
      }
    }

    // Immediately compute activeIndex when lines arrive or offset changes
    const currentPos = currentPlayer?.state?.positionMs ?? 0
    const initialIndex = findActiveLyricIndex(lines, currentPos, offsetMs)
    if (initialIndex !== lastIndexRef.current) {
      lastIndexRef.current = initialIndex
      setActiveIndex(initialIndex)
    }

    const offPosition = ctx.on('player/position', (positionMs: number) => {
      anchor.current.positionMs = positionMs
      anchor.current.at = performance.now()
      const nextIdx = findActiveLyricIndex(lines, positionMs, offsetMs)
      if (nextIdx !== lastIndexRef.current) {
        lastIndexRef.current = nextIdx
        setActiveIndex(nextIdx)
      }
    })

    const offState = ctx.on('player/state-changed', (transport: TransportState) => {
      anchor.current.positionMs = transport.positionMs
      anchor.current.at = performance.now()
      anchor.current.status = transport.status
      const nextIdx = findActiveLyricIndex(lines, transport.positionMs, offsetMs)
      if (nextIdx !== lastIndexRef.current) {
        lastIndexRef.current = nextIdx
        setActiveIndex(nextIdx)
      }
    })

    const offActiveChanged = ctx.on('lyrics/active-changed', (idx: number) => {
      if (idx !== lastIndexRef.current) {
        lastIndexRef.current = idx
        setActiveIndex(idx)
      }
    })

    return () => {
      offPosition()
      offState()
      offActiveChanged()
    }
  }, [ctx, lines, offsetMs])

  // RAF interpolation for frame-accurate lyric line boundary transitions
  useEffect(() => {
    if (!lines || lines.length === 0) {
      if (lastIndexRef.current !== -1) {
        lastIndexRef.current = -1
        setActiveIndex(-1)
      }
      return
    }

    let frame = 0
    const tick = () => {
      if (anchor.current.status === 'playing') {
        const elapsed = performance.now() - anchor.current.at
        const currentMs = anchor.current.positionMs + elapsed
        const nextIdx = findActiveLyricIndex(lines, currentMs, offsetMs)
        if (nextIdx !== lastIndexRef.current) {
          lastIndexRef.current = nextIdx
          setActiveIndex(nextIdx)
        }
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [lines, offsetMs])

  return activeIndex
}

export type LyricPlaybackStage =
  | 'loading'
  | 'prelude'
  | 'singing'
  | 'interlude'
  | 'outro'
  | 'unsynced'
  | 'no-lyrics'
  | 'idle'

export interface CurrentLyricInfo {
  status: LyricsStatus
  currentLine?: LyricLine
  nextLine?: LyricLine
  synced: boolean
  title?: string
  artist?: string
  album?: string
  durationMs: number
  positionMs: number
  isPlaying: boolean
  supportsLyricSource?: boolean
  sourceType?: 'lyric-source' | 'audio-provider' | 'cache'
  stage: LyricPlaybackStage
  displayCurrentLine: string
  displayNextLine?: string
}

/**
 * High-level hook returning the current and next line for desktop lyrics.
 */
export function useCurrentLyric(ctx: Context): CurrentLyricInfo {
  const { status, trackUrn: lyricTrackUrn, parsed, offsetMs, supportsLyricSource, sourceType } = useLyrics(ctx)
  const activeIndex = useActiveLyricIndex(ctx, parsed.lines, offsetMs)

  const getPlayer = () => serviceOf<PlayerService>(ctx, 'player')
  const transport = useServiceState<TransportState>(
    ctx,
    ['player/state-changed', 'player/track-changed'],
    () => getPlayer()?.state ?? IDLE_TRANSPORT_STATE,
  )

  const isTrackUrnMatch =
    !transport.trackUrn || !lyricTrackUrn || transport.trackUrn === lyricTrackUrn
  const lines = isTrackUrnMatch ? parsed.lines : []
  const hasLines = lines.length > 0
  const title = transport.nowPlaying?.title
  const artist = transport.nowPlaying?.artist
  const fallbackTitle = title ? `${title}${artist ? ` - ${artist}` : ''}` : 'BBeBee 音乐'

  let stage: LyricPlaybackStage
  let currentLine: LyricLine | undefined
  let nextLine: LyricLine | undefined
  let displayCurrentLine: string
  let displayNextLine: string | undefined

  if (!isTrackUrnMatch || status === 'loading-song' || status === 'loading-lyrics') {
    stage = 'loading'
    displayCurrentLine = '歌词加载中…'
    displayNextLine = undefined
  } else if (parsed.synced && hasLines) {
    if (activeIndex === -1) {
      stage = 'prelude'
      const firstUpcoming =
        lines.find((l) => l.timeMs !== undefined && l.text.trim().length > 0) ?? lines[0]
      nextLine = firstUpcoming
      displayCurrentLine = title ? `(前奏) ${title}` : '♪ 前奏 ♪'
      displayNextLine = firstUpcoming?.text
    } else {
      currentLine = lines[activeIndex]
      const isCurrentEmpty = !currentLine?.text || currentLine.text.trim().length === 0

      // Find next upcoming non-empty lyric line
      const upcoming = lines.slice(activeIndex + 1).find((l) => l.text.trim().length > 0)
      nextLine = upcoming

      if (isCurrentEmpty) {
        if (upcoming) {
          stage = 'interlude'
          displayCurrentLine = '♪ 间奏 ♪'
          displayNextLine = upcoming.text
        } else {
          stage = 'outro'
          displayCurrentLine = '♪ 尾奏 ♪'
          displayNextLine = undefined
        }
      } else {
        stage = 'singing'
        displayCurrentLine = currentLine?.text ?? fallbackTitle
        displayNextLine = upcoming?.text
      }
    }
  } else if (!parsed.synced && hasLines) {
    stage = 'unsynced'
    displayCurrentLine = fallbackTitle
    displayNextLine = lines[0]?.text?.trim() ? lines[0].text : '纯文本歌词'
    currentLine = lines[0]
  } else if (status === 'no-lyrics' || (status === 'ready' && !hasLines)) {
    stage = 'no-lyrics'
    displayCurrentLine = fallbackTitle
    displayNextLine = '暂无歌词'
  } else if (status === 'error') {
    stage = 'no-lyrics'
    displayCurrentLine = fallbackTitle
    displayNextLine = '歌词加载失败'
  } else {
    stage = 'idle'
    displayCurrentLine = fallbackTitle
    displayNextLine = transport.status === 'playing' ? undefined : '聆听高品质音乐'
  }

  return {
    status,
    currentLine,
    nextLine,
    synced: parsed.synced,
    title,
    artist,
    album: transport.nowPlaying?.album,
    durationMs: transport.durationMs,
    positionMs: transport.positionMs,
    isPlaying: transport.status === 'playing',
    supportsLyricSource,
    sourceType,
    stage,
    displayCurrentLine,
    displayNextLine,
  }
}

