/**
 * View hooks for `ctx.miniPlayer`.
 */

import { useCallback, useEffect, useState } from 'react'
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

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return

    void bridge.getData?.().then((initial) => {
      if (initial && typeof initial === 'object') {
        setData((prev) => ({ ...prev, ...(initial as Partial<MiniPlayerData>) }))
      }
    })

    const off = bridge.onData?.((incoming: unknown) => {
      if (incoming && typeof incoming === 'object') {
        setData((prev) => ({ ...prev, ...(incoming as Partial<MiniPlayerData>) }))
      }
    })

    return () => {
      off?.()
    }
  }, [])

  return { data, setData }
}
