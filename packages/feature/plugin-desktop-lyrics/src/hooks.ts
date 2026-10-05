/**
 * View hooks for `ctx.desktopLyrics`.
 */

import { useCallback } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'
import type { DesktopLyricsPosition, DesktopLyricsService, DesktopLyricsState } from '@BBeBee/protocol'

const DEFAULT_STATE: DesktopLyricsState = {
  visible: false,
  showNextLine: true,
  fontSize: 24,
  opacity: 0.92,
  position: { x: -1, y: -1 },
  locked: false,
}

export function useDesktopLyricsState(ctx: Context) {
  const getService = () => serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')

  const state = useServiceState<DesktopLyricsState>(
    ctx,
    ['desktop-lyrics/changed'],
    () => getService()?.state ?? DEFAULT_STATE,
  )

  const toggleVisible = useCallback(() => {
    getService()?.toggleVisible?.()
  }, [ctx])

  const setVisible = useCallback(
    (v: boolean) => {
      getService()?.setVisible?.(v)
    },
    [ctx],
  )

  const setFontSize = useCallback(
    (size: number) => {
      getService()?.setFontSize?.(size)
    },
    [ctx],
  )

  const setOpacity = useCallback(
    (opacity: number) => {
      getService()?.setOpacity?.(opacity)
    },
    [ctx],
  )

  const setShowNextLine = useCallback(
    (show: boolean) => {
      getService()?.setShowNextLine?.(show)
    },
    [ctx],
  )

  const setPosition = useCallback(
    (pos: DesktopLyricsPosition) => {
      getService()?.setPosition?.(pos)
    },
    [ctx],
  )

  const setLocked = useCallback(
    (locked: boolean) => {
      getService()?.setLocked?.(locked)
    },
    [ctx],
  )

  return {
    ...state,
    toggleVisible,
    setVisible,
    setFontSize,
    setOpacity,
    setShowNextLine,
    setPosition,
    setLocked,
  }
}
