import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  MiniPlayerAction,
  MiniPlayerDisplayMode,
  MiniPlayerServiceState,
} from '@BBeBee/protocol'
import { useMiniPlayerData } from '@bbebee/plugin-mini-player/hooks'
import { MiniPlayerFloating } from './MiniPlayerFloating.js'
import { MiniPlayerIsland } from './MiniPlayerIsland.js'

const GLOBAL_STYLES = `
@keyframes miniPlayerSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes miniPlayerWaveBar {
  0% { transform: scaleY(0.25); }
  100% { transform: scaleY(1); }
}

@keyframes miniPlayerWave0 {
  0% { transform: scaleY(0.3); }
  30% { transform: scaleY(0.75); }
  60% { transform: scaleY(0.4); }
  85% { transform: scaleY(0.7); }
  100% { transform: scaleY(0.3); }
}
@keyframes miniPlayerWave1 {
  0% { transform: scaleY(0.25); }
  25% { transform: scaleY(0.95); }
  55% { transform: scaleY(0.5); }
  80% { transform: scaleY(1.0); }
  100% { transform: scaleY(0.25); }
}
@keyframes miniPlayerWave2 {
  0% { transform: scaleY(0.35); }
  20% { transform: scaleY(0.55); }
  50% { transform: scaleY(0.25); }
  75% { transform: scaleY(0.6); }
  100% { transform: scaleY(0.35); }
}
@keyframes miniPlayerWave3 {
  0% { transform: scaleY(0.2); }
  35% { transform: scaleY(0.85); }
  60% { transform: scaleY(0.4); }
  85% { transform: scaleY(0.8); }
  100% { transform: scaleY(0.2); }
}

@keyframes miniPlayerExpand {
  0% {
    opacity: 0.8;
    transform: scale(0.96) translateY(-8px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

html, body, #root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent !important;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  /* WebView2 on Windows renders a 1px border on transparent frameless
     windows; suppress it. */
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}
`

interface MiniPlayerBridge {
  getState?(): Promise<MiniPlayerServiceState>
  setMode?(mode: MiniPlayerDisplayMode): Promise<void>
  sendAction?(action: MiniPlayerAction): Promise<void>
  restoreMain?(): Promise<void>
  close?(): Promise<void>
  onState?(callback: (state: unknown) => void): () => void
}

function getBridge(): MiniPlayerBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { BBeBee?: { miniPlayer?: MiniPlayerBridge } }).BBeBee?.miniPlayer
}

export function MiniPlayerWindow(): ReactElement {
  const { data } = useMiniPlayerData()
  const [mode, setModeState] = useState<MiniPlayerDisplayMode>('normal')

  useEffect(() => {
    // Inject keyframes
    const styleEl = document.createElement('style')
    styleEl.id = 'mini-player-styles'
    styleEl.textContent = GLOBAL_STYLES
    document.head.appendChild(styleEl)

    const bridge = getBridge()
    if (bridge) {
      void bridge.getState?.().then((st) => {
        if (st && typeof st.mode === 'string') {
          setModeState(st.mode)
        }
      })

      const off = bridge.onState?.((incoming: unknown) => {
        const st = incoming as Partial<MiniPlayerServiceState>
        if (st && st.mode) {
          setModeState(st.mode)
        }
      })

      return () => {
        off?.()
        styleEl.remove()
      }
    }

    return () => {
      styleEl.remove()
    }
  }, [])

  const handleAction = (action: MiniPlayerAction) => {
    const bridge = getBridge()
    void bridge?.sendAction?.(action)
  }

  const handleSetMode = (targetMode: MiniPlayerDisplayMode) => {
    setModeState(targetMode)
    const bridge = getBridge()
    void bridge?.setMode?.(targetMode)
  }

  const handleRestoreMain = () => {
    const bridge = getBridge()
    void bridge?.restoreMain?.()
  }

  const handleClose = () => {
    const bridge = getBridge()
    void bridge?.close?.()
  }

  // "deep": any descendant starts the OS-native drag. Interactive elements
  // opt out individually (buttons are excluded by Tauri itself).
  if (mode === 'attached' || mode === 'expanded') {
    return h(
      'div',
      { 'data-tauri-drag-region': 'deep', style: { width: '100%', height: '100%' } },
      h(MiniPlayerIsland, {
        data,
        isExpanded: mode === 'expanded',
        onAction: handleAction,
        onExpand: () => handleSetMode('expanded'),
        onCollapse: () => handleSetMode('attached'),
        onDetach: () => handleSetMode('normal'),
        onRestoreMain: handleRestoreMain,
        onClose: handleClose,
      }),
    )
  }

  return h(
    'div',
    { 'data-tauri-drag-region': 'deep', style: { width: '100%', height: '100%' } },
    h(MiniPlayerFloating, {
      data,
      onAction: handleAction,
      onSnapToTop: () => handleSetMode('attached'),
      onRestoreMain: handleRestoreMain,
      onClose: handleClose,
    }),
  )
}
