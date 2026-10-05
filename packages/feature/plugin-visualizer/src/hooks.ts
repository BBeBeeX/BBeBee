/**
 * View hooks for audio visualization.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {
  AppSettings,
  SettingsService,
  VisualizerService,
  VisualizerSettings,
} from '@BBeBee/protocol'
import { DEFAULT_VISUALIZER_SETTINGS } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'

export interface UseVisualizerResult {
  settings: VisualizerSettings
  updateSettings: (patch: Partial<VisualizerSettings>) => Promise<void>
}

/** Hook to observe and update visualizer settings. */
export function useVisualizer(ctx: Context): UseVisualizerResult {
  const settingsService = serviceOf<SettingsService>(ctx, 'settings')
  const [settings, setSettings] = useState<VisualizerSettings>(() => {
    return settingsService?.getSync()?.visualizer ?? DEFAULT_VISUALIZER_SETTINGS
  })

  useEffect(() => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (!s) return

    void s.get().then((appSettings: AppSettings) => {
      if (appSettings.visualizer) {
        setSettings(appSettings.visualizer)
      }
    })

    const off = ctx.on('settings/changed', (appSettings: AppSettings) => {
      if (appSettings.visualizer) {
        setSettings(appSettings.visualizer)
      }
    })

    return () => {
      off()
    }
  }, [ctx])

  const updateSettings = useCallback(
    async (patch: Partial<VisualizerSettings>) => {
      const visualizer = serviceOf<VisualizerService>(ctx, 'visualizer')
      if (visualizer) {
        await visualizer.updateSettings(patch)
      } else {
        const s = serviceOf<SettingsService>(ctx, 'settings')
        if (s) {
          const current = await s.get()
          await s.update({
            visualizer: {
              ...(current.visualizer ?? DEFAULT_VISUALIZER_SETTINGS),
              ...patch,
            },
          })
        }
      }
    },
    [ctx],
  )

  return { settings, updateSettings }
}

/**
 * Hook providing real-time audio data buffer via requestAnimationFrame.
 */
export function useAudioData(
  ctx: Context,
  active: boolean,
  fftSize = 128,
): {
  frequencyDataRef: React.RefObject<Uint8Array | null>
  timeDomainDataRef: React.RefObject<Uint8Array | null>
} {
  const binCount = Math.floor(fftSize / 2)
  const frequencyDataRef = useRef<Uint8Array | null>(null)
  const timeDomainDataRef = useRef<Uint8Array | null>(null)

  if (!frequencyDataRef.current || frequencyDataRef.current.length !== binCount) {
    frequencyDataRef.current = new Uint8Array(binCount)
  }
  if (!timeDomainDataRef.current || timeDomainDataRef.current.length !== fftSize) {
    timeDomainDataRef.current = new Uint8Array(fftSize)
  }

  useEffect(() => {
    if (!active) return

    let animId = 0
    const visualizer = serviceOf<VisualizerService>(ctx, 'visualizer')

    const loop = () => {
      if (visualizer) {
        if (frequencyDataRef.current) {
          visualizer.getFrequencyData(frequencyDataRef.current)
        }
        if (timeDomainDataRef.current) {
          visualizer.getTimeDomainData(timeDomainDataRef.current)
        }
      }
      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)

    return () => {
      if (animId) cancelAnimationFrame(animId)
    }
  }, [ctx, active, fftSize])

  return { frequencyDataRef, timeDomainDataRef }
}
