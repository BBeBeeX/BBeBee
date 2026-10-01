/**
 * React hooks for `@BBeBee/plugin-settings`.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  AppSettings,
  CacheService,
  SettingsContribution,
  SettingsService,
  UiService,
} from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'

export interface UseAppSettingsResult {
  settings: AppSettings
  loading: boolean
  update: (partial: Partial<AppSettings>) => Promise<AppSettings>
  reset: () => Promise<AppSettings>
}

export function useAppSettings(ctx: Context): UseAppSettingsResult {
  const settingsService = serviceOf<SettingsService>(ctx, 'settings')
  const [settings, setSettings] = useState<AppSettings>(() =>
    settingsService ? settingsService.getSync() : DEFAULT_APP_SETTINGS,
  )
  const [loading, setLoading] = useState(!settingsService)

  useEffect(() => {
    const service = serviceOf<SettingsService>(ctx, 'settings')
    if (!service) {
      setLoading(false)
      return
    }

    let cancelled = false
    service
      .get()
      .then((val: AppSettings) => {
        if (!cancelled) {
          setSettings(val)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    const off = ctx.on('settings/changed', (updated) => {
      setSettings(updated)
    })

    return () => {
      cancelled = true
      off()
    }
  }, [ctx])

  const update = useCallback(
    async (partial: Partial<AppSettings>) => {
      const service = serviceOf<SettingsService>(ctx, 'settings')
      if (service) {
        return service.update(partial)
      }
      const next: AppSettings = {
        ...settings,
        ...partial,
        desktopLyrics: {
          ...settings.desktopLyrics,
          ...(partial.desktopLyrics ?? {}),
        },
        shortcuts: {
          ...settings.shortcuts,
          ...(partial.shortcuts ?? {}),
          keybindings: {
            ...settings.shortcuts?.keybindings,
            ...(partial.shortcuts?.keybindings ?? {}),
          },
        },
        proxy: {
          ...settings.proxy,
          ...(partial.proxy ?? {}),
          sourceRules: {
            ...settings.proxy?.sourceRules,
            ...(partial.proxy?.sourceRules ?? {}),
          },
        },
      }
      setSettings(next)
      return next
    },
    [ctx, settings],
  )

  const reset = useCallback(async () => {
    const service = serviceOf<SettingsService>(ctx, 'settings')
    if (service) {
      return service.reset()
    }
    setSettings(DEFAULT_APP_SETTINGS)
    return DEFAULT_APP_SETTINGS
  }, [ctx])

  return { settings, loading, update, reset }
}

export interface CacheUsage {
  artworkBytes: number
  streamBytes: number
  totalBytes: number
}

export interface UseCacheStatsResult {
  usage: CacheUsage
  loading: boolean
  clear: (className?: 'artwork' | 'stream') => Promise<void>
  refresh: () => Promise<void>
}

export function useCacheStats(ctx: Context): UseCacheStatsResult {
  const [usage, setUsage] = useState<CacheUsage>({
    artworkBytes: 0,
    streamBytes: 0,
    totalBytes: 0,
  })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const cache = serviceOf<CacheService>(ctx, 'cache')
    if (!cache) {
      setUsage({ artworkBytes: 0, streamBytes: 0, totalBytes: 0 })
      setLoading(false)
      return
    }
    try {
      const [art, stream] = await Promise.all([
        cache.stats('artwork').catch(() => ({ bytes: 0, entries: 0 })),
        cache.stats('stream').catch(() => ({ bytes: 0, entries: 0 })),
      ])
      setUsage({
        artworkBytes: art.bytes,
        streamBytes: stream.bytes,
        totalBytes: art.bytes + stream.bytes,
      })
    } finally {
      setLoading(false)
    }
  }, [ctx])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clear = useCallback(
    async (className?: 'artwork' | 'stream') => {
      const cache = serviceOf<CacheService>(ctx, 'cache')
      if (cache) {
        await cache.clear(className)
        await refresh()
      }
    },
    [ctx, refresh],
  )

  return { usage, loading, clear, refresh }
}

export function useAvailableSettings(ctx: Context): readonly SettingsContribution[] {
  const read = () => {
    const list: SettingsContribution[] = []
    const seen = new Set<string>()

    const settingsService = serviceOf<SettingsService>(ctx, 'settings')
    if (settingsService?.getContributions) {
      for (const item of settingsService.getContributions()) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          list.push(item)
        }
      }
    }

    const ui = serviceOf<UiService>(ctx, 'ui')
    if (ui?.settings) {
      for (const item of ui.settings) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          list.push(item)
        }
      }
    }

    return list.sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
  }
  const [list, setList] = useState<readonly SettingsContribution[]>(read)

  useEffect(() => {
    const update = () => setList(read())
    const offUi = ctx.on('ui/changed', update)
    const offSettings = ctx.on('settings/contributions-changed', update)
    return () => {
      offUi()
      offSettings()
    }
  }, [ctx])

  return list
}
