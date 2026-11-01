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
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@bbebee/plugin-settings/views'
import { useAppSettings, useAvailableSettings, useCacheStats } from '@bbebee/plugin-settings/hooks'
import { c, Button, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { ContributionBlock, groupBySection } from './ContributionBlock.js'
import { SwitchRow } from './SchemaForm.js'

const p = () => c()

/** The fixed settings categories: their sub-route, header title key and glyph. */
const SECTIONS = [
  { key: 'appearance', id: 'settings.appearance', titleKey: 'settings:mobile.sectionAppearance', icon: '◐' },
  { key: 'playback', id: 'settings.playback', titleKey: 'settings:mobile.sectionPlayback', icon: '♫' },
  { key: 'sources', id: 'settings.sources', titleKey: 'settings:mobile.sectionSources', icon: '☁︎' },
  { key: 'storage', id: 'settings.storage', titleKey: 'settings:mobile.sectionStorage', icon: '↓' },
  { key: 'about', id: 'settings.about', titleKey: 'settings:mobile.sectionAbout', icon: 'ⓘ' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

/** The section ids the fixed pages own; anything else renders inline at home. */
const FIXED_SECTION_IDS = ['general', 'playback', 'audio', 'sources', 'storage', 'about']

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function renderSectionHeader(title: string, subtitle?: string): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { marginBottom: tokens.space[2], marginTop: tokens.space[4] } },
    h(Text, { variant: 'sm', tone: 'accent', children: title }),
    subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
  )
}

function renderCard(children: ReactNode[]): ReactElement {
  const native = nativePrimitives()
  return h(
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
}

function renderRow(title: string, description: string | undefined, control: ReactNode): ReactElement {
  const native = nativePrimitives()
  return h(
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
}

/* ── the settings home: a directory of category rows ───────────────────── */

export function SettingsScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const availableSettings = useAvailableSettings(ctx)
  const customSectionIds = Array.from(
    new Set(
      availableSettings
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
        { style: { marginTop: tokens.space[2] } },
        ...SECTIONS.map((section) =>
          categoryRow(section.key, section.icon, t(section.titleKey), () => navigate(section.id)),
        ),
      ),
      // Plugin-contributed sections outside the five fixed ones: rendered
      // inline — they are dynamic, and a page per unknown id buys nothing.
      ...customSectionIds.map((secId) => {
        const secContribs = availableSettings.filter((contribution) => contribution.section === secId)
        return h(
          native.View as never,
          { key: secId, style: { paddingHorizontal: tokens.space[4] } },
          renderSectionHeader(secId.charAt(0).toUpperCase() + secId.slice(1)),
          renderCard(secContribs.map((contribution) => h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: (route: string) => navigate(route) }))),
        )
      }),
    ),
  )
}

/* ── the category sub-pages ─────────────────────────────────────────────── */

function SettingsSectionScreen({ ctx, sectionKey }: { ctx: Context; sectionKey: SectionKey }): ReactElement {
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
    (contribution) => contribution.section === 'playback' || contribution.section === 'audio',
  )
  const sourcesContribs = availableSettings.filter((contribution) => contribution.section === 'sources')
  const storageContribs = availableSettings.filter((contribution) => contribution.section === 'storage')

  // One page per category, carrying over the exact blocks the single page
  // used to render — nothing about a section's content changes, only where
  // it lives.
  const content =
    sectionKey === 'appearance'
      ? [
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
          ...(grouped.get('general') ?? []).map((contribution) =>
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
        : sectionKey === 'sources'
          ? [
              renderSectionHeader(t('settings:settings.librarySources'), t('settings:mobile.musicSourceManagement')),
              renderCard(sourcesContribs.map((contribution) => h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: handleNavigate }))),
            ]
          : sectionKey === 'storage'
            ? [
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
                  ...storageContribs.map((contribution) => h(ContributionBlock, { key: contribution.id, ctx, contribution, onNavigate: handleNavigate })),
                ]),
              ]
            : [
                // about
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
      ...content,
    ),
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
