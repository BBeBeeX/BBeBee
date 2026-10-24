/**
 * DesktopLyrics — Lightweight floating lyrics overlay widget.
 *
 * Implements:
 * - Floating glassmorphism component with draggable positioning
 * - Synchronized current lyric and optional next lyric line
 * - Smooth CSS fade/slide transition between lines
 * - Hover toolbar: close, lock/unlock, font size, opacity, 1/2-line toggle, mini transport
 * - Dark mode modern aesthetics
 */

import { Component, createElement as h, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactElement } from 'react'
import type { Context } from 'cordis'
import { useCurrentLyric } from '@BBeBee/toolkit/hooks'
import { useDesktopLyricsState } from '@bbebee/plugin-desktop-lyrics/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { DEFAULT_APP_SETTINGS, type AppSettings, type PlayerService, type SettingsService } from '@BBeBee/protocol'
import { tokens } from '@BBeBee/ui-tokens'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'

export interface DesktopLyricsProps {
  ctx: Context
}

interface DesktopLyricsActionPayload {
  type: string
  size?: number
}

interface WindowWithBridge {
  BBeBee?: {
    desktopLyrics?: {
      setVisible(visible: boolean, pos?: { x: number; y: number }): Promise<void>
      getData?(): Promise<unknown>
      onMoved(callback: (pos: { x: number; y: number }) => void): () => void
      setLocked(locked: boolean): Promise<void>
      updateData(data: unknown): Promise<void>
      sendAction(action: unknown): Promise<void>
      onData(callback: (data: unknown) => void): () => void
      onAction(callback: (action: unknown) => void): () => void
    }
  }
}

function useDesktopLyricsSettings(ctx: Context) {
  const service = serviceOf<SettingsService>(ctx, 'settings')
  const [settings, setSettings] = useState<AppSettings>(() =>
    service ? service.getSync() : DEFAULT_APP_SETTINGS,
  )

  useEffect(() => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (!s) return
    void s.get().then((val) => setSettings(val))
    const off = ctx.on('settings/changed', (updated: AppSettings) => {
      setSettings(updated)
    })
    return () => {
      off()
    }
  }, [ctx])

  return settings.desktopLyrics
}

export interface DesktopLyricsErrorBoundaryProps {
  children: ReactElement | null
}

export interface DesktopLyricsErrorBoundaryState {
  hasError: boolean
}

export class DesktopLyricsErrorBoundary extends Component<
  DesktopLyricsErrorBoundaryProps,
  DesktopLyricsErrorBoundaryState
> {
  constructor(props: DesktopLyricsErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): DesktopLyricsErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Prevent unhandled desktop lyrics crash from breaking the application
  }

  override render() {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

function DesktopLyricsInner({ ctx }: DesktopLyricsProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const {
    visible,
    showNextLine,
    fontSize,
    opacity,
    position,
    locked,
    setVisible,
    setFontSize,
    setOpacity,
    setShowNextLine,
    setPosition,
    setLocked,
  } = useDesktopLyricsState(ctx)

  const lyricsConfig = useDesktopLyricsSettings(ctx)
  const effectiveFontSize = lyricsConfig?.fontSize ?? fontSize
  const effectiveOpacity = lyricsConfig?.opacity ?? opacity
  const effectiveAlign = lyricsConfig?.align ?? 'center'
  const effectiveFontFamily = lyricsConfig?.fontFamily ?? 'system-ui'
  const effectiveTextColor = lyricsConfig?.textColor ?? 'var(--lyrics-active, #D4CCFF)'
  const isSingleLine = lyricsConfig?.lineMode === 'single'
  const isEnabled = visible
  const isLocked = lyricsConfig?.locked ?? locked
  const posX = lyricsConfig?.position?.x ?? position.x
  const posY = lyricsConfig?.position?.y ?? position.y

  const {
    displayCurrentLine,
    displayNextLine,
    title,
    artist,
    isPlaying,
  } = useCurrentLyric(ctx)
  const [hovered, setHovered] = useState(false)

  // Check if running in desktop environment with native desktopLyrics window support
  const bridge =
    typeof window !== 'undefined'
      ? (window as unknown as WindowWithBridge).BBeBee?.desktopLyrics
      : undefined
  const hasNativeBridge = Boolean(bridge)

  // 1. Sync the desktop lyrics visibility state
  useEffect(() => {
    ctx.logger.info(
      `desktop-lyrics: sync effect, hasNativeBridge=${hasNativeBridge}, isEnabled=${isEnabled}`,
    )
    if (!hasNativeBridge || !bridge) return
    const targetPos = posX >= 0 && posY >= 0 ? { x: posX, y: posY } : undefined
    ctx.logger.info(`desktop-lyrics: calling bridge.setVisible(${isEnabled})`)
    void bridge
      .setVisible(isEnabled, targetPos)
      .then(() => ctx.logger.info('desktop-lyrics: bridge.setVisible resolved'))
      .catch((e) => ctx.logger.error(`desktop-lyrics: bridge.setVisible rejected: ${String(e)}`))
  }, [hasNativeBridge, bridge, isEnabled])

  // 2. Sync the lock/click-through state
  // NOTE: window position is no longer pushed from here. Dragging is
  // OS-native now; the position flows back through `onMoved` below, and the
  // saved position is applied on open via setVisible's targetPos above.
  useEffect(() => {
    if (!hasNativeBridge || !bridge || !isEnabled) return
    void bridge.setLocked(isLocked)
  }, [hasNativeBridge, bridge, isEnabled, isLocked])

  // 3. Sync lyrics content, font size, color, and playback state
  useEffect(() => {
    if (!hasNativeBridge || !bridge || !isEnabled) return

    // Diagnostic: log when updateData fires and what it sends. If this
    // never logs on track change, the effect dependencies aren't updating.
    // If it logs but the lyrics window doesn't update, the Rust emit or
    // the window's onData listener is broken.
    ctx.logger.debug(
      `desktop-lyrics: updateData firing, title=${title ?? '(none)'}, ` +
        `artist=${artist ?? '(none)'}, line=${displayCurrentLine?.slice(0, 30) ?? '(none)'}, ` +
        `playing=${isPlaying}`,
    )
    void bridge
      .updateData({
        currentLine: displayCurrentLine,
      nextLine: !isSingleLine && showNextLine ? displayNextLine : undefined,
      fontSize: effectiveFontSize,
      opacity: effectiveOpacity,
      locked: isLocked,
      playing: isPlaying,
      title,
      artist,
      align: effectiveAlign,
      fontFamily: effectiveFontFamily,
      textColor: effectiveTextColor,
      lineMode: lyricsConfig?.lineMode ?? (showNextLine ? 'double' : 'single'),
    })
      .then(() => {
        ctx.logger.debug('desktop-lyrics: updateData resolved')
      })
      .catch((e: unknown) => {
        ctx.logger.warn(`desktop-lyrics: updateData failed: ${String(e)}`)
      })
  }, [
    hasNativeBridge,
    bridge,
    isEnabled,
    isLocked,
    displayCurrentLine,
    displayNextLine,
    showNextLine,
    effectiveFontSize,
    effectiveOpacity,
    effectiveAlign,
    effectiveFontFamily,
    effectiveTextColor,
    isSingleLine,
    lyricsConfig?.lineMode,
    isPlaying,
    title,
    artist,
  ])

  // Listen to native window drag movements and persist them to settings in real time
  // (updates only on numeric change, fully blocking the feedback loop)
  useEffect(() => {
    if (!hasNativeBridge || !bridge?.onMoved) return

    const off = bridge.onMoved((pos: { x: number; y: number }) => {
      if (pos.x === posX && pos.y === posY) return
      setPosition(pos)
      const settingsService = serviceOf<SettingsService>(ctx, 'settings')
      if (settingsService) {
        void settingsService.get().then((current) => {
          if (
            current.desktopLyrics?.position?.x === pos.x &&
            current.desktopLyrics?.position?.y === pos.y
          ) {
            return
          }
          void settingsService.update({
            desktopLyrics: {
              ...current.desktopLyrics,
              position: pos,
            },
          })
        })
      }
    })

    return () => {
      off()
    }
  }, [hasNativeBridge, bridge, setPosition, ctx, posX, posY])

  // Handle actions sent from the native desktop lyrics window
  useEffect(() => {
    if (!hasNativeBridge || !bridge?.onAction) return

    const off = bridge.onAction((rawAction: unknown) => {
      const action = rawAction as DesktopLyricsActionPayload
      const settingsService = serviceOf<SettingsService>(ctx, 'settings')
      if (action.type === 'toggle-lock') {
        const nextLocked = !locked
        setLocked(nextLocked)
        if (settingsService) {
          void settingsService.get().then((current) => {
            void settingsService.update({
              desktopLyrics: {
                ...current.desktopLyrics,
                locked: nextLocked,
              },
            })
          })
        }
      } else if (action.type === 'toggle-play') {
        const player = serviceOf<PlayerService>(ctx, 'player')
        player?.togglePlay?.()
      } else if (action.type === 'next-track') {
        const player = serviceOf<PlayerService>(ctx, 'player')
        void player?.next?.()
      } else if (action.type === 'prev-track') {
        const player = serviceOf<PlayerService>(ctx, 'player')
        void player?.previous?.()
      } else if (action.type === 'set-font-size' && typeof action.size === 'number') {
        const newSize = action.size
        setFontSize(newSize)
        if (settingsService) {
          void settingsService.get().then((current) => {
            void settingsService.update({
              desktopLyrics: {
                ...current.desktopLyrics,
                fontSize: newSize,
              },
            })
          })
        }
      } else if (action.type === 'close') {
        setVisible(false)
        if (settingsService) {
          void settingsService.get().then((current) => {
            void settingsService.update({
              desktopLyrics: {
                ...current.desktopLyrics,
                enabled: false,
              },
            })
          })
        }
      }
    })

    return () => {
      off()
    }
  }, [hasNativeBridge, bridge, locked, setLocked, setFontSize, setVisible, ctx])

  if (hasNativeBridge) {
    return null
  }

  // Dragging state
  const isDragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    if (locked || (e.target as HTMLElement).closest('button')) return
    isDragging.current = true
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return
      const dx = moveEvent.clientX - dragStart.current.mouseX
      const dy = moveEvent.clientY - dragStart.current.mouseY
      setPosition({
        x: dragStart.current.posX + dx,
        y: dragStart.current.posY + dy,
      })
    }

    const handleMouseUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      const settingsService = serviceOf<SettingsService>(ctx, 'settings')
      if (settingsService) {
        void settingsService.get().then((current) => {
          void settingsService.update({
            desktopLyrics: {
              ...current.desktopLyrics,
              position,
            },
          })
        })
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  if (!isEnabled) return null

  // Determine displayText
  const displayText = displayCurrentLine
  const secondaryText = !isSingleLine && showNextLine ? displayNextLine : undefined

  return h(
    'div',
    {
      role: 'complementary',
      'aria-label': t('lyrics:desktopLyrics.desktopLyricsOverlay'),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onMouseDown: handleMouseDown,
      style: {
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
        zIndex: 9999,
        width: 'auto',
        minWidth: 420,
        maxWidth: '85vw',
        padding: `${tokens.space[3]}px ${tokens.space[5]}px`,
        borderRadius: 18,
        background: `rgba(14, 14, 20, ${effectiveOpacity})`,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 0 1px rgba(255, 255, 255, 0.2)',
        color: effectiveTextColor,
        cursor: locked ? 'default' : 'grab',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: effectiveAlign === 'left' ? 'flex-start' : effectiveAlign === 'right' ? 'flex-end' : 'center',
        justifyContent: 'center',
        transition: isDragging.current ? 'none' : 'box-shadow 0.2s ease',
      },
    },
    // Hover Controls Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: hovered ? 8 : 0,
          maxHeight: hovered ? 36 : 0,
          opacity: hovered ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease, opacity 0.2s ease, margin 0.2s ease',
        },
      },
      // Previous Track Button
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.previousTrack'),
          'aria-label': t('lyrics:desktopLyrics.previousTrack'),
          onClick: () => {
            const player = serviceOf<PlayerService>(ctx, 'player')
            void player?.previous?.()
          },
          style: buttonStyle,
        },
        tablerIcon('skip-back', { size: 18 }),
      ),
      // Play / Pause Button
      h(
        'button',
        {
          type: 'button',
          title: isPlaying ? t('lyrics:desktopLyrics.pause') : t('lyrics:desktopLyrics.play'),
          'aria-label': isPlaying ? t('lyrics:desktopLyrics.pause') : t('lyrics:desktopLyrics.play'),
          onClick: () => {
            const player = serviceOf<PlayerService>(ctx, 'player')
            void player?.togglePlay?.()
          },
          style: { ...buttonStyle, color: 'var(--color-primary, #5F87FF)' },
        },
        tablerIcon(isPlaying ? 'pause-filled' : 'play-filled', { size: 18 }),
      ),
      // Next Track Button
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.nextTrack'),
          'aria-label': t('lyrics:desktopLyrics.nextTrack'),
          onClick: () => {
            const player = serviceOf<PlayerService>(ctx, 'player')
            void player?.next?.()
          },
          style: buttonStyle,
        },
        tablerIcon('skip-forward', { size: 18 }),
      ),
      // Separator
      h('span', { style: { color: 'rgba(255, 255, 255, 0.2)', margin: '0 4px' } }, '|'),
      // Font Size Controls
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.decreaseFontSize'),
          'aria-label': t('lyrics:desktopLyrics.decreaseFontSize'),
          onClick: () => setFontSize(fontSize - 2),
          style: buttonStyle,
        },
        'A-',
      ),
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.increaseFontSize'),
          'aria-label': t('lyrics:desktopLyrics.increaseFontSize'),
          onClick: () => setFontSize(fontSize + 2),
          style: buttonStyle,
        },
        'A+',
      ),
      // Opacity Controls
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.decreaseOpacity'),
          'aria-label': t('lyrics:desktopLyrics.decreaseOpacity'),
          onClick: () => setOpacity(Number((opacity - 0.1).toFixed(1))),
          style: buttonStyle,
        },
        '◐-',
      ),
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.increaseOpacity'),
          'aria-label': t('lyrics:desktopLyrics.increaseOpacity'),
          onClick: () => setOpacity(Number((opacity + 0.1).toFixed(1))),
          style: buttonStyle,
        },
        '◐+',
      ),
      // Toggle Next Line
      h(
        'button',
        {
          type: 'button',
          title: showNextLine ? t('lyrics:desktopLyrics.singleLineMode') : t('lyrics:desktopLyrics.doubleLineMode'),
          'aria-label': showNextLine ? t('lyrics:desktopLyrics.singleLineMode') : t('lyrics:desktopLyrics.doubleLineMode'),
          onClick: () => setShowNextLine(!showNextLine),
          style: {
            ...buttonStyle,
            color: showNextLine ? 'var(--color-primary, #5F87FF)' : 'rgba(255, 255, 255, 0.5)',
          },
        },
        '≡',
      ),
      // Lock Toggle
      h(
        'button',
        {
          type: 'button',
          title: locked ? t('lyrics:desktopLyrics.unlockPosition') : t('lyrics:desktopLyrics.lockPosition'),
          'aria-label': locked ? t('lyrics:desktopLyrics.unlockPosition') : t('lyrics:desktopLyrics.lockPosition'),
          onClick: () => setLocked(!locked),
          style: buttonStyle,
        },
        tablerIcon(locked ? 'lock' : 'lock-open', { size: 18 }),
      ),
      // Close Button
      h(
        'button',
        {
          type: 'button',
          title: t('lyrics:desktopLyrics.hideDesktopLyrics'),
          'aria-label': t('lyrics:desktopLyrics.hideDesktopLyrics'),
          onClick: () => setVisible(false),
          style: { ...buttonStyle, color: 'var(--error, #EF4444)' },
        },
        tablerIcon('x', { size: 18 }),
      ),
    ),

    // Current Lyric Line (Primary)
    h(
      'div',
      {
        key: displayText,
        style: {
          fontSize: effectiveFontSize,
          fontFamily: effectiveFontFamily,
          fontWeight: 700,
          color: effectiveTextColor,
          textAlign: effectiveAlign,
          lineHeight: 1.4,
          letterSpacing: 0.5,
          textShadow: '0 2px 12px rgba(0, 0, 0, 0.7), 0 0 20px rgba(167, 139, 250, 0.4)',
          animation: 'fadeInSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxWidth: '100%',
        },
      },
      displayText,
    ),

    // Next Lyric Line (Secondary, Optional)
    secondaryText
      ? h(
          'div',
          {
            key: `next-${secondaryText}`,
            style: {
              fontSize: Math.round(effectiveFontSize * 0.72),
              fontFamily: effectiveFontFamily,
              fontWeight: 400,
              color: effectiveTextColor,
              opacity: 0.65,
              marginTop: 6,
              textAlign: effectiveAlign,
              lineHeight: 1.3,
              textShadow: '0 1px 8px rgba(0, 0, 0, 0.6)',
              animation: 'fadeInSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxWidth: '100%',
            },
          },
          secondaryText,
        )
      : null,
  )
}

export function DesktopLyrics(props: DesktopLyricsProps): ReactElement | null {
  return h(DesktopLyricsErrorBoundary, null, h(DesktopLyricsInner, props))
}

const buttonStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.1)',
  border: 'none',
  borderRadius: 6,
  color: 'var(--text-primary, #FFFFFF)',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 7px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  height: 24,
  transition: 'background-color 0.15s',
}
