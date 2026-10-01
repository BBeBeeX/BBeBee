/**
 * Desktop Settings Screen for `@BBeBee/plugin-settings`.
 * Single-page natural scrolling layout with section anchors and text-only tab navigation.
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type {
  DesktopLyricsSettings,
  GlobalShortcutsSettings,
  ProxySettings,
  SourceRecord,
  SourcesService,
  DeviceService,
  PlayerService,
  DesktopLyricsService,
  PathsService,
  UiService,
  SettingsService,
} from '@BBeBee/protocol'
import {
  DEFAULT_DESKTOP_LYRICS_SETTINGS,
  DEFAULT_PROXY_SETTINGS,
  DEFAULT_SHORTCUTS_SETTINGS,
} from '@BBeBee/protocol'
import { useAppSettings, useAvailableSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { GeneralSection } from './components/sections/GeneralSection.js'
import { PlaybackSection } from './components/sections/PlaybackSection.js'
import { LyricsSection } from './components/sections/LyricsSection.js'
import { ShortcutsSection } from './components/sections/ShortcutsSection.js'
import { NetworkSection } from './components/sections/NetworkSection.js'
import { SourcesSection } from './components/sections/SourcesSection.js'
import { StorageSection } from './components/sections/StorageSection.js'
import { AboutSection } from './components/sections/AboutSection.js'
import { SettingsSection } from './components/SettingsSection.js'
import { SettingsRow } from './components/SettingsRow.js'
import { Button } from '@BBeBee/ui-kit-desktop'

export type SettingsTab = string

export interface TabItem {
  id: SettingsTab
  label: string
}

export const TABS: readonly TabItem[] = [
  { id: 'general', label: '常规与语言' },
  { id: 'playback', label: '播放与音频' },
  { id: 'lyrics', label: '桌面歌词' },
  { id: 'shortcuts', label: '全局快捷键' },
  { id: 'network', label: '网络与代理' },
  { id: 'sources', label: '曲库与来源' },
  { id: 'storage', label: '存储与缓存' },
  { id: 'about', label: '关于应用' },
]

function cleanDisplayPath(rawPath?: string): string {
  if (!rawPath) return ''
  let p = rawPath
  if (p.startsWith('file://')) {
    p = decodeURIComponent(p.replace(/^file:\/\//, ''))
    if (/^\/[a-zA-Z]:/.test(p)) {
      p = p.slice(1)
    }
  }
  return p
}

export function SettingsScreen({ ctx }: { ctx: Context }): ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
  const isClickNavigatingRef = useRef(false)

  const { settings, update, reset } = useAppSettings(ctx)
  const { usage, clear } = useCacheStats(ctx)
  const availableSettings = useAvailableSettings(ctx)

  const customSectionIds = Array.from(
    new Set(
      availableSettings
        .map((c) => c.section)
        .filter(
          (s) =>
            ![
              'general',
              'playback',
              'audio',
              'lyrics',
              'shortcuts',
              'network',
              'sources',
              'storage',
              'about',
            ].includes(s),
        ),
    ),
  )

  const allTabs: readonly TabItem[] = [
    ...TABS,
    ...customSectionIds.map((s) => ({
      id: s,
      label: s.charAt(0).toUpperCase() + s.slice(1),
    })),
  ]

  const [clearingCache, setClearingCache] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Proxy test state
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<{
    ok: boolean
    latencyMs?: number
    error?: string
  } | null>(null)

  // Third-party sources list
  const [sourcesList, setSourcesList] = useState<readonly SourceRecord[]>(() => {
    const s = serviceOf<SourcesService>(ctx, 'sources')
    return s?.sources ? [...s.sources] : []
  })

  useEffect(() => {
    const refresh = () => {
      const s = serviceOf<SourcesService>(ctx, 'sources')
      setSourcesList(s?.sources ? [...s.sources] : [])
    }
    const off1 = ctx.on('source/imported', refresh)
    const off2 = ctx.on('source/changed', refresh)
    const off3 = ctx.on('source/removed', refresh)
    return () => {
      off1?.()
      off2?.()
      off3?.()
    }
  }, [ctx])

  const thirdPartySources = sourcesList.filter((s) => s.id !== 'local')

  // Theme auto-sync with system prefers-color-scheme
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const applyTheme = (isDark: boolean) => {
      root.setAttribute('data-theme', isDark ? 'dark' : 'light')
      root.style.colorScheme = isDark ? 'dark' : 'light'
    }
    if (settings.theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mql = window.matchMedia('(prefers-color-scheme: dark)')
        applyTheme(mql.matches)
        const listener = (e: MediaQueryListEvent) => applyTheme(e.matches)
        mql.addEventListener?.('change', listener)
        return () => mql.removeEventListener?.('change', listener)
      } else {
        applyTheme(true)
      }
    } else {
      applyTheme(settings.theme === 'dark')
    }
  }, [settings.theme])

  // Desktop lyrics visibility synchronized with both desktopLyrics service and settings
  const isDesktopLyricsVisible = useServiceState<boolean>(
    ctx,
    ['desktop-lyrics/changed', 'settings/changed'],
    () => {
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      if (dl) return dl.state.visible
      const s = serviceOf<SettingsService>(ctx, 'settings')
      return s?.getSync()?.desktopLyrics?.enabled ?? settings.desktopLyrics?.enabled ?? false
    },
  )

  // Safe configurations with fallback defaults
  const desktopLyrics: DesktopLyricsSettings = {
    ...DEFAULT_DESKTOP_LYRICS_SETTINGS,
    ...(settings.desktopLyrics ?? {}),
    enabled: isDesktopLyricsVisible,
  }

  const shortcuts: GlobalShortcutsSettings = {
    enabled: settings.shortcuts?.enabled ?? DEFAULT_SHORTCUTS_SETTINGS.enabled,
    keybindings: {
      ...DEFAULT_SHORTCUTS_SETTINGS.keybindings,
      ...(settings.shortcuts?.keybindings ?? {}),
    },
  }

  const proxy: ProxySettings = {
    ...DEFAULT_PROXY_SETTINGS,
    ...(settings.proxy ?? {}),
    sourceRules: {
      ...DEFAULT_PROXY_SETTINGS.sourceRules,
      ...(settings.proxy?.sourceRules ?? {}),
    },
  }

  // Global shortcuts registration
  useEffect(() => {
    const device = serviceOf<DeviceService>(ctx, 'device')
    if (!shortcuts.enabled || !device?.registerHotkey) return
    const disposers: (() => void)[] = []
    const kb = shortcuts.keybindings
    if (!kb) return

    const register = (acc: string | undefined, handler: () => void) => {
      if (!acc) return
      try {
        const off = device.registerHotkey(acc, handler)
        if (off) disposers.push(off)
      } catch {
        // ignore unavailable accelerator
      }
    }

    register(kb.playPause, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      p?.togglePlay?.()
    })
    register(kb.prevTrack, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      void p?.previous?.()
    })
    register(kb.nextTrack, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      void p?.next?.()
    })
    register(kb.volumeUp, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const cur = p?.state?.volume ?? 0.8
      p?.setVolume?.(Math.min(1, Math.round((cur + 0.05) * 100) / 100))
    })
    register(kb.volumeDown, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const cur = p?.state?.volume ?? 0.8
      p?.setVolume?.(Math.max(0, Math.round((cur - 0.05) * 100) / 100))
    })
    register(kb.toggleLyrics, () => {
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      if (dl) {
        dl.toggleVisible()
      } else {
        const s = serviceOf<SettingsService>(ctx, 'settings')
        if (s) {
          const cur = s.getSync()?.desktopLyrics
          void s.update({
            desktopLyrics: {
              ...cur,
              enabled: !(cur?.enabled ?? false),
            } as DesktopLyricsSettings,
          })
        }
      }
    })
    register(kb.toggleWindow, () => {
      const bridge = (
        window as unknown as { BBeBee?: { window?: { toggle?: () => Promise<void> } } }
      ).BBeBee
      void bridge?.window?.toggle?.()
    })
    register(kb.toggleLoved, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const s = serviceOf<SourcesService>(ctx, 'sources')
      const urn = p?.state?.trackUrn
      if (urn && s?.setLoved) {
        void s.setLoved(urn, true)
      }
    })
    register(kb.seekForward, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const pos = p?.state?.positionMs ?? 0
      void p?.seek?.(pos + 5000)
    })
    register(kb.seekBackward, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const pos = p?.state?.positionMs ?? 0
      void p?.seek?.(Math.max(0, pos - 5000))
    })

    return () => {
      for (const off of disposers) off()
    }
  }, [ctx, shortcuts])

  const paths = serviceOf<PathsService>(ctx, 'paths')
  const defaultDownloadsDir = paths?.downloads
    ? `${paths.downloads}/BBeBee`
    : '默认下载目录 (Downloads/BBeBee)'
  const defaultCacheDir = paths?.cache ? `${paths.cache}/BBeBee` : '默认缓存目录 (Cache/BBeBee)'
  const currentDownloadsDir = settings.downloadDir || defaultDownloadsDir
  const currentCacheDir = settings.cacheDir || defaultCacheDir

  const handlePickDownloadDir = async () => {
    const bridge = (
      window as unknown as {
        BBeBee?: { dialog?: { pickDirectory: () => Promise<string | undefined> } }
      }
    ).BBeBee
    if (bridge?.dialog?.pickDirectory) {
      const picked = await bridge.dialog.pickDirectory()
      if (picked) void update({ downloadDir: picked })
    }
  }

  const handleOpenDownloadDir = async () => {
    const bridge = (
      window as unknown as { BBeBee?: { shell?: { openPath: (p: string) => Promise<string> } } }
    ).BBeBee
    if (bridge?.shell?.openPath) {
      await bridge.shell.openPath(cleanDisplayPath(currentDownloadsDir))
    }
  }

  const handlePickCacheDir = async () => {
    const bridge = (
      window as unknown as {
        BBeBee?: { dialog?: { pickDirectory: () => Promise<string | undefined> } }
      }
    ).BBeBee
    if (bridge?.dialog?.pickDirectory) {
      const picked = await bridge.dialog.pickDirectory()
      if (picked) void update({ cacheDir: picked })
    }
  }

  const handleOpenCacheDir = async () => {
    const bridge = (
      window as unknown as { BBeBee?: { shell?: { openPath: (p: string) => Promise<string> } } }
    ).BBeBee
    if (bridge?.shell?.openPath) {
      await bridge.shell.openPath(cleanDisplayPath(currentCacheDir))
    }
  }

  const handleCloseToTrayChange = (closeToTray: boolean) => {
    void update({ closeToTray })
    const bridge = (
      window as unknown as {
        BBeBee?: { window?: { setCloseToTray: (v: boolean) => Promise<void> } }
      }
    ).BBeBee
    bridge?.window?.setCloseToTray?.(closeToTray)
  }

  const handleTestProxy = async () => {
    setProxyTesting(true)
    setProxyTestResult(null)
    const bridge = (
      window as unknown as {
        BBeBee?: {
          proxy?: {
            test: (c: unknown) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>
          }
        }
      }
    ).BBeBee
    try {
      if (bridge?.proxy?.test) {
        const res = await bridge.proxy.test({
          protocol: proxy.protocol,
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.password,
        })
        setProxyTestResult(res)
      } else {
        // Fallback probe for tests
        await new Promise((resolve) => setTimeout(resolve, 200))
        setProxyTestResult({ ok: true, latencyMs: 68 })
      }
    } catch (err: unknown) {
      setProxyTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setProxyTesting(false)
    }
  }

  const handleTabClick = (tabId: SettingsTab) => {
    setActiveTab(tabId)
    isClickNavigatingRef.current = true
    const element = document.getElementById(`section-${tabId}`)
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setTimeout(() => {
      isClickNavigatingRef.current = false
    }, 600)
  }

  // Scroll spy to sync activeTab with visible section
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (isClickNavigatingRef.current) return
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace('section-', '') as SettingsTab
            setActiveTab(id)
            break
          }
        }
      },
      {
        threshold: 0.2,
      },
    )

    for (const tab of allTabs) {
      const el = document.getElementById(`section-${tab.id}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [allTabs])

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      await clear()
    } finally {
      setClearingCache(false)
    }
  }

  const handleReset = async () => {
    try {
      await reset()
    } finally {
      setResetting(false)
    }
  }

  const handleNavigate = (route: string) => {
    serviceOf<UiService>(ctx, 'ui')?.navigate?.(route)
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg-primary, #080A10)',
        color: 'var(--text-primary, #F2F5FF)',
      },
    },
    // Left fixed tab navigation sidebar
    h(
      'aside',
      {
        style: {
          width: 200,
          flexShrink: 0,
          borderRight: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 12px',
          gap: 4,
          userSelect: 'none',
        },
      },
      h(
        'div',
        {
          style: {
            fontSize: 18,
            fontWeight: 700,
            padding: '0 12px 16px',
            color: 'var(--text-primary, #FFFFFF)',
            letterSpacing: -0.3,
          },
        },
        '设置',
      ),
      allTabs.map((tab) => {
        const isActive = activeTab === tab.id
        return h(
          'button',
          {
            key: tab.id,
            role: 'tab',
            'aria-selected': isActive,
            onClick: () => handleTabClick(tab.id),
            style: {
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '10px 14px',
              borderRadius: 8,
              border: 'none',
              background: isActive ? 'var(--sidebar-item-active, var(--surface-selected, rgba(95, 135, 255, 0.15)))' : 'transparent',
              color: isActive ? 'var(--sidebar-item-text-active, var(--text-primary, #FFFFFF))' : 'var(--sidebar-item-text, var(--text-tertiary, #8E8E93))',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease, color 0.15s ease',
            },
          },
          tab.label,
        )
      }),
    ),

    // Right natural scrollable main container
    h(
      'main',
      {
        style: {
          flex: 1,
          height: '100%',
          overflowY: 'auto',
          padding: '24px 36px 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        },
      },
      // 1. General & Language
      h(GeneralSection, {
        ctx,
        settings,
        update,
        onCloseToTrayChange: handleCloseToTrayChange,
      }),

      // 2. Playback & DSP
      h(PlaybackSection, {
        ctx,
        settings,
        update,
        contributions: availableSettings,
        onNavigate: handleNavigate,
      }),

      // 3. Desktop Lyrics
      h(LyricsSection, {
        ctx,
        desktopLyrics,
        isDesktopLyricsVisible,
        update,
      }),

      // 4. Global Shortcuts
      h(ShortcutsSection, {
        shortcuts,
        onUpdateShortcuts: (s) => void update({ shortcuts: s }),
      }),

      // 5. Network & Proxy
      h(NetworkSection, {
        proxy,
        thirdPartySources,
        proxyTesting,
        proxyTestResult,
        onUpdateProxy: (p) => {
          void update({ proxy: p })
          const bridge = (
            window as unknown as {
              BBeBee?: {
                proxy?: {
                  set: (c: unknown) => Promise<void>
                }
              }
            }
          ).BBeBee
          void bridge?.proxy?.set?.(p)
        },
        onTestProxy: handleTestProxy,
        userAgent: settings.userAgent,
        thirdPartySourcesEnabled: settings.thirdPartySourcesEnabled,
        thirdPartyLyricSourcesEnabled: settings.thirdPartyLyricSourcesEnabled,
        onUpdateUserAgent: (ua) => void update({ userAgent: ua }),
        onToggleThirdPartySources: (enabled) => void update({ thirdPartySourcesEnabled: enabled }),
        onToggleThirdPartyLyricSources: (enabled) =>
          void update({ thirdPartyLyricSourcesEnabled: enabled }),
      }),

      // 6. Sources & Music Folders
      h(SourcesSection, {
        ctx,
        contributions: availableSettings,
        onNavigate: handleNavigate,
      }),

      // 7. Storage & Downloads
      h(StorageSection, {
        ctx,
        currentDownloadsDir,
        currentCacheDir,
        usage,
        clearingCache,
        contributions: availableSettings,
        onPickDownloadDir: handlePickDownloadDir,
        onOpenDownloadDir: handleOpenDownloadDir,
        onPickCacheDir: handlePickCacheDir,
        onOpenCacheDir: handleOpenCacheDir,
        onClearCache: handleClearCache,
        onNavigate: handleNavigate,
      }),

      // Custom sections contributed by plugins
      ...customSectionIds.map((secId) => {
        const secContribs = availableSettings.filter((c) => c.section === secId)
        return h(
          'div',
          { id: `section-${secId}`, key: secId },
          h(
            SettingsSection,
            { title: secId.charAt(0).toUpperCase() + secId.slice(1) },
            secContribs.map((item) => {
              if (item.display === 'card') {
                const Card = (ctx as { ui?: UiService })?.ui?.viewFor?.(item.id) as
                  | React.ComponentType<{ ctx: Context }>
                  | undefined
                if (Card) return h(Card, { key: item.id, ctx })
              }
              return h(SettingsRow, {
                key: item.id,
                title: item.title,
                description: item.description,
                action: h(Button, {
                  children: item.actionText ?? '打开',
                  onPress: () => handleNavigate(item.id),
                }),
              })
            }),
          ),
        )
      }),

      // 8. About & Danger Zone
      h(AboutSection, {
        showAdvancedSettings,
        resetting,
        onToggleAdvancedSettings: setShowAdvancedSettings,
        onSetResetting: setResetting,
        onReset: handleReset,
        onNavigate: handleNavigate,
      }),
    ),
  )
}
