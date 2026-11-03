/**
 * React Native views for `@bbebee/plugin-settings`.
 *
 * The settings home is a Spotify-style directory: one row per category —
 * icon, title, chevron — and every category's content lives on its own
 * sub-page. The five fixed sections are routes contributed here (placement
 * omitted, so they appear nowhere but programmatic navigation) with a view
 * apiece; the shell's header resolves their titles and Android Back unwinds
 * them like any other detail route. Contributions from plugins whose
 * section id is none of the five render inline at the bottom of the home
 * page — they are dynamic, and a page per unknown id buys nothing.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DownloadRegion, ProxySettings, SourcesService, UiService } from '@BBeBee/protocol'
import { DEFAULT_PROXY_SETTINGS, resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { SETTINGS_VIEWS } from '@bbebee/plugin-settings/views'
import { useAppSettings, useAvailableSettings, useCacheStats } from '@bbebee/plugin-settings/hooks'
import { isLocalSource, useAudioSourcesStatus, useSources } from '@bbebee/plugin-sources/hooks'
import { SourceConfigureModal } from '@bbebee/plugin-sources-ui-mobile'
import { c, Button, Select, Text, TextField, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { ContributionBlock, groupBySection } from './ContributionBlock.js'
import { SwitchRow } from './SchemaForm.js'
import { renderCard, renderRow, renderSectionHeader } from './layout.js'
import { AboutSection } from './AboutSection.js'
import { DebugScreen } from './DebugScreen.js'
import { LogsScreen } from './LogsScreen.js'
import { HttpLogsScreen } from './HttpLogsScreen.js'
import { ThemePaletteScreen } from './ThemePaletteScreen.js'

const p = () => c()

/** The fixed settings categories: their sub-route, header title key and glyph. */
const SECTIONS = [
  { key: 'appearance', id: 'settings.appearance', titleKey: 'settings:mobile.sectionAppearance', icon: '◐' },
  { key: 'playback', id: 'settings.playback', titleKey: 'settings:mobile.sectionPlayback', icon: '♫' },
  { key: 'network', id: 'settings.network', titleKey: 'settings:settings.networkProxy', icon: '⇄' },
  { key: 'sources', id: 'settings.sources', titleKey: 'settings:mobile.sectionSources', icon: '☁︎' },
  { key: 'storage', id: 'settings.storage', titleKey: 'settings:mobile.sectionStorage', icon: '↓' },
  { key: 'about', id: 'settings.about', titleKey: 'settings:mobile.sectionAbout', icon: 'ⓘ' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

/** The section ids the fixed pages own; anything else renders inline at home. */
const FIXED_SECTION_IDS = ['general', 'playback', 'audio', 'network', 'sources', 'storage', 'about']

/**
 * The width (dp) where the window counts as wide — the same 600dp divider
 * `apps/mobile/src/layout.ts` uses for the tablet/foldable dual pane.
 */
const WIDE_MIN_WIDTH = 600

/**
 * Cards excluded from the appearance & language page. The play-history,
 * car-mode and audio-converter screens keep their drawer entrances; their
 * settings cards are device features, not appearance preferences, so they
 * do not belong on this page.
 */
const APPEARANCE_EXCLUDED_CARD_IDS: ReadonlySet<string> = new Set([
  'history.view',
  'car-mode.view',
  'audio-converter.view',
])

/** The layout-mode card's contribution id (the composition root owns it). */
const LAYOUT_MODE_CARD_ID = 'mobile.layoutMode'

/**
 * The window width, through the injected hook. The injection's presence is
 * fixed at boot, so the conditional inside is stable across renders.
 */
function useWindowWidth(): number | undefined {
  const useDimensions = nativePrimitives().useWindowDimensions
  if (!useDimensions) return undefined
  return useDimensions().width
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/* ── the settings home: a directory of category rows ───────────────────── */

export function SettingsScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const availableSettings = useAvailableSettings(ctx)
  // A card contribution with no view on this target can only render the
  // "not available on this platform" placeholder; in the home directory that
  // is noise, so such a card is omitted and a section left with nothing
  // usable here does not appear at all. The category sub-pages keep the
  // explicit unavailable state (docs/08 §3).
  const usable = availableSettings.filter(
    (contribution) => contribution.display !== 'card' || !!ctx.ui?.viewFor?.(contribution.id),
  )
  const customSectionIds = Array.from(
    new Set(
      usable
        .map((contribution) => contribution.section)
        .filter((section) => !FIXED_SECTION_IDS.includes(section)),
    ),
  )

  const navigate = (route: string) => {
    ;(ctx as { ui?: UiService })?.ui?.navigate?.(route)
  }

  const categoryRow = (key: string, icon: string, title: string, onPress: () => void) =>
    h(
      native.Pressable as never,
      {
        key,
        onPress,
        accessibilityRole: 'button',
        accessibilityLabel: title,
        testID: `settings-category-${key}`,
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[4],
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255, 255, 255, 0.06)',
        },
      },
      h(Text, { style: { color: p().text.primary, fontSize: 20, width: 30, textAlign: 'center' } }, icon),
      h(Text, { style: { flex: 1, color: p().text.primary, fontSize: 16 } }, title),
      h(Text, { style: { color: p().text.secondary, fontSize: 20 } }, '›'),
    )

  return h(
    native.View as never,
    {
      style: { flex: 1, backgroundColor: p().bg.base },
      accessibilityLabel: t('settings:mobile.settings'),
    },
    h(
      native.ScrollView as never,
      {
        style: { flex: 1 },
        contentContainerStyle: { paddingBottom: 320 },
      },
      h(
        native.View as never,
        { style: { gap: tokens.space[4] } },
        h(
          native.View as never,
          { style: { marginTop: tokens.space[2] } },
          ...SECTIONS.map((section) =>
            categoryRow(section.key, section.icon, t(section.titleKey), () => navigate(section.id)),
          ),
        ),
        // Plugin-contributed sections outside the five fixed ones: rendered
        // inline — they are dynamic, and a page per unknown id buys nothing.
        ...customSectionIds.map((secId) => {
          const secContribs = usable.filter((contribution) => contribution.section === secId)
          return h(
            native.View as never,
            { key: secId, style: { paddingHorizontal: tokens.space[4] } },
            renderSectionHeader(secId.charAt(0).toUpperCase() + secId.slice(1)),
            renderCard(secContribs.map((contribution) => h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: (route: string) => navigate(route) }))),
          )
        }),
      ),
    ),
  )
}

/* ── the category sub-pages ─────────────────────────────────────────────── */

function SettingsSectionScreen({ ctx, sectionKey }: { ctx: Context; sectionKey: SectionKey }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const { settings, update, reset } = useAppSettings(ctx)
  const liquidGlass = resolveMobileLiquidGlassSettings(settings.liquidGlass)
  const { usage, clear } = useCacheStats(ctx)
  const availableSettings = useAvailableSettings(ctx)
  const grouped = groupBySection(availableSettings)

  const [clearingCache, setClearingCache] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)
  const [configuringSourceId, setConfiguringSourceId] = useState<string | undefined>(undefined)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>(undefined)

  const { items: audioSources, testConnection, testAll } = useAudioSourcesStatus(ctx)
  const thirdPartySources = useSources(ctx).filter((s) => s.id !== 'local')

  const connectedCount = audioSources.filter(
    (item) => item.enabled && (isLocalSource(item.record) || item.authStatus.state === 'authenticated' || item.ping?.status === 'ok'),
  ).length

  const proxy: ProxySettings = {
    ...DEFAULT_PROXY_SETTINGS,
    ...(settings.proxy ?? {}),
    sourceRules: {
      ...DEFAULT_PROXY_SETTINGS.sourceRules,
      ...(settings.proxy?.sourceRules ?? {}),
    },
  }

  const handleToggleSource = (id: string, enabled: boolean) => {
    const sourcesSvc = serviceOf<SourcesService>(ctx, 'sources')
    void sourcesSvc?.setEnabled?.(id, enabled)
  }

  const handleDeleteSource = (id: string) => {
    setConfirmingDeleteId(undefined)
    const sourcesSvc = serviceOf<SourcesService>(ctx, 'sources')
    void sourcesSvc?.remove?.(id, { forgetCatalogue: true })
  }

  const handleTestProxy = async () => {
    setProxyTesting(true)
    setProxyTestResult(null)
    try {
      const bridge = (
        typeof window !== 'undefined'
          ? (window as unknown as {
              BBeBee?: {
                proxy?: {
                  test: (c: unknown) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>
                }
              }
            }).BBeBee
          : undefined
      )
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
        const start = Date.now()
        const ctrl = new AbortController()
        const tId = setTimeout(() => ctrl.abort(), 5000)
        try {
          await fetch('https://www.google.com/generate_204', {
            method: 'HEAD',
            signal: ctrl.signal,
            mode: 'no-cors',
          })
          clearTimeout(tId)
          setProxyTestResult({ ok: true, latencyMs: Date.now() - start })
        } catch (err: unknown) {
          clearTimeout(tId)
          setProxyTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    } catch (err: unknown) {
      setProxyTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setProxyTesting(false)
    }
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

  const handleNavigate = (route: string, params?: Record<string, unknown>) => {
    ;(ctx as { ui?: UiService })?.ui?.navigate?.(route, params)
  }

  const playbackContribs = availableSettings.filter(
    (contribution) => contribution.section === 'playback' || contribution.section === 'audio',
  )
  const sourcesContribs = availableSettings.filter((contribution) => contribution.section === 'sources')
  const storageContribs = availableSettings.filter((contribution) => contribution.section === 'storage')

  const windowWidth = useWindowWidth()

  const content =
    sectionKey === 'appearance'
      ? [
          renderSectionHeader(t('settings:mobile.appearanceLanguage'), t('settings:mobile.themeVisualMode')),
          renderCard([
            renderRow(
              t('settings:general.interfaceLanguage'),
              t('settings:general.chooseTheDisplayLanguage'),
              h(Select<'zh' | 'en' | 'system'>, {
                value: settings.language,
                options: [
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                  { value: 'system', label: t('settings:index.followSystem') },
                ] as const,
                onChange: (language) => void update({ language }),
                accessibilityLabel: t('settings:general.interfaceLanguage'),
                testID: 'language-select',
                liquid: liquidGlass,
              }),
            ),
          ]),
          ...(grouped.get('general') ?? [])
            .filter((contribution) => {
              if (APPEARANCE_EXCLUDED_CARD_IDS.has(contribution.id)) return false
              if (contribution.id === LAYOUT_MODE_CARD_ID) {
                return windowWidth !== undefined && windowWidth >= WIDE_MIN_WIDTH
              }
              return true
            })
            .map((contribution) =>
              h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: handleNavigate }),
            ),
        ]
      : sectionKey === 'playback'
        ? [
            renderSectionHeader(t('settings:settings.playbackAudio'), t('settings:mobile.audioStreamJoining')),
            renderCard([
              renderRow(
                t('settings:mobile.audioOutputEngine'),
                t('settings:mobile.mpvEngine'),
                null,
              ),
            ]),
            ...playbackContribs.map((contribution) =>
              renderCard([h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: handleNavigate })]),
            ),
          ]
        : sectionKey === 'network'
          ? [
              renderSectionHeader(
                t('settings:network.thirdPartyServiceSettings'),
                t('settings:network.controlThirdPartyMusicAnd'),
              ),
              renderCard([
                renderRow(
                  t('settings:network.enableThirdPartyMusicSources'),
                  t('settings:network.whenOffSearchAndPlayback'),
                  h(SwitchRow, {
                    checked: settings.thirdPartySourcesEnabled ?? true,
                    accessibilityLabel: t('settings:network.enableThirdPartyMusicSources'),
                    onChange: (checked) => void update({ thirdPartySourcesEnabled: checked }),
                    liquid: liquidGlass,
                  }),
                ),
                renderRow(
                  t('settings:network.enableThirdPartyLyricSources'),
                  t('settings:network.whenOffLyricsAreNo'),
                  h(SwitchRow, {
                    checked: settings.thirdPartyLyricSourcesEnabled ?? true,
                    accessibilityLabel: t('settings:network.enableThirdPartyLyricSources'),
                    onChange: (checked) => void update({ thirdPartyLyricSourcesEnabled: checked }),
                    liquid: liquidGlass,
                  }),
                ),
                h(
                  native.View as never,
                  { style: { gap: tokens.space[1] } },
                  h(Text, { variant: 'md', children: t('settings:network.userAgent') }),
                  h(Text, { variant: 'xs', tone: 'muted', children: t('settings:network.userAgentDescription') }),
                  h(TextField, {
                    value: settings.userAgent || '',
                    placeholder: t('settings:network.userAgentPlaceholder'),
                    accessibilityLabel: t('settings:network.userAgent'),
                    onChange: (text) => void update({ userAgent: text }),
                  }),
                ),
              ]),
              renderSectionHeader(
                t('settings:network.networkProxySettings'),
                t('settings:network.configureTheProxyProtocolAnd'),
              ),
              renderCard([
                renderRow(
                  t('settings:network.enableNetworkProxy'),
                  t('settings:network.whenOnNetworkAndMusic'),
                  h(SwitchRow, {
                    checked: proxy.enabled,
                    accessibilityLabel: t('settings:network.enableNetworkProxy'),
                    onChange: (enabled) => void update({ proxy: { ...proxy, enabled } }),
                    liquid: liquidGlass,
                  }),
                ),
                ...(proxy.enabled
                  ? [
                      renderRow(
                        t('settings:network.proxyProtocol'),
                        t('settings:network.chooseTheTransportProtocolSupported'),
                        h(Select<'http' | 'https' | 'socks5'>, {
                          value: proxy.protocol,
                          options: [
                            { value: 'http', label: t('settings:network.hTTPProxy') },
                            { value: 'https', label: t('settings:network.hTTPSProxy') },
                            { value: 'socks5', label: t('settings:network.sOCKS5Proxy') },
                          ],
                          accessibilityLabel: t('settings:network.proxyProtocol'),
                          onChange: (protocol) => void update({ proxy: { ...proxy, protocol } }),
                          liquid: liquidGlass,
                        }),
                      ),
                      h(
                        native.View as never,
                        { style: { gap: tokens.space[1] } },
                        h(Text, { variant: 'md', children: t('settings:network.serverHostPort') }),
                        h(Text, { variant: 'xs', tone: 'muted', children: t('settings:network.setTheProxyServerHost') }),
                        h(
                          native.View as never,
                          { style: { flexDirection: 'row', gap: tokens.space[2], alignItems: 'center' } },
                          h(
                            native.View as never,
                            { style: { flex: 2 } },
                            h(TextField, {
                              value: proxy.host,
                              placeholder: t('settings:network.proxyHostPlaceholder'),
                              accessibilityLabel: t('settings:network.proxyServerHost'),
                              onChange: (host) => void update({ proxy: { ...proxy, host: host.trim() } }),
                            }),
                          ),
                          h(Text, { variant: 'md', tone: 'muted', children: ':' }),
                          h(
                            native.View as never,
                            { style: { flex: 1 } },
                            h(TextField, {
                              value: proxy.port ? String(proxy.port) : '',
                              placeholder: '7890',
                              accessibilityLabel: t('settings:network.proxyServerPort'),
                              onChange: (val) => void update({ proxy: { ...proxy, port: Number(val) || 0 } }),
                            }),
                          ),
                        ),
                        h(
                          native.View as never,
                          { style: { marginTop: tokens.space[1] } },
                          h(Button, {
                            variant: 'secondary',
                            disabled: proxyTesting || !proxy.host || !proxy.port,
                            loading: proxyTesting,
                            children: t('settings:network.testGoogleConnection'),
                            onPress: handleTestProxy,
                          }),
                        ),
                      ),
                      proxyTestResult
                        ? h(
                            native.View as never,
                            {
                              style: {
                                padding: tokens.space[2],
                                borderRadius: tokens.radius.sm,
                                backgroundColor: proxyTestResult.ok ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                              },
                            },
                            h(Text, {
                              variant: 'xs',
                              style: { color: proxyTestResult.ok ? '#22C55E' : '#EF4444' },
                              children: proxyTestResult.ok
                                ? t('settings:network.googleProbeReachable', { latencyMs: proxyTestResult.latencyMs ?? 0 })
                                : t('settings:network.proxyConnectionFailed', {
                                    error: proxyTestResult.error || t('settings:network.proxyConnectionTimedOut'),
                                  }),
                            }),
                          )
                        : null,
                      h(
                        native.View as never,
                        {
                          style: {
                            marginTop: tokens.space[2],
                            paddingTop: tokens.space[2],
                            borderTopWidth: 1,
                            borderTopColor: 'rgba(255, 255, 255, 0.08)',
                            gap: tokens.space[2],
                          },
                        },
                        h(Text, { variant: 'sm', tone: 'accent', children: t('settings:network.perSourceProxyRouting') }),
                        h(Text, { variant: 'xs', tone: 'muted', children: t('settings:network.perSourceProxyRoutingDesc') }),
                        ...(thirdPartySources.length > 0
                          ? thirdPartySources.map((s) =>
                              renderRow(
                                s.name || s.id,
                                s.group ? `${s.group} · ${s.sourceUrl}` : s.sourceUrl,
                                h(SwitchRow, {
                                  checked: proxy.sourceRules[s.id] ?? false,
                                  accessibilityLabel: t('settings:network.enableProxyFor', { name: s.name || s.id }),
                                  onChange: (checked) => {
                                    const nextRules = { ...proxy.sourceRules, [s.id]: checked }
                                    void update({ proxy: { ...proxy, sourceRules: nextRules } })
                                  },
                                  liquid: liquidGlass,
                                }),
                              ),
                            )
                          : [
                              h(Text, {
                                key: 'no-sources',
                                variant: 'xs',
                                tone: 'muted',
                                children: t('settings:network.noThirdPartySourcesYet'),
                              }),
                            ]),
                      ),
                    ]
                  : []),
              ]),
              renderSectionHeader(
                t('settings:network.downloadGitHubAcceleration'),
                t('settings:network.downloadSectionDesc'),
              ),
              renderCard([
                renderRow(
                  t('settings:network.downloadRegion'),
                  t('settings:network.storedDownloadRegionPreferenceGitHub'),
                  h(Select<DownloadRegion>, {
                    value: settings.downloadRegion ?? 'global',
                    options: [
                      { value: 'global', label: t('settings:network.global') },
                      { value: 'mainland-china', label: t('settings:network.mainlandChina') },
                    ],
                    accessibilityLabel: t('settings:network.downloadRegion'),
                    onChange: (downloadRegion) => void update({ downloadRegion }),
                    liquid: liquidGlass,
                  }),
                ),
                h(
                  native.View as never,
                  { style: { gap: tokens.space[1] } },
                  h(Text, { variant: 'md', children: t('settings:network.npmRegistryUrl') }),
                  h(Text, { variant: 'xs', tone: 'muted', children: t('settings:network.npmRegistryUrlDesc') }),
                  h(TextField, {
                    value: settings.npmRegistryUrl || '',
                    placeholder: t('settings:network.npmRegistryUrlPlaceholder'),
                    accessibilityLabel: t('settings:network.npmRegistryUrl'),
                    onChange: (text) => void update({ npmRegistryUrl: text }),
                  }),
                ),
                h(
                  native.View as never,
                  { style: { gap: tokens.space[1] } },
                  h(Text, { variant: 'md', children: t('settings:network.githubRawBaseUrl') }),
                  h(Text, { variant: 'xs', tone: 'muted', children: t('settings:network.githubRawBaseUrlDesc') }),
                  h(TextField, {
                    value: settings.githubRawBaseUrl || '',
                    placeholder: t('settings:network.githubRawBaseUrlPlaceholder'),
                    accessibilityLabel: t('settings:network.githubRawBaseUrl'),
                    onChange: (text) => void update({ githubRawBaseUrl: text }),
                  }),
                ),
              ]),
            ]
        : sectionKey === 'sources'
          ? [
              renderSectionHeader(t('settings:sources.musicSourcesFiles'), t('settings:sources.manageMusicSourceProvidersOnline')),
              ...sourcesContribs.map((contribution) =>
                renderCard([h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: handleNavigate })]),
              ),
              renderSectionHeader(t('settings:sources.configuredSources'), t('settings:sources.manageMusicSourceProvidersOnline')),
              renderCard([
                h(
                  native.View as never,
                  {
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingBottom: tokens.space[2],
                      borderBottomWidth: audioSources.length > 0 ? 1 : 0,
                      borderBottomColor: 'rgba(255, 255, 255, 0.08)',
                    },
                  },
                  h(
                    native.View as never,
                    { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
                    h(Text, { variant: 'md', children: t('settings:sources.configuredSources') }),
                    h(
                      native.View as never,
                      {
                        style: {
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 8,
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        },
                      },
                      h(Text, { variant: 'xs', tone: 'muted', children: `${connectedCount}/${audioSources.length}` }),
                    ),
                  ),
                  h(Button, {
                    variant: 'secondary',
                    testID: 'settings-sources-test-all',
                    disabled: audioSources.filter((s) => !isLocalSource(s.record)).length === 0,
                    onPress: () => void testAll(),
                    children: t('settings:sources.testAll'),
                  }),
                ),
                audioSources.length === 0
                  ? h(
                      native.View as never,
                      { style: { paddingVertical: tokens.space[4], alignItems: 'center' } },
                      h(Text, { variant: 'sm', tone: 'muted', children: t('settings:sources.viewEnabledOnlineSourcesRun') }),
                    )
                  : h(
                      native.View as never,
                      { style: { gap: tokens.space[3] } },
                      ...audioSources.map((item) => {
                        const local = isLocalSource(item.record)
                        const isAuth = item.authStatus.state === 'authenticated'
                        const isExpired = item.authStatus.state === 'expired'
                        const isAuthError = item.authStatus.state === 'error'
                        const pingStatus = item.ping?.status

                        let dotColor = '#94A3B8'
                        let probeText = t('settings:sources.offline')
                        let probeBg = 'rgba(255, 255, 255, 0.05)'
                        let probeColor = '#C5CAD8'

                        if (local) {
                          dotColor = item.enabled ? '#22C55E' : '#64748B'
                          probeText = t('settings:sources.ready')
                          probeBg = 'rgba(34, 197, 94, 0.15)'
                          probeColor = '#4ADE80'
                        } else if (!item.enabled) {
                          dotColor = '#64748B'
                          probeText = t('settings:sources.offline')
                          probeBg = 'rgba(255, 255, 255, 0.04)'
                          probeColor = '#64748B'
                        } else if (pingStatus === 'ok' || (isAuth && !pingStatus)) {
                          dotColor = '#22C55E'
                          probeText = item.ping?.latencyMs
                            ? `${item.ping.latencyMs}ms`
                            : item.ping?.serverVersion
                              ? `v${item.ping.serverVersion}`
                              : t('settings:sources.connected')
                          probeBg = 'rgba(34, 197, 94, 0.15)'
                          probeColor = '#4ADE80'
                        } else if (pingStatus === 'auth_failed' || isExpired || isAuthError) {
                          dotColor = '#F59E0B'
                          probeText = t('settings:sources.authFailed')
                          probeBg = 'rgba(245, 158, 11, 0.15)'
                          probeColor = '#FBBF24'
                        } else if (pingStatus === 'network_error') {
                          dotColor = '#EF4444'
                          probeText = t('settings:sources.networkError')
                          probeBg = 'rgba(239, 68, 68, 0.15)'
                          probeColor = '#F87171'
                        }

                        let authText = t('settings:sources.anonymous')
                        let authBg = 'rgba(255, 255, 255, 0.06)'
                        let authColor = '#C5CAD8'

                        if (local) {
                          authText = t('settings:sources.localFiles')
                          authBg = 'rgba(255, 255, 255, 0.06)'
                          authColor = '#C5CAD8'
                        } else if (item.authStatus.state === 'authenticated') {
                          authText = t('settings:sources.authenticated')
                          authBg = 'rgba(34, 197, 94, 0.12)'
                          authColor = '#4ADE80'
                        } else if (isExpired) {
                          authText = t('settings:sources.expired')
                          authBg = 'rgba(245, 158, 11, 0.15)'
                          authColor = '#FBBF24'
                        } else if (isAuthError) {
                          authText = t('settings:sources.authFailed')
                          authBg = 'rgba(239, 68, 68, 0.15)'
                          authColor = '#F87171'
                        }

                        const isConfirming = confirmingDeleteId === item.id

                        return h(
                          native.View as never,
                          {
                            key: item.id,
                            testID: `settings-source-item-${item.id}`,
                            style: {
                              padding: tokens.space[3],
                              borderRadius: tokens.radius.sm,
                              backgroundColor: 'rgba(255, 255, 255, 0.03)',
                              gap: tokens.space[2],
                              opacity: item.enabled ? 1 : 0.6,
                            },
                          },
                          h(
                            native.View as never,
                            {
                              style: {
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              },
                            },
                            h(
                              native.View as never,
                              {
                                style: {
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: tokens.space[2],
                                  flex: 1,
                                },
                              },
                              h(native.View as never, {
                                style: {
                                  width: 8,
                                  height: 8,
                                  borderRadius: 4,
                                  backgroundColor: dotColor,
                                },
                              }),
                              h(
                                native.View as never,
                                { style: { flex: 1 } },
                                h(Text, { variant: 'md', children: item.name }),
                                h(Text, {
                                  variant: 'xs',
                                  tone: 'muted',
                                  numberOfLines: 1,
                                  children: item.sourceUrl,
                                }),
                              ),
                            ),
                            h(
                              native.View as never,
                              { style: { flexDirection: 'row', gap: tokens.space[1] } },
                              h(
                                native.View as never,
                                {
                                  style: {
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                    borderRadius: 4,
                                    backgroundColor: authBg,
                                  },
                                },
                                h(Text, { variant: 'xs', style: { color: authColor }, children: authText }),
                              ),
                              h(
                                native.View as never,
                                {
                                  style: {
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                    borderRadius: 4,
                                    backgroundColor: probeBg,
                                  },
                                },
                                h(Text, { variant: 'xs', style: { color: probeColor }, children: probeText }),
                              ),
                            ),
                          ),
                          h(
                            native.View as never,
                            {
                              style: {
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                gap: tokens.space[2],
                                marginTop: tokens.space[1],
                              },
                            },
                            !local
                              ? h(Button, {
                                  variant: 'secondary',
                                  testID: `settings-source-test-${item.id}`,
                                  disabled: item.isPinging || !item.enabled,
                                  onPress: () => void testConnection(item.id),
                                  children: item.isPinging ? '…' : t('settings:sources.test'),
                                })
                              : null,
                            !local
                              ? h(Button, {
                                  variant: 'secondary',
                                  testID: `settings-source-configure-${item.id}`,
                                  onPress: () => setConfiguringSourceId(item.id),
                                  children: t('sources:sourcesList.configure'),
                                })
                              : null,
                            h(SwitchRow, {
                              checked: item.enabled,
                              accessibilityLabel: item.enabled
                                ? t('sources:sourcesList.disable')
                                : t('sources:sourcesList.enable'),
                              testID: `settings-source-toggle-${item.id}`,
                              onChange: (checked) => handleToggleSource(item.id, checked),
                              liquid: liquidGlass,
                            }),
                            !local
                              ? isConfirming
                                ? h(
                                    native.View as never,
                                    { style: { flexDirection: 'row', gap: tokens.space[1], alignItems: 'center' } },
                                    h(Button, {
                                      variant: 'primary',
                                      onPress: () => handleDeleteSource(item.id),
                                      children: t('app:common.delete'),
                                    }),
                                    h(Button, {
                                      variant: 'ghost',
                                      onPress: () => setConfirmingDeleteId(undefined),
                                      children: t('app:common.cancel'),
                                    }),
                                  )
                                : h(Button, {
                                    variant: 'ghost',
                                    testID: `settings-source-delete-${item.id}`,
                                    onPress: () => setConfirmingDeleteId(item.id),
                                    children: t('app:common.delete'),
                                  })
                              : null,
                          ),
                        )
                      }),
                    ),
              ]),
            ]
          : sectionKey === 'storage'
            ? [
                renderSectionHeader(t('settings:settings.storageCache'), t('settings:mobile.localTempFiles')),
                renderCard([
                  h(
                    native.View as never,
                    { style: { gap: tokens.space[1] } },
                    h(Text, { variant: 'md', children: t('settings:storage.downloadFormat') }),
                    h(Text, { variant: 'xs', tone: 'muted', children: t('settings:storage.downloadFormatDesc') }),
                    h(
                      native.View as never,
                      { style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap', marginTop: tokens.space[1] } },
                      h(Button, {
                        variant: (settings.downloadFormat ?? 'auto') === 'auto' ? 'primary' : 'secondary',
                        onPress: () => void update({ downloadFormat: 'auto' }),
                        children: t('settings:storage.formatAuto'),
                      }),
                      h(Button, {
                        variant: settings.downloadFormat === 'flac' ? 'primary' : 'secondary',
                        onPress: () => void update({ downloadFormat: 'flac' }),
                        children: 'FLAC',
                      }),
                      h(Button, {
                        variant: settings.downloadFormat === 'mp3' ? 'primary' : 'secondary',
                        onPress: () => void update({ downloadFormat: 'mp3' }),
                        children: 'MP3',
                      }),
                      h(Button, {
                        variant: settings.downloadFormat === 'mp4' ? 'primary' : 'secondary',
                        onPress: () => void update({ downloadFormat: 'mp4' }),
                        children: 'MP4',
                      }),
                    ),
                  ),
                  renderRow(
                    t('settings:storage.downloadWifiOnly'),
                    t('settings:storage.downloadWifiOnlyDesc'),
                    h(SwitchRow, {
                      checked: settings.downloadWifiOnly ?? false,
                      accessibilityLabel: t('settings:storage.downloadWifiOnly'),
                      onChange: (checked) => {
                        void update({ downloadWifiOnly: checked })
                        void (ctx as { downloads?: { setPolicy(p: { wifiOnly?: boolean }): Promise<void> } }).downloads?.setPolicy?.({ wifiOnly: checked })
                      },
                      liquid: liquidGlass,
                    }),
                  ),
                ]),
                renderCard([
                  renderRow(
                    t('settings:storage.cacheUsage'),
                    t('settings:mobile.totalArtwork', { total: formatBytes(usage.totalBytes), artwork: formatBytes(usage.artworkBytes) }),
                    h(Button, {
                      variant: 'secondary',
                      disabled: clearingCache || usage.totalBytes === 0,
                      loading: clearingCache,
                      onPress: handleClearCache,
                      children: t('settings:mobile.clearCache'),
                    }),
                  ),
                ]),
                ...storageContribs.map((contribution) =>
                  renderCard([h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: handleNavigate })]),
                ),
              ]
            : [
                // about — the desktop twin's AboutSection, on the phone's
                // primitives (see AboutSection.tsx).
                h(AboutSection, {
                  key: 'about',
                  ctx,
                  resetting,
                  onSetResetting: setResetting,
                  onReset: handleReset,
                  onNavigate: handleNavigate,
                }),
              ]

  return h(
    native.View as never,
    {
      style: { flex: 1, backgroundColor: p().bg.base },
      accessibilityLabel: t(`settings:mobile.section${sectionKey.charAt(0).toUpperCase()}${sectionKey.slice(1)}`),
    },
    h(
      native.ScrollView as never,
      {
        style: { flex: 1 },
        contentContainerStyle: { padding: tokens.space[4], paddingBottom: 320 },
      },
      h(
        native.View as never,
        { style: { gap: tokens.space[4] } },
        ...content,
      ),
    ),
    configuringSourceId
      ? h(SourceConfigureModal, {
          ctx,
          sourceId: configuringSourceId,
          open: Boolean(configuringSourceId),
          onClose: () => setConfiguringSourceId(undefined),
        })
      : null,
  )
}

export { DebugScreen } from './DebugScreen.js'
export { LogsScreen } from './LogsScreen.js'
export { HttpLogsScreen } from './HttpLogsScreen.js'
export { ThemePaletteScreen } from './ThemePaletteScreen.js'

export const name = 'plugin-settings-ui-mobile'
export const inject = ['ui', 'settings']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-settings-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SETTINGS_VIEWS.main, bound(ctx, SettingsScreen))
    // The debug & diagnostics page — the mobile twin of the desktop's
    // DebugScreen, reachable from the About page's "Open Debug center" row.
    yield ctx.ui.registerView(SETTINGS_VIEWS.debug, bound(ctx, DebugScreen))
    // The debug center's tool screens: the mobile twins of the desktop's
    // LogsScreen / HttpLogsScreen / ThemePaletteScreen.
    yield ctx.ui.registerView(SETTINGS_VIEWS.logs, bound(ctx, LogsScreen))
    yield ctx.ui.registerView(SETTINGS_VIEWS.httpLogs, bound(ctx, HttpLogsScreen))
    yield ctx.ui.registerView(SETTINGS_VIEWS.themePalette, bound(ctx, ThemePaletteScreen))
    // One route + view per fixed category: no placement, so the sub-pages
    // surface only through the settings home's rows — never in the desktop
    // sidebar/tray, and (via the shell's excluded set) never in the drawer.
    for (const section of SECTIONS) {
      yield ctx.ui.contribute({
        kind: 'route',
        id: section.id,
        path: `/settings/${section.key}`,
        title: section.titleKey,
        order: 100,
      })
      yield ctx.ui.registerView(
        section.id,
        bound(ctx, (props: { ctx: Context }) => h(SettingsSectionScreen, { ctx: props.ctx, sectionKey: section.key })),
      )
    }
  }, 'settings-ui-mobile')
}

export default { name, inject, apply }
