/**
 * CinematicLyricsTemplate — the 映画 (cinematic) lyrics template.
 *
 * A reusable lyrics display template: the full lyric list in the cinematic
 * cursive type — subtitle-style like an AMV.
 *
 * Synced lyrics: the active line is centred, enlarged and glowing, the rest
 * fading out by distance; the view follows playback; clicking a timed line
 * seeks the player to it (gated by `canSeek`).
 *
 * Plain lyrics: rendered as a uniform sheet — no highlight, no playback
 * follow, mouse-wheel scrolling only. Both modes scroll with the scrollbar
 * hidden; the list is the stage, not a document.
 *
 * Data comes from the `lyrics` service, so a host needs only `ctx`, the sync
 * position, and optionally the transport's track URN to drop it in.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Context } from 'cordis'
import { findActiveLyricIndex, parseLrc, type ParsedLyrics } from '@BBeBee/toolkit'
import { tablerIcon } from '../icons/index.js'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { LyricsService, LyricsState } from '@BBeBee/protocol'

/* ── Cursive / handwriting font stack (shared with the cinematic style) ─── */

export const CURSIVE_FONT = "'CinematicCursive', 'Caveat', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Z003', 'URW Chancery L', cursive, sans-serif"

const IDLE_LYRICS_STATE: LyricsState = { status: 'idle', offsetMs: 0 }

/** How long user scrolling suspends auto-follow before it resumes. */
const USER_SCROLL_RESUME_MS = 5000

/** Hides the scrollbar on the lyric list; inline styles cannot reach the pseudo-element. */
const HIDE_SCROLLBAR_RULE = '.cinematic-lyrics-scroll::-webkit-scrollbar { display: none; }'

export interface CinematicLyricsTemplateProps {
  ctx: Context
  /**
   * The position lyrics sync against, in ms. Pass the scrub-aware display
   * position so highlighting previews the seek target while dragging.
   */
  displayPosition: number
  /** The transport's track URN; lyrics still showing for the previous track are dropped. */
  trackUrn?: string
  /** Picks the idle placeholder copy. */
  isPlaying?: boolean
  /** Whether clicking a line may seek. Defaults to true. */
  canSeek?: boolean
  /** Seek sink; defaults to `ctx.player.seek`. */
  onSeek?: (timeMs: number) => void
  style?: CSSProperties
}

export function CinematicLyricsTemplate(props: CinematicLyricsTemplateProps): ReactElement {
  const { ctx, displayPosition, trackUrn, isPlaying, canSeek = true, onSeek, style } = props

  /* ── lyrics state ─────────────────────────────────────────────────────── */
  const lyricsService = serviceOf<LyricsService>(ctx, 'lyrics')
  const lyricsState = useServiceState<LyricsState>(
    ctx,
    ['lyrics/changed'],
    () => lyricsService?.state ?? IDLE_LYRICS_STATE,
  )

  const parsed = useMemo<ParsedLyrics | null>(() => {
    if (!lyricsState?.lyrics?.content) return null
    if (lyricsState.trackUrn && trackUrn && lyricsState.trackUrn !== trackUrn) return null
    return parseLrc(lyricsState.lyrics.content, { offsetMs: lyricsState.offsetMs })
  }, [lyricsState?.lyrics?.content, lyricsState?.offsetMs, lyricsState?.trackUrn, trackUrn])

  const lines = parsed?.lines ?? []
  const isSynced = parsed?.synced ?? false

  const activeIndex = useMemo(() => {
    if (lines.length === 0) return -1
    return findActiveLyricIndex(lines, displayPosition, lyricsState?.offsetMs ?? 0)
  }, [lines, displayPosition, lyricsState?.offsetMs])

  /* ── scroll follow ────────────────────────────────────────────────────── */
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<(HTMLElement | null)[]>([])
  const [userScrolling, setUserScrolling] = useState(false)
  const scrollResumeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (scrollResumeRef.current) clearTimeout(scrollResumeRef.current)
    }
  }, [])

  // A new track (or its lyrics arriving) restarts from the top, following.
  useEffect(() => {
    setUserScrolling(false)
    if (containerRef.current) containerRef.current.scrollTop = 0
  }, [trackUrn, lyricsState?.lyrics?.content])

  const scrollToLine = useCallback((index: number) => {
    const container = containerRef.current
    const line = lineRefs.current[index]
    if (!container || !line) return
    const top = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    } else {
      container.scrollTop = Math.max(0, top)
    }
  }, [])

  useEffect(() => {
    // Plain lyrics have no timeline: highlight and playback follow are synced-only.
    if (isSynced && !userScrolling && activeIndex >= 0) scrollToLine(activeIndex)
  }, [isSynced, activeIndex, userScrolling, scrollToLine])

  const markUserScrolling = useCallback(() => {
    setUserScrolling(true)
    if (scrollResumeRef.current) clearTimeout(scrollResumeRef.current)
    scrollResumeRef.current = setTimeout(() => setUserScrolling(false), USER_SCROLL_RESUME_MS)
  }, [])

  /* ── seek ─────────────────────────────────────────────────────────────── */
  const seekTo = useCallback(
    (timeMs: number) => {
      if (!canSeek) return
      if (onSeek) onSeek(timeMs)
      else void ctx.player?.seek(timeMs)
      setUserScrolling(false)
    },
    [canSeek, onSeek, ctx],
  )

  /* ── render ───────────────────────────────────────────────────────────── */
  return h(
    'div',
    {
      'data-testid': 'cinematic-lyrics-block',
      role: 'region',
      'aria-label': '歌词',
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        fontFamily: CURSIVE_FONT,
        color: '#FFFFFF',
        ...style,
      },
    },

    h('style', null, HIDE_SCROLLBAR_RULE),

    /* the full lyric list, scrollable */
    h(
      'div',
      {
        ref: containerRef,
        'data-testid': 'cinematic-lyrics-scroll',
        className: 'cinematic-lyrics-scroll',
        onWheel: () => markUserScrolling(),
        onTouchMove: () => markUserScrolling(),
        style: {
          flex: 1,
          minHeight: 0,
          width: '100%',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: lines.length > 0 ? 'flex-start' : 'center',
          gap: 10,
          padding: '28% 0 34%',
          scrollbarWidth: 'none',
          scrollbarColor: 'transparent',
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        },
      },

      lines.length === 0
        ? h(
            'div',
            {
              style: {
                fontSize: 20,
                opacity: 0.4,
                fontStyle: 'italic',
                color: 'rgba(255, 255, 255, 0.7)',
                textAlign: 'center',
              },
            },
            isPlaying ? '♪ 愿音乐治愈所有的伤痕 ♪' : 'No Surprises',
          )
        : isSynced
          ? lines.map((line, idx) => {
              const isCurrent = idx === activeIndex
              const distance = isCurrent ? 0 : Math.abs(idx - activeIndex)
              const opacity = isCurrent ? 1 : distance === 1 ? 0.42 : distance === 2 ? 0.3 : 0.18
              const clickable = line.timeMs !== undefined && canSeek

              return h(
                'div',
                {
                  key: `${line.timeMs ?? 'plain'}-${idx}`,
                  ref: (el: HTMLElement | null) => {
                    lineRefs.current[idx] = el
                  },
                  role: clickable ? 'button' : undefined,
                  tabIndex: clickable ? 0 : undefined,
                  'data-active': isCurrent ? 'true' : undefined,
                  'data-testid': clickable ? `cinematic-lyric-line-${idx}` : undefined,
                  'aria-label': clickable
                    ? `${line.text}（${Math.floor((line.timeMs ?? 0) / 60000)}:${String(
                        Math.floor(((line.timeMs ?? 0) % 60000) / 1000),
                      ).padStart(2, '0')}）`
                    : undefined,
                  onClick: clickable ? () => seekTo(line.timeMs as number) : undefined,
                  onKeyDown: clickable
                    ? (e: { key: string; preventDefault: () => void }) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          seekTo(line.timeMs as number)
                        }
                      }
                    : undefined,
                  style: {
                    opacity,
                    fontSize: isCurrent ? 24 : 16,
                    fontWeight: isCurrent ? 500 : 400,
                    letterSpacing: isCurrent ? '1.5px' : '0.5px',
                    lineHeight: 1.5,
                    textAlign: 'center',
                    color: '#FFFFFF',
                    textShadow: isCurrent ? '0 2px 12px rgba(0, 0, 0, 0.5)' : 'none',
                    transition: 'all 0.4s cubic-bezier(0.2, 0, 0, 1)',
                    maxWidth: '90%',
                    cursor: clickable ? 'pointer' : 'default',
                  },
                },
                h('div', null, line.text),
                line.translation
                  ? h(
                      'div',
                      {
                        style: {
                          fontSize: isCurrent ? 18 : 14,
                          fontStyle: 'italic',
                          opacity: 0.85,
                          marginTop: 3,
                          letterSpacing: '0.3px',
                        },
                      },
                      line.translation,
                    )
                  : null,
              )
            })
          : lines.map((line, idx) =>
              h(
                'div',
                {
                  key: `sheet-${idx}`,
                  ref: (el: HTMLElement | null) => {
                    lineRefs.current[idx] = el
                  },
                  style: {
                    fontSize: 17,
                    fontWeight: 400,
                    letterSpacing: '0.3px',
                    lineHeight: 1.6,
                    textAlign: 'center',
                    color: '#FFFFFF',
                    opacity: 0.85,
                    maxWidth: '90%',
                  },
                },
                line.text,
              ),
            ),
    ),

    /* floating "back to current" pill while the user browses */
    userScrolling && activeIndex >= 0
      ? h(
          'button',
          {
            type: 'button',
            'data-testid': 'cinematic-lyrics-return',
            onClick: () => {
              setUserScrolling(false)
              scrollToLine(activeIndex)
            },
            style: {
              position: 'absolute',
              bottom: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid rgba(255, 255, 255, 0.18)',
              background: 'rgba(13, 17, 24, 0.85)',
              color: 'rgba(255, 255, 255, 0.9)',
              cursor: 'pointer',
              fontSize: 12,
              zIndex: 5,
              backdropFilter: 'blur(6px)',
            },
          },
          tablerIcon('chevron-down', { size: 14 }),
          '回到当前歌词',
        )
      : null,
  )
}
