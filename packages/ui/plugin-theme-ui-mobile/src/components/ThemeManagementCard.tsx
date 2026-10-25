import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  AppSettings,
  DynamicThemeScheme,
  ThemeCategory,
  ThemeDefinition,
  ThemePack,
  ThemeService,
} from '@BBeBee/protocol'
import { DEFAULT_DYNAMIC_THEME_SETTINGS } from '@BBeBee/protocol'
import { builtInThemes, tokens } from '@BBeBee/ui-tokens'
import { REGISTRY_VIEWS } from '@bbebee/plugin-registry/views'
import { Button, Slider, Text, nativePrimitives, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Chip } from './Chip.js'
import { ImportSheet } from './ImportSheet.js'
import type { ThemeImportResult } from '../import.js'

/**
 * The mobile theme management card: fills `plugin-theme`'s `theme.settings`
 * descriptor on the settings screen, the same contract
 * `plugin-theme-ui-desktop` fills there.
 *
 * Four categories, as on desktop, minus what React Native cannot honour:
 * 通用 (builtin + plugin packs), 自动 (cover-derived dynamic theme and its
 * matugen preferences — both consumed headlessly by the theme service),
 * 自定义 (paste/file import, deletable), 浏览 (a link into the registry's
 * Discover route, which owns theme browsing on mobile — the card does not
 * duplicate the registry UI). Appearance mode (system/dark/light) sits above
 * the tabs. Glass settings are desktop-only (CSS-variable and OS-window
 * effects) and are deliberately absent here.
 */

type SettingsLike = { getSync(): AppSettings; update(p: unknown): Promise<unknown> }

const CATEGORIES: readonly { id: ThemeCategory; labelKey: string; descKey: string }[] = [
  { id: 'builtin', labelKey: 'theme:themeManagement.categoryGeneral', descKey: 'theme:themeManagement.generalDesc' },
  { id: 'dynamic', labelKey: 'theme:themeManagement.categoryAuto', descKey: 'theme:themeManagement.dynamicDesc' },
  { id: 'custom', labelKey: 'theme:themeManagement.categoryCustom', descKey: 'theme:themeManagement.customDesc' },
  { id: 'registry', labelKey: 'theme:themeManagement.categoryBrowse', descKey: 'theme:themeManagement.browseDesc' },
]

const SCHEMES: readonly DynamicThemeScheme[] = ['tonal-spot', 'vibrant', 'expressive', 'content', 'neutral']

/** Packs from the service when it speaks packs, else wrapped from themes. */
function readPacks(ctx: Context): ThemePack[] {
  const svc = serviceOf<ThemeService>(ctx, 'theme')
  if (svc?.getPacks) return [...svc.getPacks()]
  const themes = svc?.getThemes?.() ?? []
  const byPack = new Map<string, ThemePack>()
  for (const theme of themes) {
    const packId = theme.packId ?? theme.id
    const origin = theme.origin ?? (theme.id in builtInThemes ? 'builtin' : 'custom')
    const pack = byPack.get(packId) ?? {
      id: packId,
      name: theme.name,
      description: theme.description,
      origin,
      variants: [],
    }
    ;(pack.variants as ThemeDefinition[]).push(theme)
    byPack.set(packId, pack)
  }
  return [...byPack.values()]
}

function categoryOfPack(pack: ThemePack): ThemeCategory {
  switch (pack.origin) {
    case 'dynamic':
      return 'dynamic'
    case 'custom':
      return 'custom'
    case 'registry':
      return 'registry'
    default:
      return 'builtin'
  }
}

function previewColors(pack: ThemePack): readonly [string, string, string] {
  if (pack.preview?.colors) return pack.preview.colors
  const first = pack.variants[0]
  if (!first) return ['#111111', '#222222', '#888888']
  return [first.tokens.bg.primary, first.tokens.surface.s1, first.tokens.brand.primary]
}

export function ThemeManagementCard({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const p = usePalette()

  const settings = serviceOf<SettingsLike>(ctx, 'settings')
  const themeService = serviceOf<ThemeService>(ctx, 'theme')

  const [packs, setPacks] = useState<ThemePack[]>(() => readPacks(ctx))
  const [currentThemeId, setCurrentThemeId] = useState<string>(
    () => settings?.getSync()?.themeId ?? themeService?.getCurrentTheme?.().id ?? 'midnight-purple',
  )
  const [appearanceMode, setAppearanceMode] = useState<'system' | 'dark' | 'light'>(
    () => (settings?.getSync()?.theme as 'system' | 'dark' | 'light') ?? 'dark',
  )
  const [category, setCategory] = useState<ThemeCategory>(
    () => settings?.getSync()?.themeCategory ?? 'builtin',
  )
  const [showImport, setShowImport] = useState(false)
  const [lastImportLabel, setLastImportLabel] = useState<string | null>(null)

  useEffect(() => {
    const update = () => {
      setPacks(readPacks(ctx))
      const svc = serviceOf<ThemeService>(ctx, 'theme')
      const current = serviceOf<SettingsLike>(ctx, 'settings')?.getSync()
      setCurrentThemeId(current?.themeId ?? svc?.getCurrentTheme?.().id ?? 'midnight-purple')
      if (current?.theme) setAppearanceMode(current.theme)
      if (current?.themeCategory) setCategory(current.themeCategory)
    }
    update()
    const offs = [
      ctx.on('theme/registry-changed', update),
      ctx.on('theme/changed', update),
      ctx.on('theme/packs-changed', update),
      ctx.on('settings/changed', update),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [ctx])

  const currentPack = packs.find((pack) => pack.variants.some((v) => v.id === currentThemeId))
  const currentLabel =
    currentPack?.name ??
    currentPack?.variants[0]?.name ??
    themeService?.getCurrentTheme?.().name ??
    currentThemeId

  const handleAppearanceModeChange = (mode: 'system' | 'dark' | 'light'): void => {
    setAppearanceMode(mode)
    void settings?.update({ theme: mode })
  }

  const handleCategoryChange = (next: ThemeCategory): void => {
    setCategory(next)
    void settings?.update({ themeCategory: next })
  }

  const handleThemeChange = (themeId: string, knownPack?: { id: string; category: ThemeCategory }): void => {
    const pack = packs.find((candidate) => candidate.variants.some((v) => v.id === themeId))
    const patch: Partial<AppSettings> = { themeId }
    if (knownPack) {
      patch.themePackId = knownPack.id
      patch.themeCategory = knownPack.category
    } else if (pack) {
      patch.themePackId = pack.id
      patch.themeCategory = categoryOfPack(pack)
    }
    void settings?.update(patch)
    void themeService?.setTheme?.(themeId)
  }

  const handleDeletePack = (packId: string): void => {
    if (themeService?.removePack) {
      themeService.removePack(packId)
      return
    }
    const pack = packs.find((candidate) => candidate.id === packId)
    for (const variant of pack?.variants ?? []) themeService?.removeTheme?.(variant.id)
  }

  const updateDynamic = (patch: Partial<AppSettings['dynamicTheme']>): void => {
    const current = settings?.getSync()?.dynamicTheme ?? { ...DEFAULT_DYNAMIC_THEME_SETTINGS }
    void settings?.update({ dynamicTheme: { ...current, ...patch } })
  }

  const handleImported = (result: ThemeImportResult): void => {
    if (result.kind === 'pack') {
      if (themeService?.registerThemePack) {
        themeService.registerThemePack(result.pack)
      } else {
        for (const variant of result.pack.variants) {
          themeService?.registerTheme?.({ ...variant, packId: result.pack.id, origin: 'custom' })
        }
      }
      handleThemeChange(result.pack.variants[0]!.id, { id: result.pack.id, category: 'custom' })
    } else {
      themeService?.registerTheme?.({ ...result.theme, origin: 'custom', packId: result.theme.id })
      handleThemeChange(result.theme.id, { id: result.theme.id, category: 'custom' })
    }
    setLastImportLabel(result.label)
    setShowImport(false)
  }

  /* ── shared render bits ────────────────────────────────────────────────── */

  const renderPackGroup = (pack: ThemePack, deletable: boolean): ReactElement => {
    const colors = previewColors(pack)
    const showHeader = pack.variants.length > 1 || pack.name !== pack.variants[0]?.name
    return h(
      native.View as never,
      { key: pack.id, testID: `theme-pack-${pack.id}`, style: { gap: tokens.space[2] } },
      showHeader
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
            h(
              native.View as never,
              { style: { flexDirection: 'row', gap: 3 } },
              colors.map((color, i) =>
                h(native.View as never, {
                  key: i,
                  style: { width: 10, height: 10, borderRadius: 5, backgroundColor: color },
                }),
              ),
            ),
            h(Text, { variant: 'sm' }, pack.name ?? pack.id),
            h(
              native.View as never,
              { style: { flex: 1 } },
            ),
            deletable
              ? h(Button, {
                  variant: 'ghost',
                  testID: `delete-pack-${pack.id}`,
                  accessibilityLabel: t('theme:themeManagement.deletePack', { name: pack.name ?? pack.id }),
                  onPress: () => handleDeletePack(pack.id),
                  children: t('theme:themeManagement.deletePackLabel'),
                })
              : null,
          )
        : null,
      h(
        native.View as never,
        { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] } },
        pack.variants.map((variant) =>
          h(Chip, {
            key: variant.id,
            label: variant.name ?? variant.id,
            selected: currentThemeId === variant.id,
            onPress: () => handleThemeChange(variant.id),
            testID: `theme-option-${variant.id}`,
            swatch: variant.tokens?.brand?.primary,
          }),
        ),
      ),
    )
  }

  const packsIn = (cat: ThemeCategory): ThemePack[] => packs.filter((pack) => categoryOfPack(pack) === cat)

  const sectionCard = (children: ReactElement[]): ReactElement =>
    h(
      native.View as never,
      {
        style: {
          backgroundColor: p.bg.raised,
          borderRadius: tokens.radius.md,
          padding: tokens.space[3],
          gap: tokens.space[3],
        },
      },
      ...children,
    )

  /* ── category panels ──────────────────────────────────────────────────── */

  const renderGeneral = (): ReactElement =>
    h(
      native.View as never,
      { testID: 'theme-panel-builtin', style: { gap: tokens.space[3] } },
      packsIn('builtin').map((pack) => renderPackGroup(pack, false)),
    )

  const renderDynamic = (): ReactElement => {
    const dynamicPack = packs.find((pack) => pack.origin === 'dynamic')
    const dynSettings = settings?.getSync()?.dynamicTheme ?? { ...DEFAULT_DYNAMIC_THEME_SETTINGS }
    return h(
      native.View as never,
      { testID: 'theme-panel-dynamic', style: { gap: tokens.space[3] } },
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
        h(native.View as never, {
          style: {
            width: 44,
            height: 44,
            borderRadius: tokens.radius.sm,
            backgroundColor: dynamicPack ? previewColors(dynamicPack)[2] : p.bg.overlay,
          },
        }),
        h(
          native.View as never,
          { style: { flex: 1, gap: 2 } },
          h(Text, { variant: 'sm' }, t('theme:themeManagement.dynamicSource')),
          h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.dynamicSourceDesc')),
        ),
      ),
      dynamicPack
        ? h(Chip, {
            label: t('theme:themeManagement.dynamicEnable'),
            selected: currentThemeId === 'dynamic-cover',
            onPress: () => handleThemeChange('dynamic-cover'),
            testID: 'theme-option-dynamic-cover',
          })
        : null,
      h(
        native.View as never,
        { style: { flexWrap: 'wrap', flexDirection: 'row', gap: tokens.space[2] } },
        SCHEMES.map((scheme) =>
          h(Chip, {
            key: scheme,
            label: t(`theme:themeManagement.scheme_${scheme.replace('-', '_')}`),
            selected: dynSettings.scheme === scheme,
            onPress: () => updateDynamic({ scheme }),
            testID: `dynamic-scheme-${scheme}`,
          }),
        ),
      ),
      h(
        native.View as never,
        { style: { gap: tokens.space[1] } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.dynamicContrast')),
        // The kit's Slider runs 0..max; the matugen range is -100..100, so the
        // value rides +100 and lands back on write.
        h(Slider, {
          value: dynSettings.contrast + 100,
          max: 200,
          onCommit: (value: number) => updateDynamic({ contrast: value - 100 }),
          testID: 'dynamic-contrast',
          accessibilityLabel: t('theme:themeManagement.dynamicContrast'),
        }),
      ),
    )
  }

  const renderCustom = (): ReactElement =>
    h(
      native.View as never,
      { testID: 'theme-panel-custom', style: { gap: tokens.space[3] } },
      h(Button, {
        variant: 'secondary',
        testID: 'import-theme-button',
        onPress: () => setShowImport(true),
        children: t('theme:themeManagement.importTheme'),
      }),
      lastImportLabel
        ? h(
            native.View as never,
            { testID: 'custom-last-import', style: { gap: tokens.space[1] } },
            h(Text, { variant: 'xs', tone: 'muted' }, lastImportLabel),
          )
        : null,
      packsIn('custom').length === 0
        ? h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.customEmpty'))
        : packsIn('custom').map((pack) => renderPackGroup(pack, true)),
    )

  const renderRegistry = (): ReactElement =>
    h(
      native.View as never,
      { testID: 'theme-panel-registry', style: { gap: tokens.space[3] } },
      h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.browseDesc')),
      // Theme browsing lives in the registry's own screen — the same route
      // the registry plugin contributes and the mobile registry UI fills.
      // Installing from here would duplicate it, so the card links instead.
      h(Button, {
        variant: 'secondary',
        testID: 'browse-registry-link',
        accessibilityLabel: t('theme:themeManagement.browseRefresh'),
        onPress: () => ctx.ui?.navigate?.(REGISTRY_VIEWS.screen),
        children: t('theme:themeManagement.browseRefresh'),
      }),
      packsIn('registry').length > 0
        ? packsIn('registry').map((pack) => renderPackGroup(pack, true))
        : null,
    )

  /* ── root ─────────────────────────────────────────────────────────────── */

  const activeDescKey = CATEGORIES.find((entry) => entry.id === category)?.descKey ?? CATEGORIES[0]!.descKey

  return h(
    native.View as never,
    {
      testID: 'theme-management-card',
      style: {
        backgroundColor: p.bg.raised,
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
        gap: tokens.space[3],
      },
    },
    h(
      native.View as never,
      { style: { gap: 3 } },
      h(Text, { variant: 'md' }, t('theme:themeManagement.appearanceMode')),
      h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.appearanceModeDesc')),
      h(
        native.View as never,
        {
          accessibilityLabel: t('theme:themeManagement.appearanceMode'),
          style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] },
        },
        ([
          { id: 'system', labelKey: 'theme:themeManagement.followSystem' },
          { id: 'dark', labelKey: 'theme:themeManagement.darkMode' },
          { id: 'light', labelKey: 'theme:themeManagement.lightMode' },
        ] as const).map((mode) =>
          h(Chip, {
            key: mode.id,
            label: t(mode.labelKey),
            selected: appearanceMode === mode.id,
            onPress: () => handleAppearanceModeChange(mode.id),
            testID: `appearance-mode-${mode.id}`,
          }),
        ),
      ),
    ),
    h(
      native.View as never,
      { style: { gap: 3 } },
      h(
        Text,
        { variant: 'sm', testID: 'current-theme-label' },
        `${t('theme:themeManagement.currentTheme')}：${currentLabel}`,
      ),
      h(Text, { variant: 'xs', tone: 'muted' }, t(activeDescKey)),
    ),
    h(
      native.View as never,
      {
        accessibilityLabel: t('theme:themeManagement.interfaceTheme'),
        style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] },
      },
      CATEGORIES.map((entry) =>
        h(Chip, {
          key: entry.id,
          label: t(entry.labelKey),
          selected: category === entry.id,
          onPress: () => handleCategoryChange(entry.id),
          testID: `theme-category-${entry.id}`,
        }),
      ),
    ),
    sectionCard([
      category === 'builtin'
        ? renderGeneral()
        : category === 'dynamic'
          ? renderDynamic()
          : category === 'custom'
            ? renderCustom()
            : renderRegistry(),
    ]),
    h(ImportSheet, {
      ctx,
      open: showImport,
      onClose: () => setShowImport(false),
      onImported: handleImported,
    }),
  )
}
