import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { tablerIcon, useBridgeLocale } from '@BBeBee/ui-kit-desktop'
import type { DesktopLyricsPayload, DesktopLyricsAction } from './desktop-lyrics-types.js'

const DEFAULT_PAYLOAD: DesktopLyricsPayload = {
  currentLine: 'BBeBee Music',
  nextLine: 'Listen to high-quality music',
  fontSize: 24,
  opacity: 0.95,
  locked: false,
  playing: false,
  align: 'center',
  fontFamily: 'system-ui',
  textColor: '#FFFFFF',
  lineMode: 'double',
}

export function DesktopLyricsWindow(): ReactElement {
  // No Cordis ctx in this window (it never boots the app): UI strings come
  // from the preload `locale` bridge via `useBridgeLocale`, resolved against
  // the built-in catalogues with per-key fallback.
  const { t } = useBridgeLocale()
  const [data, setData] = useState<DesktopLyricsPayload>(DEFAULT_PAYLOAD)
  const [hovered, setHovered] = useState(false)
  // True once the main process has pushed real lyric data; before that the
  // placeholder lines render from the catalogue, not the English defaults.
  const [hasData, setHasData] = useState(false)

  /**
   * Manual window drag: a `-webkit-app-region: drag` root would swallow the
   * mouse events the hover toolbar depends on, so the window is moved through
   * `setPosition` from pointer events instead.
   */
  const pointerDownRef = useRef(false)
  const dragRef = useRef<{
    pointerId: number
    startMouseX: number
    startMouseY: number
    startPos: { x: number; y: number }
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (locked || e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[data-lyrics-toolbar]')) return
    const bridge = window.BBeBee?.desktopLyrics
    const getPosition = bridge?.getPosition
    if (!bridge || !getPosition) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerDownRef.current = true
    void getPosition.call(bridge).then((startPos) => {
      // The pointer may already be up again for a fast click.
      if (!pointerDownRef.current || !startPos) return
      dragRef.current = {
        pointerId: e.pointerId,
        startMouseX: e.screenX,
        startMouseY: e.screenY,
        startPos,
      }
      setDragging(true)
    })
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const setPosition = window.BBeBee?.desktopLyrics?.setPosition
    if (!drag || !setPosition || e.pointerId !== drag.pointerId) return
    void setPosition({
      x: Math.round(drag.startPos.x + (e.screenX - drag.startMouseX)),
      y: Math.round(drag.startPos.y + (e.screenY - drag.startMouseY)),
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLElement>, commit: boolean) => {
    const drag = dragRef.current
    pointerDownRef.current = false
    dragRef.current = null
    setDragging(false)
    if (!drag || e.pointerId !== drag.pointerId) return
    if (!commit) return
    const pos = {
      x: Math.round(drag.startPos.x + (e.screenX - drag.startMouseX)),
      y: Math.round(drag.startPos.y + (e.screenY - drag.startMouseY)),
    }
    const setPosition = window.BBeBee?.desktopLyrics?.setPosition
    if (setPosition) void setPosition(pos)
    // Programmatic moves are echo-suppressed in main, so the final position
    // must be reported explicitly to reach the settings writer.
    void window.BBeBee?.desktopLyrics?.commitPosition?.(pos)
  }

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    const bridge = window.BBeBee?.desktopLyrics
    if (!bridge) return

    // Get current data if available on initial mount
    void (bridge as { getData?: () => Promise<unknown> }).getData?.()?.then((initial) => {
      if (initial) {
        setHasData(true)
        setData((prev) => ({ ...prev, ...(initial as Partial<DesktopLyricsPayload>) }))
      }
    })

    const off = bridge.onData((incoming: unknown) => {
      setHasData(true)
      setData((prev) => ({ ...prev, ...(incoming as Partial<DesktopLyricsPayload>) }))
    })

    return () => {
      off()
    }
  }, [])

  const sendAction = (action: DesktopLyricsAction) => {
    void window.BBeBee?.desktopLyrics?.sendAction?.(action)
  }

  const {
    currentLine,
    nextLine,
    fontSize,
    opacity,
    locked,
    playing,
    title,
    artist,
    align = 'center',
    fontFamily = 'system-ui',
    textColor = '#FFFFFF',
    lineMode = 'double',
  } = data

  // Show song title first when switching tracks; display lyrics once available.
  // Placeholder lines come from the catalogue until real data arrives, so a
  // Chinese UI never flashes the English defaults on window open.
  const displayCurrentLine = hasData
    ? (currentLine || (title ? `${title}${artist ? ` - ${artist}` : ''}` : t('app:common.desktopLyrics.defaultCurrentLine')))
    : t('app:common.desktopLyrics.defaultCurrentLine')
  const displayNextLine = hasData ? nextLine : t('app:common.desktopLyrics.defaultNextLine')

  // While locked the window is click-through. Main polls the OS cursor and
  // reports window-relative coordinates; the unlock pill shows only while the
  // cursor is over the window and is the single hotspot that breaks out of
  // click-through.
  const [cursorInside, setCursorInside] = useState(false)
  const [unlockHovered, setUnlockHovered] = useState(false)
  const unlockRef = useRef<HTMLButtonElement | null>(null)
  const mouseIgnoredRef = useRef(false)

  useEffect(() => {
    const bridge = window.BBeBee?.desktopLyrics
    const onCursor = bridge?.onCursor
    setCursorInside(false)
    setUnlockHovered(false)
    if (!locked || !bridge || !onCursor) {
      mouseIgnoredRef.current = false
      return
    }
    mouseIgnoredRef.current = true

    const off = onCursor.call(bridge, (pos) => {
      const inside = pos.x >= 0 && pos.y >= 0
      setCursorInside(inside)
      let overPill = false
      if (inside) {
        const el = unlockRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          overPill =
            pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom
        }
      }
      setUnlockHovered(overPill)
      if (overPill === mouseIgnoredRef.current) {
        mouseIgnoredRef.current = !overPill
        void bridge.setIgnoreMouse?.(!overPill)
      }
    })
    return off
  }, [locked])

  return h(
    'div',
    {
      // Native OS drag: zero lag vs JS pointer-event + bridge round-trip.
      // When locked, the window is click-through (setIgnoreMouse), so the
      // drag region is inert.
      'data-tauri-drag-region': true,
      style: {
        position: 'relative',
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: '8px 16px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        cursor: dragging ? 'grabbing' : locked ? 'default' : 'move',
        background: hovered && !locked ? 'rgba(15, 15, 22, 0.6)' : 'transparent',
        borderRadius: 12,
        border: hovered && !locked ? '1px solid rgba(255, 255, 255, 0.12)' : 'none',
        boxShadow: 'none',
        backdropFilter: hovered && !locked ? 'blur(12px)' : 'none',
        transition: 'all 0.2s ease',
        overflow: 'hidden',
      },
      onMouseEnter: () => {
        // Locked windows forward mouse moves for hover, but must stay inert.
        if (!locked) setHovered(true)
      },
      onMouseLeave: () => setHovered(false),
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: (e) => endDrag(e, true),
      onPointerCancel: (e) => endDrag(e, false),
    },
    // Toolbar (revealed on hover while unlocked)
    !locked &&
      h(
        'div',
        {
          'data-lyrics-toolbar': '',
          style: {
            position: 'absolute',
            top: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity 0.2s ease',
            background: 'rgba(24, 24, 32, 0.85)',
            padding: '3px 8px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 100,
            WebkitAppRegion: 'no-drag',
          },
        },
        // Prev button
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: t('app:common.desktopLyrics.previousTrack'),
            onClick: () => sendAction({ type: 'prev-track' }),
          },
          tablerIcon('skip-back', { size: 18 }),
        ),
        // Play/Pause button
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: playing
              ? t('app:common.desktopLyrics.pause')
              : t('app:common.desktopLyrics.play'),
            onClick: () => sendAction({ type: 'toggle-play' }),
          },
          tablerIcon(playing ? 'pause' : 'play', { size: 18 }),
        ),
        // Next button
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: t('app:common.desktopLyrics.nextTrack'),
            onClick: () => sendAction({ type: 'next-track' }),
          },
          tablerIcon('skip-forward', { size: 18 }),
        ),
        // Separator
        h('div', { style: separatorStyle }),
        // Smaller font
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: t('app:common.desktopLyrics.smallerFont'),
            onClick: () => sendAction({ type: 'set-font-size', size: Math.max(16, fontSize - 2) }),
          },
          'A-',
        ),
        // Larger font
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: t('app:common.desktopLyrics.largerFont'),
            onClick: () => sendAction({ type: 'set-font-size', size: Math.min(36, fontSize + 2) }),
          },
          'A+',
        ),
        // Separator
        h('div', { style: separatorStyle }),
        // Lock button
        h(
          'button',
          {
            style: { ...toolbarButtonStyle, color: locked ? '#A78BFA' : '#E0E0E0' },
            title: locked
              ? t('app:common.desktopLyrics.unlock')
              : t('app:common.desktopLyrics.lockLyrics'),
            onClick: () => sendAction({ type: 'toggle-lock' }),
          },
          tablerIcon(locked ? 'lock' : 'lock-open', { size: 18 }),
        ),
        // Close button
        h(
          'button',
          {
            style: { ...toolbarButtonStyle, color: '#EF4444' },
            title: t('app:common.desktopLyrics.closeDesktopLyrics'),
            onClick: () => sendAction({ type: 'close' }),
          },
          tablerIcon('x', { size: 18 }),
        ),
      ),
    // Locked: no hover chrome — while the cursor is over the window, a single
    // unlock pill takes the toolbar's spot as the only interactive hotspot.
    locked &&
      cursorInside &&
      h(
        'button',
        {
          ref: unlockRef,
          title: t('app:common.desktopLyrics.unlockDesktopLyrics'),
          onClick: () => sendAction({ type: 'toggle-lock' }),
          style: {
            position: 'absolute',
            top: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            opacity: unlockHovered ? 1 : 0.6,
            background: unlockHovered ? 'rgba(24, 24, 32, 0.9)' : 'rgba(24, 24, 32, 0.55)',
            color: '#E0E0E0',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 20,
            padding: '2px 10px',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
            zIndex: 100,
            transition: 'opacity 0.2s ease, background 0.2s ease',
          },
        },
        tablerIcon('lock-open', { size: 14 }),
        t('app:common.desktopLyrics.unlock'),
      ),
    // Current Line
    h(
      'div',
      {
        style: {
          fontSize,
          fontFamily,
          fontWeight: 700,
          textAlign: align,
          lineHeight: 1.3,
          letterSpacing: '0.04em',
          opacity,
          color: textColor,
          textShadow: '0 2px 4px rgba(0, 0, 0, 0.95), 0 0 12px rgba(124, 58, 237, 0.45)',
          maxWidth: '92%',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          transition: 'all 0.25s ease',
        },
      },
      displayCurrentLine || '...',
    ),
    // Next Line (if available and double line mode)
    lineMode !== 'single' &&
      displayNextLine &&
      h(
        'div',
        {
          style: {
            fontSize: Math.round(fontSize * 0.68),
            fontFamily,
            fontWeight: 500,
            textAlign: align,
            lineHeight: 1.2,
            marginTop: 4,
            opacity: opacity * 0.75,
            color: textColor,
            filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.9))',
            maxWidth: '85%',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            transition: 'all 0.25s ease',
          },
        },
        displayNextLine,
      ),
  )
}

const toolbarButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#FFFFFF',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 6px',
  borderRadius: 4,
  outline: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s ease',
}

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 12,
  background: 'rgba(255, 255, 255, 0.2)',
  margin: '0 2px',
}
