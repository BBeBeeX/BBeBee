/**
 * React Native views for `@bbebee/plugin-settings`.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@bbebee/plugin-settings/views'
import { useAppSettings, useAvailableSettings, useCacheStats } from '@bbebee/plugin-settings/hooks'
import { Button, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { ContributionBlock, groupBySection } from './ContributionBlock.js'
import { SwitchRow } from './SchemaForm.js'

const p = () => palettes.dark

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function SettingsScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const { settings, update, reset } = useAppSettings(ctx)
  const { usage, clear } = useCacheStats(ctx)
  const availableSettings = useAvailableSettings(ctx)
  const grouped = groupBySection(availableSettings)

  const [clearingCache, setClearingCache] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

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
      setConfirmingReset(false)
    }
  }

  const handleNavigate = (route: string) => {
    ;(ctx as { ui?: UiService })?.ui?.navigate?.(route)
  }

  const playbackContribs = availableSettings.filter(
    (c) => c.section === 'playback' || c.section === 'audio',
  )
  const sourcesContribs = availableSettings.filter((c) => c.section === 'sources')
  const storageContribs = availableSettings.filter((c) => c.section === 'storage')
  const customSectionIds = Array.from(
    new Set(
      availableSettings
        .map((c) => c.section)
        .filter(
          (s) =>
            !['general', 'playback', 'audio', 'sources', 'storage', 'about'].includes(s),
        ),
    ),
  )

  const renderSectionHeader = (title: string, subtitle?: string) =>
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2], marginTop: tokens.space[4] } },
      h(Text, { variant: 'sm', tone: 'accent', children: title }),
      subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
    )

  const renderCard = (children: ReactNode[]) =>
    h(
      native.View as never,
      {
        style: {
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          borderRadius: tokens.radius.md,
          padding: tokens.space[3],
          gap: tokens.space[3],
        },
      },
      ...children,
    )

  const renderRow = (title: string, description: string | undefined, control: ReactNode) =>
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[3],
        },
      },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'md', children: title }),
        description ? h(Text, { variant: 'xs', tone: 'muted', children: description }) : null,
      ),
      control,
    )

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: p().bg.base,
        padding: tokens.space[4],
      },
      accessibilityLabel: t('settings:mobile.settings'),
    },
    // Screen Title
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2] } },
      h(Text, { variant: 'xl', children: t('settings:mobile.settings') }),
      h(Text, { variant: 'sm', tone: 'muted', children: t('settings:mobile.appWidePreferences') }),
    ),

    // 1. General Section
    renderSectionHeader(t('settings:mobile.appearanceLanguage'), t('settings:mobile.themeVisualMode')),
    renderCard([
      renderRow(
        t('settings:general.interfaceLanguage'),
        // Native names by convention (see GeneralSection.tsx): proper names,
        // identical in every locale, never translated.
        settings.language === 'zh' ? '中文' : settings.language === 'en' ? 'English' : t('settings:index.followSystem'),
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
          h(Button, {
            variant: settings.language === 'zh' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'zh' }),
            children: '中文',
          }),
          h(Button, {
            variant: settings.language === 'en' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'en' }),
            children: 'English',
          }),
          h(Button, {
            variant: settings.language === 'system' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'system' }),
            children: t('settings:index.followSystem'),
          }),
        ),
      ),
    ]),

    // General contributions (theme mode, profile, ...) rendered from descriptors
    ...(grouped.get('general') ?? []).map((c) =>
      h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }),
    ),

    // 2. Playback Section
    renderSectionHeader(t('settings:settings.playbackAudio'), t('settings:mobile.audioStreamJoining')),
    renderCard([
      renderRow(
        t('settings:mobile.audioOutputEngine'),
        t('settings:mobile.mpvEngine'),
        null,
      ),
    ]),

    // Playback / Audio contributed cards, links and schema forms
    ...playbackContribs.map((c) =>
      renderCard([h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate })]),
    ),

    // 3. Sources Section (if any contributions exist)
    sourcesContribs.length > 0
      ? h(
          native.View as never,
          { key: 'section-sources' },
          renderSectionHeader(t('settings:settings.librarySources'), t('settings:mobile.musicSourceManagement')),
          renderCard(sourcesContribs.map((c) => h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }))),
        )
      : null,

    // 4. Storage Section
    renderSectionHeader(t('settings:settings.storageCache'), t('settings:mobile.localTempFiles')),
    renderCard([
      renderRow(
        t('settings:storage.downloadFormat'),
        t('settings:storage.downloadFormatDesc'),
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
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
        }),
      ),
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
      ...storageContribs.map((c) => h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate })),
    ]),

    // 5. Custom Sections contributed by plugins
    ...customSectionIds.map((secId) => {
      const secContribs = availableSettings.filter((c) => c.section === secId)
      return h(
        native.View as never,
        { key: secId },
        renderSectionHeader(secId.charAt(0).toUpperCase() + secId.slice(1)),
        renderCard(secContribs.map((c) => h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }))),
      )
    }),

    // 6. About & Reset Section
    renderSectionHeader(t('settings:settings.about'), t('settings:mobile.versionReset')),
    renderCard([
      renderRow(t('settings:mobile.version'), 'BBeBee 0.1.0 · Cordis microkernel', null),
      confirmingReset
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', gap: tokens.space[2], justifyContent: 'flex-end' } },
            h(Button, {
              variant: 'primary',
              onPress: handleReset,
              children: t('settings:mobile.confirmReset'),
            }),
            h(Button, {
              variant: 'secondary',
              onPress: () => setConfirmingReset(false),
              children: t('app:common.cancel'),
            }),
          )
        : h(Button, {
            variant: 'secondary',
            onPress: () => setConfirmingReset(true),
            children: t('settings:mobile.restoreDefaults'),
          }),
    ]),
  )
}

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
  }, 'settings-ui-mobile')
}

export default { name, inject, apply }
