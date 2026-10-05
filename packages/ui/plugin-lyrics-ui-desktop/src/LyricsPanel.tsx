/**
 * LyricsPanel — Full synchronized lyrics panel for the desktop player.
 *
 * Implements:
 * - Smooth auto-scrolling with visual center positioning
 * - Active line glowing/highlighting, played/unplayed visual hierarchy
 * - Click-to-seek timestamp navigation
 * - Manual scroll detection, temporary pause, and "Return to current" button
 * - Clean loading, empty, and error fallback states
 * - Keyboard & mouse accessibility
 */

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { formatDuration, type LyricLine } from '@BBeBee/toolkit'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useNowPlaying } from '@BBeBee/toolkit/hooks'
import { useActiveLyricIndex, useLyrics } from '@BBeBee/plugin-lyrics/hooks'
import { tokens } from '@BBeBee/ui-tokens'

export interface LyricsPanelProps {
  ctx: Context
  className?: string
  style?: React.CSSProperties
}

export function LyricsPanel({ ctx, style }: LyricsPanelProps): ReactElement {
  const { status, parsed, error, offsetMs, supportsLyricSource, sourceType, retry } = useLyrics(ctx)
  const nowPlaying = useNowPlaying(ctx)
  const activeIndex = useActiveLyricIndex(ctx, parsed.lines, offsetMs)

  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLElement | null)[]>([])

  // User manual scroll tracking
  const [userScrolling, setUserScrolling] = useState(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isProgrammaticScroll = useRef(false)

  // Clear scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    }
  }, [])

  // Scroll active line to center
  const scrollToActiveLine = useCallback((index: number, smooth = true) => {
    const container = containerRef.current
    const lineElem = lineRefs.current[index]
    if (!container || !lineElem) return

    const containerHeight = container.clientHeight
    const lineTop = lineElem.offsetTop
    const lineHeight = lineElem.clientHeight
    const targetScrollTop = lineTop - containerHeight / 2 + lineHeight / 2

    isProgrammaticScroll.current = true
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: smooth ? 'smooth' : 'auto',
    })

    // Reset programmatic scroll flag after scroll settles
    setTimeout(() => {
      isProgrammaticScroll.current = false
    }, 400)
  }, [])

  // Auto-scroll when activeIndex updates unless the user is manually browsing
  useEffect(() => {
    if (!userScrolling && activeIndex >= 0) {
      scrollToActiveLine(activeIndex, true)
    }
  }, [activeIndex, userScrolling, scrollToActiveLine])

  // Reset scroll when track changes
  useEffect(() => {
    setUserScrolling(false)
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
    }
  }, [nowPlaying?.title, nowPlaying?.artist])

  // Detect user manual interaction via wheel / touch
  const handleUserInteraction = () => {
    setUserScrolling(true)
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      setUserScrolling(false)
    }, 5000)
  }

  // Handle clicking a lyric line to seek
  const handleLineClick = (line: LyricLine) => {
    if (line.timeMs !== undefined && ctx.player?.seek) {
      void ctx.player.seek(line.timeMs)
      setUserScrolling(false)
    }
  }

  return h(
    'div',
    {
      role: 'region',
      'aria-label': 'Lyrics panel',
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minWidth: 320,
        maxWidth: 680,
        overflow: 'hidden',
        color: '#FFFFFF',
        boxSizing: 'border-box',
        padding: `${tokens.space[4]}px`,
        ...style,
      },
    },
    // Top Track Info Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          paddingBottom: tokens.space[4],
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 0,
            flex: 1,
          },
        },
        h(
          'div',
          {
            style: {
              fontSize: 20,
              fontWeight: 700,
              color: '#FFFFFF',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            },
          },
          h('span', null, nowPlaying?.title ?? (status === 'loading-song' ? 'Loading song…' : 'BBeBee Music')),
          sourceType === 'lyric-source'
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: 'rgba(95, 135, 255, 0.2)',
                    color: '#93B4FF',
                    border: '1px solid rgba(95, 135, 255, 0.35)',
                  },
                },
                '歌词源',
              )
            : null,
        ),
        h(
          'div',
          {
            style: {
              fontSize: 14,
              color: 'rgba(255, 255, 255, 0.6)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          nowPlaying?.artist ? h('span', null, nowPlaying.artist) : null,
          nowPlaying?.album
            ? h('span', { style: { opacity: 0.7 } }, `• ${nowPlaying.album}`)
            : null,
        ),
      ),
      parsed.lines.length > 0 && nowPlaying
        ? h(
            'button',
            {
              type: 'button',
              title: '分享歌词',
              'aria-label': '分享歌词',
              onClick: () => {
                const share = serviceOf<ShareService>(ctx, 'share')
                if (share) {
                  share.shareLyrics(nowPlaying, parsed.lines.map((l: LyricLine) => l.text))
                }
              },
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: tokens.radius.sm,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: 'rgba(255, 255, 255, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'background-color 0.2s, color 0.2s',
                flexShrink: 0,
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.16)'
                e.currentTarget.style.color = '#FFFFFF'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)'
              },
            },
            tablerIcon('share', { size: 16 }),
            h('span', null, '分享歌词'),
          )
        : null,
    ),

    // Lyrics Content Area
    h(
      'div',
      {
        ref: containerRef,
        onWheel: handleUserInteraction,
        onTouchMove: handleUserInteraction,
        style: {
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          paddingTop: '35vh',
          paddingBottom: '45vh',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
          scrollBehavior: 'smooth',
        },
      },
      // State: Loading
      status === 'loading-lyrics' || status === 'loading-song'
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                padding: '60px 0',
                color: 'rgba(255, 255, 255, 0.5)',
              },
            },
            h(
              'div',
              {
                style: {
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: '3px solid rgba(255, 255, 255, 0.1)',
                  borderTopColor: 'var(--color-primary, #5F87FF)',
                  animation: 'spin 1s linear infinite',
                },
              },
            ),
            h('span', { style: { fontSize: 14 } }, 'Loading lyrics…'),
          )
        : null,

      // State: Error
      status === 'error'
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '60px 0',
                textAlign: 'center',
              },
            },
            tablerIcon('alert', { size: 36, color: 'var(--error, #EF4444)' }),
            h('span', { style: { fontSize: 15, color: 'var(--error, #EF4444)' } }, error || 'Failed to load lyrics'),
            h(
              'button',
              {
                onClick: () => void retry(),
                style: {
                  marginTop: 8,
                  padding: '6px 18px',
                  borderRadius: 16,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.2))',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-primary, #F5F7FF)',
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'background-color 0.2s',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                },
              },
              'Retry',
            ),
          )
        : null,

      // State: Idle / No Lyrics
      status === 'idle' || status === 'no-lyrics' || (status === 'ready' && parsed.lines.length === 0)
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '80px 0',
                color: 'rgba(255, 255, 255, 0.4)',
                textAlign: 'center',
              },
            },
            tablerIcon('music', { size: 40, style: { opacity: 0.6 } }),
            h(
              'span',
              { style: { fontSize: 16 } },
              status === 'idle'
                ? '暂无播放歌曲'
                : supportsLyricSource === false
                  ? '当前音源未启用外部歌词源'
                  : '暂无歌词',
            ),
            status === 'no-lyrics' && supportsLyricSource === false
              ? h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.35)' } },
                  '可在设置「歌词源管理」中开启该音频源的外部歌词源支持',
                )
              : null,
            status === 'no-lyrics' && supportsLyricSource !== false
              ? h(
                  'button',
                  {
                    onClick: () => void retry(),
                    style: {
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.16)',
                      borderRadius: 6,
                      color: 'rgba(255, 255, 255, 0.85)',
                      padding: '6px 14px',
                      fontSize: 13,
                      cursor: 'pointer',
                      marginTop: 4,
                      transition: 'background 0.2s ease',
                    },
                    onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)'
                    },
                    onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                    },
                  },
                  '重新检索歌词',
                )
              : null,
          )
        : null,

      // State: Unsynced Lyrics (plain text display)
      status === 'ready' && !parsed.synced && parsed.lines.length > 0
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            ...parsed.lines.map((line, idx) =>
              h(
                'div',
                {
                  key: `plain-${idx}`,
                  style: {
                    fontSize: 17,
                    lineHeight: 1.6,
                    color: 'rgba(255, 255, 255, 0.75)',
                    transition: 'color 0.2s ease',
                  },
                },
                line.text,
              ),
            ),
          )
        : null,

      // State: Synced Lyrics (karaoke / active line tracking)
      status === 'ready' && parsed.synced
        ? parsed.lines.map((line, idx) => {
            const isActive = idx === activeIndex
            const isPlayed = activeIndex !== -1 && idx < activeIndex

            return h(
              'div',
              {
                key: `${line.timeMs ?? idx}-${idx}`,
                ref: (el) => {
                  lineRefs.current[idx] = el
                },
                role: 'button',
                tabIndex: 0,
                'aria-current': isActive ? 'true' : undefined,
                'aria-label': `${line.text} (${formatDuration(line.timeMs ?? 0)})`,
                onClick: () => handleLineClick(line),
                onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleLineClick(line)
                  }
                },
                style: {
                  position: 'relative',
                  padding: '12px 16px',
                  borderRadius: 8,
                  fontSize: isActive ? 23 : 18,
                  fontWeight: isActive ? 700 : 500,
                  lineHeight: 1.5,
                  cursor: line.timeMs !== undefined ? 'pointer' : 'default',
                  color: isActive
                    ? 'var(--lyrics-active, var(--lavender-300, #D4CCFF))'
                    : isPlayed
                      ? 'var(--text-disabled, rgba(255, 255, 255, 0.22))'
                      : 'var(--lyrics-normal, rgba(255, 255, 255, 0.45))',
                  transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  transformOrigin: 'left center',
                  textShadow: isActive ? 'var(--glow-purple-md, 0 0 20px rgba(169, 156, 255, 0.28))' : 'none',
                  transition:
                    'color 0.3s cubic-bezier(0.16, 1, 0.3, 1), font-size 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease',
                },
              },
              line.text,
              line.translation
                ? h(
                    'div',
                    {
                      style: {
                        fontSize: isActive ? 15 : 13,
                        fontWeight: 400,
                        color: isActive ? 'var(--text-primary, #F5F7FF)' : 'var(--text-disabled, #41485B)',
                        marginTop: 4,
                      },
                    },
                    line.translation,
                  )
                : null,
            )
          })
        : null,
    ),

    // "Return to current lyric" floating button when user manually scrolls
    userScrolling && activeIndex >= 0
      ? h(
          'button',
          {
            type: 'button',
            onClick: () => {
              setUserScrolling(false)
              scrollToActiveLine(activeIndex, true)
            },
            style: {
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 18px',
              borderRadius: tokens.radius.pill,
              background: 'var(--button-primary-bg, var(--gradient-brand))',
              color: 'var(--button-primary-text, #FFFFFF)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: 'var(--glow-brand-sm, 0 4px 16px rgba(117, 152, 255, 0.18))',
              zIndex: 10,
              transition: 'transform 0.2s, background 0.2s, box-shadow 0.2s',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.background = 'var(--button-primary-hover, var(--gradient-ice))'
              e.currentTarget.style.transform = 'translateX(-50%) scale(1.04)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.background = 'var(--button-primary-bg, var(--gradient-brand))'
              e.currentTarget.style.transform = 'translateX(-50%) scale(1)'
            },
          },
          tablerIcon('chevron-down', { size: 18 }),
          '回到当前歌词',
        )
      : null,
  )
}
