import { Fragment, createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LibraryService, PlayMode, SourcesService, Track, UiService } from '@BBeBee/protocol'
import { formatDuration } from '@BBeBee/toolkit'
import { NOW_PLAYING_VIEWS } from '@BBeBee/plugin-now-playing/views'
import {
  useDuration,
  usePosition,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/toolkit/hooks'
import { Artwork, ContextMenu, IconButton, MarqueeText, SaveToPlaylistPopover, Slider, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useSaveToPlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { serviceOf, useServiceState, type ArtworkProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { DesktopLyricsToggle } from './DesktopLyricsToggle.js'
import { useCurrentTrack } from '../hooks.js'

/**
 * Button on the bottom transport bar to open/toggle the queue panel.
 */
export function QueueButton({
  ctx,
  currentRoute,
}: {
  ctx: Context
  currentRoute?: string
}): ReactElement {
  const [activeRoute, setActiveRoute] = useState<string | undefined>(currentRoute)

  useEffect(() => {
    if (currentRoute !== undefined) {
      setActiveRoute(currentRoute)
    }
  }, [currentRoute])

  useEffect(() => {
    const off = ctx.on('ui/navigate', (id: string) => {
      setActiveRoute(id)
    })
    return () => void off()
  }, [ctx])

  const isQueueActive = activeRoute === 'queue.view'

  const handleClick = () => {
    ctx.ui?.navigate?.('queue.view')
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': '播放队列',
      title: '播放队列',
      'data-testid': 'queue-button',
      onClick: handleClick,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: tokens.radius.sm,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: isQueueActive ? 'var(--color-primary, #5F87FF)' : 'var(--border-subtle, rgba(145, 176, 255, 0.14))',
        background: isQueueActive ? 'var(--surface-selected, rgba(117, 152, 255, 0.12))' : 'transparent',
        color: isQueueActive ? 'var(--color-primary, #5F87FF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))',
        boxShadow: isQueueActive ? 'var(--glow-brand-sm, 0 0 12px rgba(117, 152, 255, 0.18))' : 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
        flexShrink: 0,
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isQueueActive ? 'var(--color-primary-hover, #91B0FF)' : 'var(--border-hover, rgba(145, 176, 255, 0.25))'
        e.currentTarget.style.color = isQueueActive ? 'var(--color-primary-hover, #91B0FF)' : 'var(--text-primary, #FFFFFF)'
        e.currentTarget.style.transform = 'scale(1.05)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isQueueActive ? 'var(--color-primary, #5F87FF)' : 'var(--border-subtle, rgba(145, 176, 255, 0.14))'
        e.currentTarget.style.color = isQueueActive ? 'var(--color-primary, #5F87FF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    tablerIcon('playlist', { size: 20 }),
  )
}

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 */
export function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

export const PLAY_MODE_INFO: Record<PlayMode, { label: string; next: string }> = {
  sequence: { label: '顺序播放', next: '切换为列表循环' },
  'list-loop': { label: '列表循环', next: '切换为单曲循环' },
  'single-loop': { label: '单曲循环', next: '切换为随机播放' },
  shuffle: { label: '随机播放', next: '切换为顺序播放' },
}

export function renderPlayModeIcon(mode: PlayMode): ReactElement {
  switch (mode) {
    case 'shuffle':
      return tablerIcon('shuffle', { size: 22 }) as ReactElement
    case 'single-loop':
      return tablerIcon('repeat-once', { size: 22 }) as ReactElement
    case 'list-loop':
      return tablerIcon('repeat', { size: 22 }) as ReactElement
    case 'sequence':
    default:
      return tablerIcon('list-numbers', { size: 22 }) as ReactElement
  }
}

export function renderVolumeIcon(volume: number, muted: boolean, size = 22): ReactElement {
  if (muted) {
    return tablerIcon('volume-off', { size }) as ReactElement
  }
  if (volume <= 0) {
    return tablerIcon('volume-3', { size }) as ReactElement
  }
  if (volume <= 0.33) {
    return tablerIcon('volume-3', { size }) as ReactElement
  }
  if (volume <= 0.66) {
    return tablerIcon('volume-2', { size }) as ReactElement
  }
  return tablerIcon('volume', { size }) as ReactElement
}

export function VerticalSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (val: number) => void
}): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)

  const updateFromPointer = (clientY: number) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = 1 - (clientY - rect.top) / rect.height
    const clamped = Math.max(0, Math.min(100, Math.round(ratio * 100)))
    onChange(clamped)
  }

  const handlePointerDown = (e: { clientY: number; preventDefault: () => void }) => {
    e.preventDefault()
    isDragging.current = true
    setDragging(true)
    updateFromPointer(e.clientY)

    const onPointerMove = (ev: MouseEvent) => {
      if (isDragging.current) {
        updateFromPointer(ev.clientY)
      }
    }
    const onPointerUp = () => {
      isDragging.current = false
      setDragging(false)
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
    }
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
  }

  const isInteracting = hovered || dragging

  return h(
    'div',
    {
      ref: trackRef,
      role: 'slider',
      tabIndex: 0,
      'aria-label': 'Vertical volume slider',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': value,
      'aria-orientation': 'vertical',
      onMouseDown: handlePointerDown,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault()
          onChange(Math.min(100, value + 5))
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault()
          onChange(Math.max(0, value - 5))
        }
      },
      style: {
        position: 'relative',
        width: 20,
        height: 100,
        display: 'flex',
        justifyContent: 'center',
        cursor: 'pointer',
        touchAction: 'none',
        outline: 'none',
      },
    },
    // Track rail
    h('div', {
      style: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 3,
        borderRadius: 1.5,
        backgroundColor: 'var(--border-default, rgba(255, 255, 255, 0.18))',
      },
    }),
    // Filled bar
    h('div', {
      style: {
        position: 'absolute',
        bottom: 0,
        width: 3,
        height: `${value}%`,
        borderRadius: 1.5,
        backgroundColor: isInteracting ? 'var(--color-primary, #5F87FF)' : 'var(--text-primary, #FFFFFF)',
      },
    }),
    // Thumb
    h('div', {
      style: {
        position: 'absolute',
        bottom: `calc(${value}% - 5px)`,
        width: 10,
        height: 10,
        borderRadius: '50%',
        backgroundColor: 'var(--text-primary, #FFFFFF)',
        boxShadow: 'var(--shadow-dropdown, 0 1px 4px rgba(0, 0, 0, 0.5))',
        opacity: isInteracting ? 1 : 0,
        transition: 'opacity 0.15s ease',
      },
    }),
  )
}

export function PlayModeButton({ ctx, mode }: { ctx: Context; mode?: PlayMode }): ReactElement {
  const currentMode = mode ?? 'sequence'
  const info = PLAY_MODE_INFO[currentMode] ?? PLAY_MODE_INFO.sequence
  const handleClick = () => {
    ctx.player.cyclePlayMode()
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': `播放模式: ${info.label}`,
      title: `${info.label} (${info.next})`,
      onClick: handleClick,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: tokens.radius.pill,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
        cursor: 'pointer',
        transition: 'color 0.15s ease, transform 0.15s ease',
        outline: 'none',
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
        e.currentTarget.style.transform = 'scale(1.1)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.7))'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    renderPlayModeIcon(currentMode),
  )
}

export function VolumeControl({
  ctx,
  volume,
  muted,
  portal = false,
}: {
  ctx: Context
  volume: number
  muted: boolean
  portal?: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null)

  const updateCoords = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setCoords({
        left: Math.round(rect.left + rect.width / 2),
        bottom: Math.round(window.innerHeight - rect.top + 8),
      })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    if (portal) {
      updateCoords()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        (containerRef.current && containerRef.current.contains(target)) ||
        (popoverRef.current && popoverRef.current.contains(target))
      ) {
        return
      }
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onResize = () => {
      if (portal) updateCoords()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, portal, updateCoords])

  const percent = Math.round(volume * 100)

  const popover = open
    ? h(
        'div',
        {
          ref: popoverRef,
          role: 'dialog',
          'aria-label': 'Volume control popover',
          style: {
            position: portal && coords ? 'fixed' : 'absolute',
            ...(portal && coords
              ? { left: coords.left, bottom: coords.bottom, transform: 'translateX(-50%)' }
              : { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 10 }),
            width: 44,
            padding: '10px 4px 8px',
            borderRadius: 10,
            backgroundColor: 'var(--surface-2, #111522)',
            border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.14))',
            boxShadow: 'var(--shadow-dropdown, 0 8px 24px rgba(0, 0, 0, 0.65))',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            zIndex: 1000,
          },
        },
        h(
          'span',
          { style: { fontSize: 11, color: 'var(--text-secondary, #A0A0AE)', userSelect: 'none', minHeight: 14 } },
          `${percent}%`,
        ),
        h(VerticalSlider, {
          value: percent,
          onChange: (val) => {
            if (muted) ctx.player.setMuted(false)
            ctx.player.setVolume(val / 100)
          },
        }),
        h(
          'button',
          {
            type: 'button',
            'aria-label': muted ? '恢复声音' : '静音',
            title: muted ? '恢复声音' : '静音',
            onClick: () => ctx.player.setMuted(!muted),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: tokens.radius.pill,
              border: 'none',
              background: muted ? 'var(--error-surface, rgba(239, 68, 68, 0.2))' : 'transparent',
              color: muted ? 'var(--error, #F87171)' : 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            },
          },
          renderVolumeIcon(volume, muted, 16),
        ),
      )
    : null

  const trigger = h(
    'div',
    {
      ref: containerRef,
      style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
    },
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Volume',
        title: muted ? '已静音 (点击展开调节栏)' : `音量 ${percent}% (点击展开调节栏)`,
        onClick: () => setOpen((prev) => !prev),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: tokens.radius.pill,
          border: 'none',
          background: open ? 'var(--surface-hover, rgba(255, 255, 255, 0.12))' : 'transparent',
          color: muted ? 'var(--text-muted, #A0A0AE)' : 'var(--text-secondary, rgba(255, 255, 255, 0.8))',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          outline: 'none',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
          e.currentTarget.style.transform = 'scale(1.1)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.color = muted ? 'var(--text-muted, #A0A0AE)' : 'var(--text-secondary, rgba(255, 255, 255, 0.8))'
          e.currentTarget.style.transform = 'scale(1)'
        },
      },
      renderVolumeIcon(volume, muted),
    ),
    !portal ? popover : null,
  )

  if (portal && typeof document !== 'undefined' && popover) {
    return h(Fragment, null, trigger, createPortal(popover, document.body))
  }

  return trigger
}

export interface NowPlayingBarProps {
  ctx: Context
  currentRoute?: string
  onOpenNowPlaying?: () => void
  /**
   * Render the context menu / popover through a portal. Required when the bar
   * floats over the fullscreen play page: the hover container's `overflow`
   * and the footer's slide `transform` would clip or re-anchor fixed menus.
   */
  portalMenus?: boolean
}

/** The persistent transport bar. Desktop's answer to "now playing". */
export function NowPlayingBar({ ctx, currentRoute, onOpenNowPlaying, portalMenus }: NowPlayingBarProps): ReactElement {
  const [coverHovered, setCoverHovered] = useState(false)
  const [seekingPosition, setSeekingPosition] = useState<number | undefined>(undefined)
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)
  const displayPosition = seekingPosition ?? position

  const menu = useTrackMenu(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)
  const [isInLibrary, setIsInLibrary] = useState(false)

  const currentTrack = useCurrentTrack(ctx)

  const actionSlots = useServiceState(
    ctx,
    ['ui/changed'],
    () => {
      const ui = serviceOf<UiService>(ctx, 'ui')
      return ui?.slotsFor?.('now-playing.actions') ?? []
    },
    { isEqual: (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i]?.id) },
  )

  useEffect(() => {
    if (!state.trackUrn) {
      setIsInLibrary(false)
      return
    }
    const library = serviceOf<LibraryService>(ctx, 'library')
    let cancelled = false
    const check = () => {
      if (library && typeof library.isSaved === 'function') {
        library
          .isSaved(state.trackUrn!)
          .then((saved) => {
            if (!cancelled) {
              setIsInLibrary(saved || Boolean(currentTrack?.loved))
            }
          })
          .catch(() => {
            if (!cancelled) {
              setIsInLibrary(Boolean(currentTrack?.loved))
            }
          })
      } else {
        setIsInLibrary(Boolean(currentTrack?.loved))
      }
    }

    check()
    const off = ctx.on('library/changed', () => {
      check()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, state.trackUrn, currentTrack?.loved])

  const handleAddToFavorites = useCallback(
    async (track: Track) => {
      setIsInLibrary(true)
      const library = serviceOf<LibraryService>(ctx, 'library')
      const sources = serviceOf<SourcesService>(ctx, 'sources')
      if (library) {
        await library.setSaved(track.urn, true).catch(() => {})
      }
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, true).catch(() => {})
      }
    },
    [ctx],
  )

  const handleOpenNowPlaying = () => {
    onOpenNowPlaying?.()
    ctx.ui?.navigate?.(NOW_PLAYING_VIEWS.nowPlaying)
  }

  return h(
    'div',
    {
      role: 'region',
      'aria-label': 'Now playing',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[4],
        padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
        border: 'none',
        borderTop: 'none',
        borderBottom: 'none',
        margin: 0,
        outline: 'none',
        boxShadow: 'none',
        background: 'var(--player-bg, var(--bg-app, #05060B))',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[3],
          width: 240,
          minWidth: 180,
          overflow: 'hidden',
        },
      },
      h(
        'div',
        {
          role: 'button',
          tabIndex: 0,
          'aria-label': 'Open now playing',
          onClick: handleOpenNowPlaying,
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault()
            if (currentTrack) {
              menu.open({ track: currentTrack }, { x: e.clientX, y: e.clientY })
            }
          },
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleOpenNowPlaying()
            }
          },
          onMouseEnter: () => setCoverHovered(true),
          onMouseLeave: () => setCoverHovered(false),
          style: {
            position: 'relative',
            width: tokens.size.artworkThumb,
            height: tokens.size.artworkThumb,
            borderRadius: tokens.radius.sm,
            overflow: 'hidden',
            cursor: 'pointer',
            flexShrink: 0,
          },
        },
        h(CachedArtwork, {
          ctx,
          artwork: state.nowPlaying?.artwork,
          seed: state.trackUrn,
          size: tokens.size.artworkThumb,
          radius: tokens.radius.sm,
        }),
        h(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.5)',
              color: '#FFFFFF',
              opacity: coverHovered ? 1 : 0,
              transition: `opacity ${tokens.duration.fast}ms ease`,
              pointerEvents: 'none',
            },
          },
          tablerIcon('maximize', { size: 22, color: 'currentColor' }),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
            },
          },
          // 歌名被压缩时走马灯滚动，而不是省略号截断。
          h(MarqueeText, {
            variant: 'sm',
            style: { flex: 1, minWidth: 0 },
            children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
          }),
          currentTrack
            ? h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'track-library-action-btn',
                  'aria-label': isInLibrary
                    ? `Add ${currentTrack.title} to playlist`
                    : `Add ${currentTrack.title} to favourites`,
                  title: isInLibrary ? '加入歌单' : '加入最喜欢的音乐',
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation()
                    if (isInLibrary) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      saveToPlaylistMenu.open(currentTrack, { x: rect.left, y: rect.bottom + 4 })
                    } else {
                      void handleAddToFavorites(currentTrack)
                    }
                  },
                  style: {
                    background: 'none',
                    border: 'none',
                    color: isInLibrary ? 'var(--color-primary, #5F87FF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'color 0.15s ease, transform 0.15s ease',
                  },
                  onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.color = isInLibrary ? 'var(--color-primary-hover, #91B0FF)' : 'var(--text-primary, #FFFFFF)'
                    e.currentTarget.style.transform = 'scale(1.15)'
                  },
                  onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.color = isInLibrary ? 'var(--color-primary, #5F87FF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))'
                    e.currentTarget.style.transform = 'scale(1)'
                  },
                },
                isInLibrary
                  ? tablerIcon('heart-filled', { size: 16 })
                  : tablerIcon('plus', { size: 16 }),
              )
            : null,
        ),
        state.nowPlaying?.artist
          ? h(MarqueeText, {
              variant: 'xs',
              tone: 'muted',
              children: state.nowPlaying.artist,
            })
          : null,
      ),
    ),
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space[1],
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
        h(PlayModeButton, { ctx, mode: state.playMode }),
        h(IconButton, {
          icon: 'skip-back',
          accessibilityLabel: 'Previous track',
          disabled: !can.canPrevious,
          onPress: () => void ctx.player.previous(),
        }),
        h(IconButton, {
          // One control, two states: a play button that is sometimes a pause
          // button is what every player has, and two controls would be wrong.
          icon: can.canPause ? 'pause-filled' : 'play-filled',
          accessibilityLabel: can.canPause ? 'Pause' : 'Play',
          variant: 'primary',
          disabled: !can.canPlay && !can.canPause,
          onPress: () => ctx.player.togglePlay(),
        }),
        h(IconButton, {
          icon: 'skip-forward',
          accessibilityLabel: 'Next track',
          disabled: !can.canNext,
          onPress: () => void ctx.player.next(),
        }),
        h(VolumeControl, { ctx, volume: state.volume, muted: state.muted, portal: portalMenus }),
      ),
      h(
        'div',
        {
          style: {
            width: '100%',
            maxWidth: 560,
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
          },
        },
        // `stalled` is not `paused`: the UI says buffering and the lock screen
        // keeps reporting playing, so neither flickers on an underrun.
        // The slot keeps its width whether or not the label is showing, so the
        // scrubber never resizes when buffering starts and ends.
        h(
          'span',
          {
            style: {
              width: 64,
              flexShrink: 0,
              display: 'inline-block',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            },
          },
          state.status === 'stalled'
            ? h(Text, { variant: 'xs', tone: 'muted', children: 'Buffering…' })
            : null,
        ),
        h(
          'span',
          { style: { minWidth: 36, textAlign: 'right', display: 'inline-block' } },
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            children: formatDuration(displayPosition),
          }),
        ),
        h(Slider, {
          value: duration ? Math.min(displayPosition, duration) : 0,
          max: duration ?? 0,
          disabled: !can.canSeek || !duration,
          accessibilityLabel: 'Seek',
          onChange: (value: number) => setSeekingPosition(value),
          onCommit: (value: number) => {
            setSeekingPosition(undefined)
            void ctx.player.seek(value)
          },
        }),
        h(
          'span',
          { style: { minWidth: 36, display: 'inline-block' } },
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            children: formatDuration(duration),
          }),
        ),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: tokens.space[2],
          width: 240,
          minWidth: 180,
        },
      },
      ...(() => {
        const ui = serviceOf<UiService>(ctx, 'ui')
        const seenSlotIds = new Set<string>()
        const items = actionSlots
          .filter((slot) => !slot.when || slot.when({ ctx, currentRoute }))
          .filter((slot) => {
            if (seenSlotIds.has(slot.id)) return false
            seenSlotIds.add(slot.id)
            return true
          })
          .map((slot) => {
            const Component = ui?.viewFor?.(slot.id) as
              | React.ComponentType<{ ctx: Context; currentRoute?: string }>
              | undefined
            return Component ? h(Component, { key: slot.id, ctx, currentRoute }) : null
          })
          .filter(Boolean)

        if (items.length > 0) {
          return items
        }

        // Fallback when no actions are contributed (e.g. isolated test environments)
        const fallbackItems: ReactElement[] = []
        const MiniPlayerBtn = ui?.viewFor?.('mini-player.button') as
          | React.ComponentType<{ ctx: Context }>
          | undefined
        if (MiniPlayerBtn) {
          fallbackItems.push(h(MiniPlayerBtn, { key: 'mini-player.button', ctx }))
        }
        fallbackItems.push(h(DesktopLyricsToggle, { key: 'desktop-lyrics.toggle', ctx }))
        fallbackItems.push(h(QueueButton, { key: 'queue.button', ctx, currentRoute }))
        return fallbackItems
      })(),
    ),
    h(ContextMenu, { ...menu.menuProps, portal: portalMenus }),
    h(SaveToPlaylistPopover, { ...saveToPlaylistMenu.menuProps, portal: portalMenus }),
  )
}
