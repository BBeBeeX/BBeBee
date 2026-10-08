/**
 * Spotify-style in-app TopBar for the Desktop Electron Shell.
 *
 * Replaces the native OS window frame and menu bar:
 * - Left: Brand logo, History Back (←), History Forward (→)
 * - Center: Search Bar (collapses to a magnifier button when the window is
 *   too narrow; clicking it expands the search and hides the tray/profile
 *   icons until the user clicks elsewhere)
 * - Right: Avatar, Connected Window Controls (Minimize, Maximize/Restore, Close)
 *
 * Drag region is applied to the bar container (-webkit-app-region: drag),
 * while interactive controls opt out with no-drag.
 */

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SleepTimerMode, SleepTimerService, TrayContribution } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useSearchSourceSelection, type SearchInterfaceKind } from '@BBeBee/plugin-sources/hooks'
import { useSleepTimer } from '@BBeBee/plugin-sleep-timer/hooks'
import logoWhiteUrl from './assets/logo-white.png'

function serviceOf<T = unknown>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { reflect?: { get(key: string, required: boolean): unknown } }).reflect?.get?.(
    key,
    false,
  ) as T | undefined
}

/** Center-group width below which the search box collapses to a magnifier button. */
const SEARCH_COLLAPSE_WIDTH = 180

export interface ElectronCSSProperties extends CSSProperties {
  WebkitAppRegion?: 'drag' | 'no-drag'
}

export interface WindowControlsProps {
  style?: CSSProperties
}

function formatSleepTimerRemaining(targetEpochMs?: number, mode?: SleepTimerMode): string {
  if (mode === 'end-of-track') {
    return '播完本曲'
  }
  if (!targetEpochMs) return '运行中'
  const diffMs = Math.max(0, targetEpochMs - Date.now())
  const totalSeconds = Math.ceil(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remMin = minutes % 60
    return `${hours}小时${remMin}分钟`
  }
  if (minutes > 0) {
    return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
  }
  return `${seconds}秒`
}

export function SleepTimerIndicator({ ctx }: { ctx: Context }): ReactElement | null {
  const timerState = useSleepTimer(ctx)
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [, setTick] = useState(0)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!timerState.active) return
    const timer = setInterval(() => {
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [timerState.active])

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!pinned) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPinned(false)
        setHovered(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false)
        setHovered(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [pinned])

  if (!timerState.active) return null

  const remainingText = formatSleepTimerRemaining(timerState.targetEpochMs, timerState.mode)

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setHovered(true)
  }

  const handleMouseLeave = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    closeTimeoutRef.current = setTimeout(() => {
      setHovered(false)
      closeTimeoutRef.current = null
    }, 350)
  }

  const handleClickIndicator = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    setPinned((p) => !p)
  }

  const handleCancel = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setPinned(false)
    setHovered(false)
    serviceOf<SleepTimerService>(ctx, 'sleepTimer')?.cancel?.()
  }

  const showPopover = hovered || pinned

  return h(
    'div',
    {
      ref: containerRef,
      'data-testid': 'topbar-sleep-timer-container',
      style: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        WebkitAppRegion: 'no-drag' as unknown as undefined,
      },
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onMouseOver: handleMouseEnter,
    },
    h(
      'button',
      {
        type: 'button',
        'aria-label': `睡眠定时器：${remainingText}，点击查看详情`,
        title: `睡眠定时器：${remainingText}（点击查看详情）`,
        'data-testid': 'topbar-sleep-timer-indicator',
        onClick: handleClickIndicator,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 16,
          border: '1px solid var(--color-primary, #5F87FF)',
          background: 'var(--surface-selected, rgba(95, 135, 255, 0.15))',
          color: 'var(--color-primary, #5F87FF)',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          transition: 'all 0.15s ease',
          outline: 'none',
          boxShadow: 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.25))',
        },
      },
      tablerIcon('alarm', { size: 16 }),
      h('span', { style: { fontSize: 11, fontVariantNumeric: 'tabular-nums' } }, remainingText),
    ),
    showPopover
      ? h(
          'div',
          {
            'data-testid': 'sleep-timer-popover',
            style: {
              position: 'absolute',
              top: '100%',
              right: 0,
              paddingTop: 8,
              zIndex: 1000,
            },
          },
          h(
            'div',
            {
              style: {
                minWidth: 200,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--surface-2, #141824)',
                border: '1px solid var(--border-default, rgba(145, 176, 255, 0.18))',
                boxShadow: 'var(--shadow-dropdown, 0 12px 30px rgba(0, 0, 0, 0.6))',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                backdropFilter: 'blur(16px)',
                pointerEvents: 'auto',
              },
            },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--text-primary, #FFFFFF)',
                  fontWeight: 600,
                  fontSize: 13,
                },
              },
              tablerIcon('alarm', { size: 16, color: 'var(--color-primary, #5F87FF)' }),
              '睡眠定时器运行中',
            ),
            h(
              'div',
              {
                style: {
                  fontSize: 12,
                  color: 'var(--text-secondary, #C5CAD8)',
                  lineHeight: 1.4,
                },
              },
              timerState.mode === 'end-of-track'
                ? '将在本曲播放完毕后自动停止播放。'
                : '距离自动停止播放还剩：',
              timerState.mode !== 'end-of-track'
                ? h(
                    'div',
                    {
                      style: {
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--color-primary, #5F87FF)',
                        marginTop: 2,
                        fontVariantNumeric: 'tabular-nums',
                      },
                    },
                    remainingText,
                  )
                : null,
            ),
            h(
              'button',
              {
                type: 'button',
                'data-testid': 'cancel-sleep-timer-button',
                onClick: handleCancel,
                style: {
                  marginTop: 4,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--error, #FF6B6B)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.25)'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'
                },
              },
              tablerIcon('x', { size: 14 }),
              '取消定时器',
            ),
          ),
        )
      : null,
  )
}

export function TrayIndicator({ ctx }: { ctx: Context }): ReactElement {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const readTray = (): readonly TrayContribution[] => {
    try {
      const list = ctx.ui?.tray ?? []
      return list.filter((item) => (item.when ? item.when({}) : true))
    } catch {
      return []
    }
  }

  const [items, setItems] = useState<readonly TrayContribution[]>(readTray)

  const [updatesAvailable, setUpdatesAvailable] = useState(false)

  useEffect(() => {
    const off = ctx.on('registry/updates-available', (updates: readonly unknown[]) => {
      setUpdatesAvailable(Array.isArray(updates) && updates.length > 0)
    })
    return () => void off()
  }, [ctx])

  useEffect(() => {
    setItems(readTray())
    const off = ctx.on('ui/changed', () => {
      setItems(readTray())
    })
    return () => void off()
  }, [ctx])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return h(
    'div',
    {
      ref: containerRef,
      style: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      },
    },
    h(
      'button',
      {
        type: 'button',
        'aria-label': '应用托盘',
        title: open ? '收起插件托盘' : '展开插件托盘',
        'data-testid': 'topbar-tray-button',
        onClick: () => setOpen((prev) => !prev),
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: open
            ? '1px solid var(--accent, #6366F1)'
            : '1px solid var(--border-subtle, rgba(148, 163, 184, 0.15))',
          background: open
            ? 'var(--surface-selected, rgba(99, 102, 241, 0.15))'
            : 'var(--surface-1, rgba(255, 255, 255, 0.06))',
          color: open ? 'var(--accent, #818CF8)' : 'var(--text-primary, #F5F7FF)',
          cursor: 'pointer',
          padding: 0,
          transition: 'transform 0.15s ease, background 0.15s ease, border-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.transform = 'scale(1.06)'
          if (!open) e.currentTarget.style.background = 'var(--surface-hover, rgba(255, 255, 255, 0.12))'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.transform = 'scale(1)'
          if (!open) e.currentTarget.style.background = 'var(--surface-1, rgba(255, 255, 255, 0.06))'
        },
      },
      tablerIcon(open ? 'chevron-up' : 'chevron-down', { size: 18 }),
      updatesAvailable
        ? h('span', {
            'data-testid': 'topbar-tray-update-dot',
            style: {
              position: 'absolute',
              top: 2,
              right: 2,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#EF4444',
              boxShadow: '0 0 0 2px var(--bg-app, #0D0E15)',
            },
          })
        : null,
    ),
    open
      ? h(
          'div',
          {
            'data-testid': 'topbar-tray-popover',
            style: {
              position: 'absolute',
              top: 'calc(100% + 10px)',
              right: 0,
              minWidth: 180,
              maxWidth: 280,
              background: 'var(--bb-bg-overlay, var(--surface-2, rgba(18, 22, 34, 0.96)))',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.2))',
              borderRadius: 12,
              boxShadow: 'var(--shadow-dropdown, 0 12px 32px rgba(0, 0, 0, 0.2)), 0 0 0 1px var(--border-subtle, rgba(255, 255, 255, 0.05))',
              padding: '10px 10px',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 4px 6px 4px',
                borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.07))',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
                letterSpacing: '0.04em',
              },
            },
            h('span', null, '插件托盘'),
            h(
              'span',
              {
                style: {
                  fontSize: 10,
                  color: 'var(--text-tertiary, rgba(255, 255, 255, 0.4))',
                  background: 'var(--surface-hover, rgba(255, 255, 255, 0.06))',
                  padding: '1px 6px',
                  borderRadius: 8,
                },
              },
              `${items.length}`,
            ),
          ),
          items.length === 0
            ? h(
                'div',
                {
                  'data-testid': 'topbar-tray-empty',
                  style: {
                    padding: '16px 8px',
                    fontSize: 12,
                    color: 'var(--text-muted, rgba(255, 255, 255, 0.4))',
                    textAlign: 'center',
                  },
                },
                '暂无托盘插件',
              )
            : h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))',
                    gap: 6,
                  },
                },
                ...items.map((item) =>
                  h(
                    'button',
                    {
                      key: item.id,
                      type: 'button',
                      'data-testid': `topbar-tray-item-${item.id}`,
                      title: item.title,
                      'aria-label': item.title,
                      onClick: () => {
                        setOpen(false)
                        if (item.action) {
                          void item.action()
                        } else {
                          ctx.ui?.navigate?.(item.targetRoute ?? item.id)
                        }
                      },
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                        background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
                        color: 'var(--text-primary, #F5F7FF)',
                        cursor: 'pointer',
                        padding: 0,
                        transition: 'background 0.15s ease, transform 0.12s ease, border-color 0.15s ease',
                        position: 'relative',
                      },
                      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                        e.currentTarget.style.background = 'var(--surface-hover, rgba(255, 255, 255, 0.12))'
                        e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.2))'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      },
                      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                        e.currentTarget.style.background = 'var(--surface-1, rgba(255, 255, 255, 0.04))'
                        e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255, 255, 255, 0.06))'
                        e.currentTarget.style.transform = 'translateY(0)'
                      },
                    },
                    item.icon ? tablerIcon(item.icon, { size: 22 }) : tablerIcon('cube', { size: 22 }),
                    updatesAvailable &&
                    (item.id === 'registry.screen' ||
                      item.id === '/registry' ||
                      item.targetRoute === 'registry.screen' ||
                      item.targetRoute === '/registry')
                      ? h('span', {
                          'data-testid': 'topbar-tray-item-update-dot',
                          style: {
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#EF4444',
                          },
                        })
                      : null,
                  ),
                ),
              ),
        )
      : null,
  )
}

export function WindowControls({ style }: WindowControlsProps = {}): ReactElement {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Read initial maximized state if available
    void window.BBeBee?.window?.isMaximized?.().then((max) => {
      if (typeof max === 'boolean') setIsMaximized(max)
    })
  }, [])

  const handleMinimize = () => {
    void window.BBeBee?.window?.minimize?.()
  }

  const handleMaximize = () => {
    void window.BBeBee?.window?.maximize?.().then(() => {
      setIsMaximized((prev) => !prev)
    })
  }

  const handleClose = () => {
    void window.BBeBee?.window?.close?.()
  }

  return h(
    'div',
    {
      role: 'group',
      'aria-label': 'Window controls',
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 48,
        flexShrink: 0,
        WebkitAppRegion: 'no-drag',
        ...style,
      } as ElectronCSSProperties,
    },
    // Minimize Button (−)
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Minimize window',
        title: 'Minimize',
        onClick: handleMinimize,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 48,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-tertiary, #8B92A6)',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.1))'
          e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-tertiary, #8B92A6)'
        },
      },
      tablerIcon('minus', { size: 18 }),
    ),
    // Maximize / Restore Button (□ / ❐)
    h(
      'button',
      {
        type: 'button',
        'aria-label': isMaximized ? 'Restore window' : 'Maximize window',
        title: isMaximized ? 'Restore' : 'Maximize',
        onClick: handleMaximize,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 48,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-tertiary, #8B92A6)',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.1))'
          e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-tertiary, #8B92A6)'
        },
      },
      isMaximized
        ? tablerIcon('copy', { size: 17 })
        : tablerIcon('square', { size: 17 }),
    ),
    // Close Button (✕)
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Close window',
        title: 'Close',
        onClick: handleClose,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 48,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-tertiary, #8B92A6)',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = '#E81123'
          e.currentTarget.style.color = '#FFFFFF'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-tertiary, #8B92A6)'
        },
      },
      tablerIcon('x', { size: 18 }),
    ),
  )
}

export interface TopBarProps {
  ctx: Context
  onHome?: () => void
  onSearch?: (
    query: string,
    opts?: {
      sourceIds?: readonly string[]
      typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
    },
  ) => void
  onOpenSettings?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
}

export function TopBar({
  ctx,
  onHome,
  onSearch,
  onOpenSettings,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
}: TopBarProps): ReactElement {
  const selection = useSearchSourceSelection(ctx)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)

  /**
   * When the bar is squeezed, the search box collapses to a single magnifier
   * button; clicking it expands the search across the bar while the tray and
   * profile icons step aside (the window controls never do). Clicking
   * anywhere outside the search restores the collapsed state.
   */
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [centerWidth, setCenterWidth] = useState(0)
  const [centerMeasured, setCenterMeasured] = useState(false)
  const centerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = centerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCenterWidth(entry.contentRect.width)
        setCenterMeasured(true)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Before the first measurement (e.g. jsdom) the full search bar renders.
  // A real measurement of 0 is the bar squeezed flat — that IS collapsed.
  const searchCollapsed = centerMeasured && centerWidth < SEARCH_COLLAPSE_WIDTH && !searchExpanded

  // Collapsing unmounts the input; drop the active state with it so no
  // outside-click handler is left waiting on a container that is gone.
  useEffect(() => {
    if (searchCollapsed && searchActive) {
      setSearchActive(false)
    }
  }, [searchCollapsed, searchActive])

  useEffect(() => {
    if (!searchExpanded) return
    const input = searchContainerRef.current?.querySelector('input')
    input?.focus()
  }, [searchExpanded])

  useEffect(() => {
    if (!searchExpanded) return
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchExpanded(false)
        setSearchActive(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchExpanded(false)
        setSearchActive(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [searchExpanded])

  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage?.getItem('bbebee_search_history') : null
      return stored ? (JSON.parse(stored) as string[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (!searchActive) return
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchActive(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchActive(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [searchActive])

  const handleCommitSearch = (rawQuery: string) => {
    const trimmed = rawQuery.trim()
    if (!trimmed) return
    const nextHistory = [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, 10)
    setHistory(nextHistory)
    try {
      window.localStorage?.setItem('bbebee_search_history', JSON.stringify(nextHistory))
    } catch {
      // ignore storage errors
    }
    setSearchActive(false)
    setSearchExpanded(false)
    onSearch?.(trimmed, {
      sourceIds: selection.selectedIds,
      typesBySource: selection.typesBySource,
    })
  }

  const handleClearHistory = () => {
    setHistory([])
    try {
      window.localStorage?.removeItem('bbebee_search_history')
    } catch {
      // ignore storage errors
    }
  }

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else if (typeof window !== 'undefined' && window.history) {
      window.history.back()
    }
  }

  const handleForward = () => {
    if (onForward) {
      onForward()
    } else if (typeof window !== 'undefined' && window.history) {
      window.history.forward()
    }
  }

  const noDragStyle: ElectronCSSProperties = {
    WebkitAppRegion: 'no-drag',
  }

  return h(
    'header',
    {
      role: 'banner',
      'aria-label': 'Application Header',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
        minHeight: 48,
        maxHeight: 48,
        flexShrink: 0,
        paddingLeft: 12,
        paddingRight: 0,
        background: 'transparent',
        borderBottom: 'none',
        userSelect: 'none',
        WebkitAppRegion: 'drag',
        position: 'relative',
        zIndex: 50,
      } as ElectronCSSProperties,
    },
    // Left Group: Logo, Back (←), Forward (→) — never compressed; the
    // center search absorbs all squeezing.
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          ...noDragStyle,
        },
      },
      // Brand Logo (BBeBee)
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'BBeBee Home',
          title: 'BBeBee',
          onClick: onHome,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, opacity 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.transform = 'scale(1.08)'
            e.currentTarget.style.opacity = '0.85'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.opacity = '1'
          },
        },
        h('img', {
          src: logoWhiteUrl,
          alt: 'BBeBee',
          width: 22,
          height: 22,
          style: {
            display: 'block',
            objectFit: 'contain',
            filter: 'var(--logo-filter, none)',
          },
        }),
      ),
      // Back Button (←)
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'Go back',
          title: 'Back',
          disabled: !canGoBack,
          onClick: handleBack,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: canGoBack ? 'var(--text-tertiary, #8B92A6)' : 'var(--text-disabled, #41485B)',
            cursor: canGoBack ? 'pointer' : 'default',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            if (canGoBack) {
              e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.08))'
              e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
            }
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            if (canGoBack) {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = 'var(--text-tertiary, #8B92A6)'
            }
          },
        },
        tablerIcon('chevron-left', { size: 20 }),
      ),
      // Forward Button (→)
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'Go forward',
          title: 'Forward',
          disabled: !canGoForward,
          onClick: handleForward,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: canGoForward ? 'var(--text-tertiary, #8B92A6)' : 'var(--text-disabled, #41485B)',
            cursor: canGoForward ? 'pointer' : 'default',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            if (canGoForward) {
              e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.08))'
              e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
            }
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            if (canGoForward) {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = 'var(--text-tertiary, #8B92A6)'
            }
          },
        },
        tablerIcon('chevron-right', { size: 20 }),
      ),
    ),
    // Center Group: Search Bar. Measured so the search can collapse to a
    // magnifier button once the window squeezes it too far; while expanded it
    // takes the whole space between the left group and the window controls.
    h(
      'div',
      {
        ref: centerRef,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flex: 1,
          justifyContent: 'center',
          maxWidth: searchExpanded ? 'none' : 360,
          minWidth: 0,
          ...noDragStyle,
        },
      },
      // Collapsed: one magnifier button. Clicking expands the search (and
      // hides the tray/profile icons until a click elsewhere restores them).
      searchCollapsed
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': 'Expand search',
              title: '搜索',
              'data-testid': 'topbar-search-collapsed-button',
              onClick: () => {
                setSearchExpanded(true)
                setSearchActive(true)
              },
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                background: 'var(--input-bg, var(--surface-1, #080D1A))',
                color: 'var(--text-tertiary, #8B92A6)',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'var(--surface-hover, #101831)'
                e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'var(--input-bg, var(--surface-1, #080D1A))'
                e.currentTarget.style.color = 'var(--text-tertiary, #8B92A6)'
              },
            },
            tablerIcon('search', { size: 20 }),
          )
        : // Search Bar Container with Dropdown
      h(
        'div',
        {
          ref: searchContainerRef,
          style: {
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            height: 36,
            borderRadius: 9999,
            background: searchActive ? 'var(--input-bg, var(--surface-hover, #101831))' : 'var(--input-bg, var(--surface-1, #080D1A))',
            border: searchActive ? '1px solid var(--input-focus-border, var(--border-focus, #5F87FF))' : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
            boxShadow: searchActive ? 'var(--glow-blue-xs, var(--glow-xs, 0 0 12px rgba(95,135,255,0.2)))' : 'none',
            paddingLeft: searchActive ? 14 : 12,
            paddingRight: searchActive ? 6 : 10,
            gap: 8,
            transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
          },
        },
        // When not active: Search icon at far left
        !searchActive
          ? tablerIcon('search', {
              size: 20,
              color: 'var(--text-tertiary, #8B92A6)',
              style: { pointerEvents: 'none' },
            })
          : null,
        // Search input
        h('input', {
          type: 'text',
          'aria-label': 'Search',
          placeholder: 'What do you want to play?',
          value: searchQuery,
          onChange: (e: { target: { value: string } }) => {
            setSearchQuery(e.target.value)
          },
          onFocus: () => setSearchActive(true),
          onClick: () => setSearchActive(true),
          onKeyDown: (e: { key: string; currentTarget: HTMLInputElement }) => {
            if (e.key === 'Enter') {
              handleCommitSearch(e.currentTarget.value || searchQuery)
            }
          },
          style: {
            flex: 1,
            minWidth: 0,
            height: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary, #F5F7FF)',
            fontSize: 13,
          },
        }),
        // Clear query button
        searchQuery
          ? h(
              'button',
              {
                type: 'button',
                'aria-label': 'Clear search',
                onClick: (e: { stopPropagation: () => void }) => {
                  e.stopPropagation()
                  setSearchQuery('')
                },
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary, #8B92A6)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                },
              },
              tablerIcon('x', { size: 18 }),
            )
          : null,
        // When active: Search icon jumps to the far right as a clickable action button
        searchActive
          ? h(
              'button',
              {
                type: 'button',
                'aria-label': 'Submit search',
                title: 'Search',
                onClick: (e: { stopPropagation: () => void }) => {
                  e.stopPropagation()
                  const currentVal = (searchContainerRef.current?.querySelector('input') as HTMLInputElement)?.value
                  handleCommitSearch(currentVal || searchQuery)
                },
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--surface-hover, rgba(255, 255, 255, 0.12))',
                  color: 'var(--text-primary, #F5F7FF)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background-color 0.15s ease, transform 0.15s ease',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-active, rgba(255, 255, 255, 0.22))'
                  e.currentTarget.style.transform = 'scale(1.05)'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.12))'
                  e.currentTarget.style.transform = 'scale(1)'
                },
              },
              tablerIcon('search', { size: 19 }),
            )
          : null,
        // 2×2 Matrix Dropdown Float
        searchActive
          ? h(
              'div',
              {
                'data-testid': 'search-matrix-panel',
                style: {
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  minWidth: 420,
                  background: 'var(--surface-2, #111522)',
                  borderRadius: 12,
                  border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.08))',
                  boxShadow: 'var(--shadow-modal, 0 16px 36px rgba(0, 0, 0, 0.65))',
                  backdropFilter: 'blur(16px)',
                  padding: 16,
                  zIndex: 200,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  columnGap: 20,
                  rowGap: 12,
                },
              },
              // Row 1 Left (1, 1): 搜索范围
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-secondary, #C5CAD8)',
                    letterSpacing: 0.5,
                  },
                },
                '搜索范围',
              ),
              // Row 1 Right (1, 2): 搜索历史 + 清空
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-secondary, #C5CAD8)',
                    letterSpacing: 0.5,
                  },
                },
                h('span', null, '搜索历史'),
                history.length > 0
                  ? h(
                      'button',
                      {
                        type: 'button',
                        'aria-label': '清空搜索历史',
                        onClick: (e: { stopPropagation: () => void }) => {
                          e.stopPropagation()
                          handleClearHistory()
                        },
                        style: {
                          background: 'transparent',
                          border: 'none',
                          padding: '2px 6px',
                          fontSize: 11,
                          color: 'var(--text-muted, #626A80)',
                          cursor: 'pointer',
                          borderRadius: 4,
                          transition: 'color 0.15s ease',
                        },
                        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                          e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
                        },
                        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                          e.currentTarget.style.color = 'var(--text-muted, #626A80)'
                        },
                      },
                      '清空',
                    )
                  : null,
              ),
              // Row 2 Left (2, 1): 第三方源 toggle button
              h(
                'div',
                {
                  role: 'group',
                  'aria-label': '第三方搜索源选择',
                  style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'flex-start',
                    maxHeight: 180,
                    overflowY: 'auto',
                  },
                },
                selection.interfaces.length === 0
                  ? h(
                      'span',
                      { style: { fontSize: 12, color: 'var(--text-muted, #626A80)', padding: '4px 0' } },
                      '暂无第三方搜索源',
                    )
                  : [
                      ...selection.interfaces.map((iface) => {
                        const selected = selection.isInterfaceSelected(iface.id)
                        const disabled = !iface.searchable
                        const label = `${iface.sourceName} · ${iface.kind === 'track' ? '单曲' : '歌手'}`
                        return h(
                          'button',
                          {
                            key: iface.id,
                            type: 'button',
                            disabled,
                            'aria-pressed': selected,
                            'data-testid': `search-source-toggle-${iface.id}`,
                            onClick: (e: { stopPropagation: () => void }) => {
                              e.stopPropagation()
                              if (!disabled) selection.toggleInterface(iface.id)
                            },
                            style: {
                              minHeight: 24,
                              padding: '2px 10px',
                              borderRadius: 9999,
                              borderWidth: 1,
                              borderStyle: 'solid',
                              borderColor: selected ? 'transparent' : 'var(--border-subtle, rgba(255, 255, 255, 0.12))',
                              background: selected ? 'var(--button-primary-bg, var(--color-primary, #5F87FF))' : 'var(--surface-1, #080D1A)',
                              color: selected
                                ? 'var(--text-primary, #F5F7FF)'
                                : disabled
                                  ? 'var(--text-disabled, #41485B)'
                                  : 'var(--text-secondary, #C5CAD8)',
                              boxShadow: selected ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.35))' : 'none',
                              fontSize: 11,
                              fontWeight: selected ? 700 : 500,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              opacity: disabled ? 0.5 : 1,
                              transition: 'all 0.15s ease',
                            },
                            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                              if (!disabled) {
                                if (selected) {
                                  e.currentTarget.style.backgroundColor = 'var(--color-primary-hover, #7C86FF)'
                                } else {
                                  e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.25))'
                                  e.currentTarget.style.color = 'var(--text-primary, #F5F7FF)'
                                }
                              }
                            },
                            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                              if (!disabled) {
                                if (selected) {
                                  e.currentTarget.style.background = 'var(--button-primary-bg, var(--color-primary, #5F87FF))'
                                } else {
                                  e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255, 255, 255, 0.12))'
                                  e.currentTarget.style.color = 'var(--text-secondary, #C5CAD8)'
                                }
                              }
                            },
                          },
                          label,
                        )
                      }),
                      selection.interfaces.some((iface) => iface.searchable)
                        ? h(
                            'button',
                            {
                              key: 'toggle-all',
                              type: 'button',
                              'data-testid': 'search-source-toggle-all',
                              onClick: (e: { stopPropagation: () => void }) => {
                                e.stopPropagation()
                                selection.toggleAll()
                              },
                              style: {
                                minHeight: 24,
                                padding: '2px 10px',
                                borderRadius: 9999,
                                borderWidth: 1,
                                borderStyle: 'solid',
                                borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
                                background: 'transparent',
                                color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              },
                              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                                e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.35))'
                                e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
                              },
                              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                                e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255, 255, 255, 0.15))'
                                e.currentTarget.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.6))'
                              },
                            },
                            selection.allSelected ? '全不选' : '全选',
                          )
                        : null,
                    ],
              ),
              // Row 2 Right (2, 2): 搜索历史 tags
              h(
                'div',
                {
                  role: 'group',
                  'aria-label': '搜索历史列表',
                  style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'flex-start',
                    maxHeight: 180,
                    overflowY: 'auto',
                  },
                },
                history.length === 0
                  ? h(
                      'span',
                      { style: { fontSize: 12, color: 'var(--text-muted, rgba(255, 255, 255, 0.35))', padding: '4px 0' } },
                      '暂无搜索历史',
                    )
                  : history.map((item) =>
                      h(
                        'button',
                        {
                          key: item,
                          type: 'button',
                          'data-testid': `search-history-item-${item}`,
                          onClick: (e: { stopPropagation: () => void }) => {
                            e.stopPropagation()
                            setSearchQuery(item)
                            handleCommitSearch(item)
                          },
                          style: {
                            minHeight: 24,
                            padding: '2px 10px',
                            borderRadius: 9999,
                            borderWidth: 1,
                            borderStyle: 'solid',
                            borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.1))',
                            background: 'var(--surface-1, rgba(255, 255, 255, 0.06))',
                            color: 'var(--text-secondary, rgba(255, 255, 255, 0.8))',
                            fontSize: 11,
                            cursor: 'pointer',
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          },
                          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                            e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.3))'
                            e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.12))'
                            e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
                          },
                          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                            e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255, 255, 255, 0.1))'
                            e.currentTarget.style.backgroundColor = 'var(--surface-1, rgba(255, 255, 255, 0.06))'
                            e.currentTarget.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.8))'
                          },
                        },
                        item,
                      ),
                    ),
              ),
            )
          : null,
      ),
    ),
    // Right Group: Avatar, Window Controls (Minimize, Maximize/Restore, Close).
    // While the search is expanded the tray and profile icons step aside, but
    // the window controls must stay reachable and unsquashed no matter what.
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          ...noDragStyle,
        },
      },
      // Sleep Timer Indicator
      h(SleepTimerIndicator, { ctx }),
      // Tray Indicator (hidden while the expanded search takes the bar)
      searchExpanded ? null : h(TrayIndicator, { ctx }),
      // Avatar (hidden while the expanded search takes the bar)
      searchExpanded
        ? null
        : h(
            'button',
            {
              type: 'button',
              'aria-label': 'User profile',
              title: 'Profile',
              onClick: onOpenSettings,
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.15))',
                background: 'var(--surface-selected, rgba(99, 102, 241, 0.12))',
                color: 'var(--text-primary, #F5F7FF)',
                cursor: 'pointer',
                padding: 0,
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.transform = 'scale(1.06)'
                e.currentTarget.style.boxShadow = 'var(--glow-xs, 0 0 8px rgba(99, 102, 241, 0.3))'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = 'none'
              },
            },
            tablerIcon('user', { size: 20 }),
          ),
      // Contiguous Window Controls Group — never hidden.
      h(WindowControls, null),
    ),
  )
}
