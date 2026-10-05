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

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { useCurrentLyric } from '@BBeBee/toolkit/hooks'
import { useDesktopLyricsState } from '@BBeBee/plugin-desktop-lyrics/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { DEFAULT_APP_SETTINGS, type AppSettings, type SettingsService } from '@BBeBee/protocol'
import { tokens } from '@BBeBee/ui-tokens'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

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
      setPosition(pos: { x: number; y: number }): Promise<void>
      getPosition(): Promise<{ x: number; y: number } | undefined>
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

export function DesktopLyrics({ ctx }: DesktopLyricsProps): ReactElement | null {
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

  // Check if running in Electron environment with native desktopLyrics window support
  const bridge =
    typeof window !== 'undefined'
      ? (window as unknown as WindowWithBridge).BBeBee?.desktopLyrics
      : undefined
  const hasNativeBridge = Boolean(bridge)

  // 1. 同步桌面歌词开关状态
  useEffect(() => {
    if (!hasNativeBridge || !bridge) return
    const targetPos = posX >= 0 && posY >= 0 ? { x: posX, y: posY } : undefined
    void bridge.setVisible(isEnabled, targetPos)
  }, [hasNativeBridge, bridge, isEnabled])

  // 2. 同步桌面歌词位置坐标（仅在启用且坐标发生数值变化时触发）
  useEffect(() => {
    if (!hasNativeBridge || !bridge || !isEnabled) return
    if (posX >= 0 && posY >= 0) {
      void bridge.setPosition({ x: posX, y: posY })
    }
  }, [hasNativeBridge, bridge, isEnabled, posX, posY])

  // 3. 同步锁定/穿透状态
  useEffect(() => {
    if (!hasNativeBridge || !bridge || !isEnabled) return
    void bridge.setLocked(isLocked)
  }, [hasNativeBridge, bridge, isEnabled, isLocked])

  // 4. 同步歌词内容、字号、颜色与播放状态
  useEffect(() => {
    if (!hasNativeBridge || !bridge || !isEnabled) return

    void bridge.updateData({
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

  // 监听原生窗口拖拽位置移动并实时保存至设置（仅在数值变化时更新，彻底阻断回环）
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
        ctx.player?.togglePlay?.()
      } else if (action.type === 'next-track') {
        void ctx.player?.next?.()
      } else if (action.type === 'prev-track') {
        void ctx.player?.previous?.()
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
  }, [hasNativeBridge, bridge, locked, setLocked, setFontSize, setVisible, ctx.player, ctx])

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
      'aria-label': 'Desktop lyrics overlay',
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
          title: 'Previous track',
          'aria-label': 'Previous track',
          onClick: () => void ctx.player?.previous?.(),
          style: buttonStyle,
        },
        tablerIcon('skip-back', { size: 18 }),
      ),
      // Play / Pause Button
      h(
        'button',
        {
          type: 'button',
          title: isPlaying ? 'Pause' : 'Play',
          'aria-label': isPlaying ? 'Pause' : 'Play',
          onClick: () => void ctx.player?.togglePlay?.(),
          style: { ...buttonStyle, color: 'var(--color-primary, #5F87FF)' },
        },
        tablerIcon(isPlaying ? 'pause-filled' : 'play-filled', { size: 18 }),
      ),
      // Next Track Button
      h(
        'button',
        {
          type: 'button',
          title: 'Next track',
          'aria-label': 'Next track',
          onClick: () => void ctx.player?.next?.(),
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
          title: 'Decrease font size',
          'aria-label': 'Decrease font size',
          onClick: () => setFontSize(fontSize - 2),
          style: buttonStyle,
        },
        'A-',
      ),
      h(
        'button',
        {
          type: 'button',
          title: 'Increase font size',
          'aria-label': 'Increase font size',
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
          title: 'Decrease opacity',
          'aria-label': 'Decrease opacity',
          onClick: () => setOpacity(Number((opacity - 0.1).toFixed(1))),
          style: buttonStyle,
        },
        '◐-',
      ),
      h(
        'button',
        {
          type: 'button',
          title: 'Increase opacity',
          'aria-label': 'Increase opacity',
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
          title: showNextLine ? 'Single line mode' : 'Double line mode',
          'aria-label': showNextLine ? 'Single line mode' : 'Double line mode',
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
          title: locked ? 'Unlock position' : 'Lock position',
          'aria-label': locked ? 'Unlock position' : 'Lock position',
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
          title: 'Hide desktop lyrics',
          'aria-label': 'Hide desktop lyrics',
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
