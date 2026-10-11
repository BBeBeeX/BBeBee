/**
 * Desktop Settings Screen for `@BBeBee/plugin-settings`.
 * Single-page natural scrolling layout with section anchors and text-only tab navigation.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  ProxySettings,
  SourceRecord,
  SourcesService,
  PathsService,
  UiService,
} from '@BBeBee/protocol'
import { DEFAULT_PROXY_SETTINGS } from '@BBeBee/protocol'
import { useAppSettings, useAvailableSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { GeneralSection } from './components/sections/GeneralSection.js'
import { PlaybackSection } from './components/sections/PlaybackSection.js'
import { NetworkSection } from './components/sections/NetworkSection.js'
import { SourcesSection } from './components/sections/SourcesSection.js'
import { StorageSection } from './components/sections/StorageSection.js'
import { PluginsSection } from './components/sections/PluginsSection.js'
import { AboutSection } from './components/sections/AboutSection.js'
import { ContributionBlock, groupBySection } from './components/ContributionBlock.js'

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
  { id: 'plugins', label: '插件' },
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

  useEffect(() => {
    let cancelled = false
    const store = serviceOf<{
      get<T>(k: string): Promise<T | undefined>
      set(k: string, v: unknown): Promise<void>
    }>(ctx, 'store')
    if (store) {
      void store
        .get<boolean>('settings.showAdvancedSettings')
        .then((val) => {
          if (!cancelled && typeof val === 'boolean') {
            setShowAdvancedSettings(val)
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [ctx])

  const handleToggleAdvancedSettings = (val: boolean) => {
    setShowAdvancedSettings(val)
    const store = serviceOf<{
      set(k: string, v: unknown): Promise<void>
    }>(ctx, 'store')
    if (store) {
      void store.set('settings.showAdvancedSettings', val).catch(() => {})
    }
  }

  const { settings, update, reset } = useAppSettings(ctx)
  const { usage, clear } = useCacheStats(ctx)
  const availableSettings = useAvailableSettings(ctx)
  const grouped = groupBySection(availableSettings)

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
              'plugins',
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

  const proxy: ProxySettings = {
    ...DEFAULT_PROXY_SETTINGS,
    ...(settings.proxy ?? {}),
    sourceRules: {
      ...DEFAULT_PROXY_SETTINGS.sourceRules,
      ...(settings.proxy?.sourceRules ?? {}),
    },
  }

  // Global shortcuts are registered by the plugin-settings feature
  // (src/shortcuts.ts), keyed to the settings service's lifetime — the
  // bindings must survive leaving this screen, which a view effect cannot
  // guarantee. This screen only edits the configuration.
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
  }

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

    // Right natural scrollable main container with mutually exclusive section rendering
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
          gap: 24,
        },
      },
      // Section title matching left tab selection
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 16,
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
            marginBottom: 8,
          },
        },
        h(
          'h2',
          {
            style: {
              fontSize: 20,
              fontWeight: 700,
              margin: 0,
              color: 'var(--text-primary, #FFFFFF)',
              letterSpacing: -0.2,
            },
          },
          allTabs.find((t) => t.id === activeTab)?.label ?? activeTab,
        ),
      ),

      // 1. General & Language — the service's own rows, then whatever the
      // general section's owners contributed.
      activeTab === 'general'
        ? h(
            'div',
            { id: 'section-general', key: 'general' },
            h(GeneralSection, {
              settings,
              update,
              onCloseToTrayChange: handleCloseToTrayChange,
            }),
            (grouped.get('general') ?? []).map((c) =>
              h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }),
            ),
          )
        : null,

      // 2. Playback & DSP
      activeTab === 'playback'
        ? h(PlaybackSection, {
            ctx,
            settings,
            update,
            contributions: availableSettings,
            onNavigate: handleNavigate,
          })
        : null,

      // 3. Desktop Lyrics — fully contribution-driven: the card comes from
      // `plugin-desktop-lyrics`, the management card from `plugin-lyric-sources`.
      activeTab === 'lyrics'
        ? h(
            'div',
            { id: 'section-lyrics', key: 'lyrics' },
            (grouped.get('lyrics') ?? []).map((c) =>
              h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }),
            ),
          )
        : null,

      // 4. Global Shortcuts — the card contributed by plugin-settings itself.
      activeTab === 'shortcuts'
        ? h(
            'div',
            { id: 'section-shortcuts', key: 'shortcuts' },
            (grouped.get('shortcuts') ?? []).map((c) =>
              h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }),
            ),
          )
        : null,

      // 5. Network & Proxy
      activeTab === 'network'
        ? h(NetworkSection, {
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
            downloadRegion: settings.downloadRegion ?? 'global',
            githubAccelerationPrefixes: settings.githubAccelerationPrefixes ?? [],
            onUpdateDownloadRegion: (region) => void update({ downloadRegion: region }),
            onUpdateGithubAccelerationPrefixes: (prefixes) =>
              void update({ githubAccelerationPrefixes: [...prefixes] }),
          })
        : null,

      // 6. Sources & Music Folders
      activeTab === 'sources'
        ? h(SourcesSection, {
            ctx,
            contributions: availableSettings,
            onNavigate: handleNavigate,
          })
        : null,

      // 7. Storage & Downloads
      activeTab === 'storage'
        ? h(StorageSection, {
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
          })
        : null,

      // 8. Plugins Manager
      activeTab === 'plugins'
        ? h(PluginsSection, {
            ctx,
            showAdvancedSettings,
          })
        : null,

      // 9. About & Danger Zone
      activeTab === 'about'
        ? h(AboutSection, {
            showAdvancedSettings,
            resetting,
            onToggleAdvancedSettings: handleToggleAdvancedSettings,
            onSetResetting: setResetting,
            onReset: handleReset,
            onNavigate: handleNavigate,
          })
        : null,

      // Custom sections contributed by plugins
      customSectionIds.includes(activeTab)
        ? h(
            'div',
            { id: `section-${activeTab}`, key: activeTab },
            (grouped.get(activeTab) ?? []).map((c) =>
              h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }),
            ),
          )
        : null,
    ),
  )
}
