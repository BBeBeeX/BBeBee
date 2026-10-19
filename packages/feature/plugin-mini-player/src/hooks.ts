/**
 * View hooks for `ctx.miniPlayer`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'
import type {
  MiniPlayerData,
  MiniPlayerDisplayMode,
  MiniPlayerService,
  MiniPlayerServiceState,
} from '@BBeBee/protocol'

const DEFAULT_STATE: MiniPlayerServiceState = {
  visible: false,
  mode: 'normal',
  windowState: 'hidden',
}

const DEFAULT_DATA: MiniPlayerData = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  canPlayOrPause: false,
  canPrevious: false,
  canNext: false,
  volume: 1,
  muted: false,
}

interface MiniPlayerBridge {
  getData?(): Promise<MiniPlayerData | undefined>
  onData?(callback: (data: unknown) => void): () => void
}

function getBridge(): MiniPlayerBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { BBeBee?: { miniPlayer?: MiniPlayerBridge } }).BBeBee?.miniPlayer
}

export function useMiniPlayerState(ctx: Context) {
  const getService = () => serviceOf<MiniPlayerService>(ctx, 'miniPlayer')

  const state = useServiceState<MiniPlayerServiceState>(
    ctx,
    ['mini-player/changed'],
    () => getService()?.state ?? DEFAULT_STATE,
  )

  const isSupported = getService()?.isSupported ?? false

  const open = useCallback(
    (options?: { mode?: MiniPlayerDisplayMode }) => {
      void getService()?.open?.(options)
    },
    [ctx],
  )

  const close = useCallback(() => {
    void getService()?.close?.()
  }, [ctx])

  const toggle = useCallback(() => {
    void getService()?.toggle?.()
  }, [ctx])

  const setMode = useCallback(
    (mode: MiniPlayerDisplayMode) => {
      void getService()?.setMode?.(mode)
    },
    [ctx],
  )

  const restoreMain = useCallback(() => {
    void getService()?.restoreMain?.()
  }, [ctx])

  return {
    ...state,
    isSupported,
    open,
    close,
    toggle,
    setMode,
    restoreMain,
  }
}

/**
 * Hook for reading synced mini player playback data from the preload bridge.
 * Typically used in the secondary MiniPlayerWindow.
 */
export function useMiniPlayerData(): {
  data: MiniPlayerData
  setData: (data: MiniPlayerData) => void
} {
  const [data, setData] = useState<MiniPlayerData>(DEFAULT_DATA)
  // Track OS-native drag (data-tauri-drag-region): pause setData while the
  // user is dragging the window, so 3Hz updates don't fight the drag.
  const draggingRef = useRef(false)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-tauri-drag-region]')) {
        draggingRef.current = true
      }
    }
    // pointerup can be missed when the OS ends the drag itself (e.g. Esc
    // cancels the native move loop) or the pointer is released off-window;
    // never leave updates paused forever.
    const onDragEnd = () => {
      draggingRef.current = false
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onDragEnd)
    document.addEventListener('pointercancel', onDragEnd)
    window.addEventListener('blur', onDragEnd)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onDragEnd)
      document.removeEventListener('pointercancel', onDragEnd)
      window.removeEventListener('blur', onDragEnd)
    }
  }, [])

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return

    void bridge.getData?.().then((initial) => {
      if (initial && typeof initial === 'object') {
        setData((prev) => ({ ...prev, ...(initial as Partial<MiniPlayerData>) }))
      }
    })

    const off = bridge.onData?.((incoming: unknown) => {
      // Don't update state while dragging — the OS is moving the window,
      // React re-renders would fight it and cause lag.
      if (draggingRef.current) return
      if (incoming && typeof incoming === 'object') {
        const next = incoming as Partial<MiniPlayerData>
        setData((prev) => {
          // Skip re-render if only position/duration changed — the ProgressBar
          // subscribes directly via bridge.onData and updates via refs, so the
          // React tree doesn't need to re-render at 3Hz (which blocks OS drag).
          const merged = { ...prev, ...next }
          let changed = false
          for (const k of Object.keys(next) as (keyof MiniPlayerData)[]) {
            if (k === 'positionMs' || k === 'durationMs') continue
            if (prev[k] !== merged[k]) {
              changed = true
              break
            }
          }
          return changed ? merged : prev
        })
      }
    })

    return () => {
      off?.()
    }
  }, [])

  return { data, setData }
}
