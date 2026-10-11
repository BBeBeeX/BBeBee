/**
 * React Native views for `@BBeBee/plugin-settings`.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@BBeBee/plugin-settings/views'
import { useAppSettings, useAvailableSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { Button, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { ContributionBlock, groupBySection } from './ContributionBlock.js'

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
      accessibilityLabel: 'Settings',
    },
    // Screen Title
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2] } },
      h(Text, { variant: 'xl', children: 'Settings' }),
      h(Text, { variant: 'sm', tone: 'muted', children: 'App-wide preferences and playback configuration' }),
    ),

    // 1. General Section
    renderSectionHeader('Appearance & language', 'Theme visual mode and multilingual configuration'),
    renderCard([
      renderRow(
        'Interface language',
        settings.language === 'zh' ? 'Simplified Chinese' : settings.language === 'en' ? 'English' : 'Follow system',
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
          h(Button, {
            variant: settings.language === 'zh' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'zh' }),
            children: 'Chinese',
          }),
          h(Button, {
            variant: settings.language === 'en' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'en' }),
            children: 'EN',
          }),
          h(Button, {
            variant: settings.language === 'system' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'system' }),
            children: 'Auto',
          }),
        ),
      ),
    ]),

    // General contributions (theme mode, profile, ...) rendered from descriptors
    ...(grouped.get('general') ?? []).map((c) =>
      h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }),
    ),

    // 2. Playback Section
    renderSectionHeader('Playback & Audio', 'Audio stream joining and playback behavior'),
    renderCard([
      renderRow(
        'Audio output engine',
        'WebAudio system-native engine (iOS CoreAudio / Android Oboe)',
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
          h(Button, {
            variant: 'primary',
            onPress: () => void update({ audioOutputEngine: 'webaudio' }),
            children: 'WebAudio',
          }),
          h(Button, {
            variant: 'secondary',
            disabled: true,
            onPress: () => {},
            children: 'MPV Hi-Fi (planned)',
          }),
        ),
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
          renderSectionHeader('Library & sources', 'Music source management and import'),
          renderCard(sourcesContribs.map((c) => h(ContributionBlock, { key: c.id, ctx, contribution: c, onNavigate: handleNavigate }))),
        )
      : null,

    // 4. Storage Section
    renderSectionHeader('Storage & cache', 'Local temporary file management'),
    renderCard([
      renderRow(
        'Cache usage',
        `Total: ${formatBytes(usage.totalBytes)} (artwork: ${formatBytes(usage.artworkBytes)})`,
        h(Button, {
          variant: 'secondary',
          disabled: clearingCache || usage.totalBytes === 0,
          loading: clearingCache,
          onPress: handleClearCache,
          children: 'Clear cache',
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
    renderSectionHeader('About', 'Version and system reset'),
    renderCard([
      renderRow('Version', 'BBeBee 0.1.0 · Cordis microkernel', null),
      confirmingReset
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', gap: tokens.space[2], justifyContent: 'flex-end' } },
            h(Button, {
              variant: 'primary',
              onPress: handleReset,
              children: 'Confirm reset',
            }),
            h(Button, {
              variant: 'secondary',
              onPress: () => setConfirmingReset(false),
              children: 'Cancel',
            }),
          )
        : h(Button, {
            variant: 'secondary',
            onPress: () => setConfirmingReset(true),
            children: 'Restore defaults',
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
