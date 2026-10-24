import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  AppSettings,
  DynamicThemeScheme,
  GlassSettings,
  GlassSurfaceId,
  RegistryEntry,
  RegistryService,
  ThemeCategory,
  ThemeDefinition,
  ThemePack,
  ThemeService,
} from '@BBeBee/protocol'
import { DEFAULT_GLASS_SETTINGS } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Sheet, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { builtInThemes, midnightPurpleTheme } from '@BBeBee/ui-tokens'

/**
 * The theme management card: four category tabs (通用 built-in + plugin
 * packs / 自动 cover-derived dynamic / 自定义 locally imported / 浏览
 * registry packs), appearance mode, and the glass settings (window layer
 * B + component layer A). Owns nothing but view state — themes live in
 * `ctx.theme` as packs, the selection and all preferences in the settings
 * document.
 */

type SettingsLike = { getSync(): AppSettings; update(p: unknown): Promise<unknown> }

const CATEGORIES: readonly { id: ThemeCategory; labelKey: string; descKey: string }[] = [
  { id: 'builtin', labelKey: 'theme:themeManagement.categoryGeneral', descKey: 'theme:themeManagement.generalDesc' },
  { id: 'dynamic', labelKey: 'theme:themeManagement.categoryAuto', descKey: 'theme:themeManagement.dynamicDesc' },
  { id: 'custom', labelKey: 'theme:themeManagement.categoryCustom', descKey: 'theme:themeManagement.customDesc' },
  { id: 'registry', labelKey: 'theme:themeManagement.categoryBrowse', descKey: 'theme:themeManagement.browseDesc' },
]

const SCHEMES: readonly DynamicThemeScheme[] = ['tonal-spot', 'vibrant', 'expressive', 'content', 'neutral']
const SURFACES: readonly { id: GlassSurfaceId; labelKey: string }[] = [
  { id: 'sidebar', labelKey: 'theme:themeManagement.surfaceSidebar' },
  { id: 'topbar', labelKey: 'theme:themeManagement.surfaceTopbar' },
  { id: 'player', labelKey: 'theme:themeManagement.surfacePlayer' },
  { id: 'cards', labelKey: 'theme:themeManagement.surfaceCards' },
  { id: 'popovers', labelKey: 'theme:themeManagement.surfacePopovers' },
]

/** Packs from the service when it speaks packs, else wrapped from themes. */
function readPacks(ctx: Context): ThemePack[] {
  const svc = serviceOf<ThemeService>(ctx, 'theme')
  if (svc?.getPacks) {
    return [...svc.getPacks()]
  }
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
  const { t } = useI18n(ctx)
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
  const [glass, setGlass] = useState<GlassSettings>(
    () => settings?.getSync()?.glass ?? DEFAULT_GLASS_SETTINGS,
  )
  // Which glass adjustment regions are expanded. A layer's region pops
  // open when its switch turns on; the chevrons fold regions away
  // independently. The per-surface group starts folded.
  const [glassOpen, setGlassOpen] = useState<{ window: boolean; components: boolean; surfaces: boolean }>({
    window: false,
    components: false,
    surfaces: false,
  })
  const [browseEntries, setBrowseEntries] = useState<readonly RegistryEntry[]>([])
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browseLoaded, setBrowseLoaded] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [lastImportLabel, setLastImportLabel] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importFileNameRef = useRef<string | null>(null)

  useEffect(() => {
    const update = () => {
      setPacks(readPacks(ctx))
      const svc = serviceOf<ThemeService>(ctx, 'theme')
      const currentSettings = serviceOf<SettingsLike>(ctx, 'settings')?.getSync()
      setCurrentThemeId(currentSettings?.themeId ?? svc?.getCurrentTheme?.().id ?? 'midnight-purple')
      if (currentSettings?.theme) {
        setAppearanceMode(currentSettings.theme as 'system' | 'dark' | 'light')
      }
      if (currentSettings?.themeCategory) {
        setCategory(currentSettings.themeCategory)
      }
      if (currentSettings?.glass) {
        setGlass(currentSettings.glass)
      }
    }
    update()
    const off1 = ctx.on('theme/registry-changed', update)
    const off2 = ctx.on('theme/changed', update)
    const off3 = ctx.on('theme/packs-changed', update)
    const off4 = ctx.on('settings/changed', update)
    return () => {
      off1()
      off2()
      off3()
      off4()
    }
  }, [ctx])

  const allThemes = packs.flatMap((p) => p.variants)
  const currentTheme = allThemes.find((x) => x.id === currentThemeId) ?? themeService?.getCurrentTheme?.()
  const currentPack = packs.find((p) => p.id === (currentTheme?.packId ?? settings?.getSync()?.themePackId))
  const currentLabel = currentPack?.name ?? currentTheme?.name ?? currentTheme?.id ?? currentThemeId

  const handleAppearanceModeChange = (mode: 'system' | 'dark' | 'light') => {
    setAppearanceMode(mode)
    void settings?.update({ theme: mode })
  }

  const handleCategoryChange = (next: ThemeCategory) => {
    setCategory(next)
    void settings?.update({ themeCategory: next })
    if (next === 'registry' && !browseLoaded) {
      void refreshBrowse()
    }
  }

  const handleThemeChange = (themeId: string, knownPack?: { id: string; category: ThemeCategory }) => {
    const pack = packs.find((p) => p.variants.some((v) => v.id === themeId))
    const patch: Partial<AppSettings> = { themeId }
    if (knownPack) {
      patch.themePackId = knownPack.id
      patch.themeCategory = knownPack.category
    } else if (pack) {
      patch.themePackId = pack.id
      patch.themeCategory = categoryOfPack(pack)
    }
    void settings?.update(patch)
    const svc = serviceOf<ThemeService>(ctx, 'theme')
    void svc?.setTheme?.(themeId)
  }

  const handleDeleteVariant = (themeId: string) => {
    const svc = serviceOf<ThemeService>(ctx, 'theme')
    const success = svc?.removeTheme ? svc.removeTheme(themeId) : true
    if (success && currentThemeId === themeId) {
      handleThemeChange('midnight-purple')
    }
  }

  const handleDeletePack = (packId: string) => {
    const svc = serviceOf<ThemeService>(ctx, 'theme')
    if (svc?.removePack) {
      svc.removePack(packId)
    } else {
      const pack = packs.find((p) => p.id === packId)
      for (const v of pack?.variants ?? []) svc?.removeTheme?.(v.id)
    }
  }

  const updateGlass = (next: GlassSettings) => {
    setGlass(next)
    void settings?.update({ glass: next })
  }

  const updateDynamic = (patch: Partial<AppSettings['dynamicTheme']>) => {
    const current = settings?.getSync()?.dynamicTheme ?? { scheme: 'tonal-spot' as const, contrast: 0, fallbackThemeId: 'midnight-purple' }
    void settings?.update({ dynamicTheme: { ...current, ...patch } })
  }

  const refreshBrowse = async (force = false) => {
    const registry = serviceOf<RegistryService>(ctx, 'contentRegistry')
    if (!registry?.getIndex) {
      setBrowseLoaded(true)
      return
    }
    try {
      const index = await registry.getIndex(force)
      setBrowseEntries(index.entries.filter((e) => e.kind === 'theme'))
      setBrowseError(null)
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err))
    }
    setBrowseLoaded(true)
  }

  const handleInstallEntry = async (entry: RegistryEntry) => {
    const registry = serviceOf<RegistryService>(ctx, 'contentRegistry')
    if (!registry) return
    try {
      await registry.install(entry, { confirmed: true })
      setPacks(readPacks(ctx))
      setBrowseError(null)
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleFileChange = (e: { target: { files: FileList | null; value: string } }) => {
    const file = e.target.files?.[0]
    if (!file) return
    importFileNameRef.current = (file as File).name ?? null
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result
      if (typeof text === 'string') {
        setImportJson(text)
        setImportError(null)
      }
    }
    reader.onerror = () => {
      setImportError(t('theme:themeManagement.importFailedReadFile'))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const fillTokens = (partial: Partial<ThemeDefinition>): ThemeDefinition['tokens'] => ({
    ...midnightPurpleTheme.tokens,
    ...(partial.tokens || {}),
    bg: { ...midnightPurpleTheme.tokens.bg, ...(partial.tokens?.bg || {}) },
    surface: { ...midnightPurpleTheme.tokens.surface, ...(partial.tokens?.surface || {}) },
    brand: { ...midnightPurpleTheme.tokens.brand, ...(partial.tokens?.brand || {}) },
    gradient: { ...midnightPurpleTheme.tokens.gradient, ...(partial.tokens?.gradient || {}) },
    text: { ...midnightPurpleTheme.tokens.text, ...(partial.tokens?.text || {}) },
    border: { ...midnightPurpleTheme.tokens.border, ...(partial.tokens?.border || {}) },
    semantic: { ...midnightPurpleTheme.tokens.semantic, ...(partial.tokens?.semantic || {}) },
    music: { ...midnightPurpleTheme.tokens.music, ...(partial.tokens?.music || {}) },
    glow: { ...midnightPurpleTheme.tokens.glow, ...(partial.tokens?.glow || {}) },
  })

  const toVariant = (raw: Partial<ThemeDefinition>): ThemeDefinition => ({
    id: String(raw.id).trim(),
    name: (typeof raw.name === 'string' && raw.name.trim()) || String(raw.id).trim(),
    description: raw.description,
    isDark: raw.isDark ?? true,
    tokens: fillTokens(raw),
    lightTokens: raw.lightTokens,
    cssVariables: raw.cssVariables,
    lightCssVariables: raw.lightCssVariables,
    effects: raw.effects,
  })

  const handleImportSubmit = () => {
    try {
      if (!importJson.trim()) {
        throw new Error(t('theme:themeManagement.importEmptyJson'))
      }
      const parsed = JSON.parse(importJson) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') throw new Error(t('theme:themeManagement.importInvalidJson'))
      const svc = serviceOf<ThemeService>(ctx, 'theme')

      // Pack document: { id, name, variants: [...] }
      if (Array.isArray(parsed.variants)) {
        if (typeof parsed.id !== 'string' || !parsed.id) throw new Error(t('theme:themeManagement.importMissingId'))
        const variants = (parsed.variants as Partial<ThemeDefinition>[]).map((v) => {
          if (!v || typeof v.id !== 'string') throw new Error(t('theme:themeManagement.importMissingId'))
          return toVariant(v)
        })
        if (variants.length === 0) throw new Error(t('theme:themeManagement.importInvalidJson'))
        const pack: ThemePack = {
          id: parsed.id,
          name: (typeof parsed.name === 'string' && parsed.name) || parsed.id,
          description: typeof parsed.description === 'string' ? parsed.description : undefined,
          author: typeof parsed.author === 'string' ? parsed.author : undefined,
          version: typeof parsed.version === 'string' ? parsed.version : undefined,
          origin: 'custom',
          variants,
        }
        if (svc?.registerThemePack) {
          svc.registerThemePack(pack)
        } else if (svc?.registerTheme) {
          for (const v of variants) svc.registerTheme({ ...v, packId: pack.id, origin: 'custom' })
        } else {
          setPacks((prev) => [...prev.filter((p) => p.id !== pack.id), pack])
        }
        setLastImportLabel(importFileNameRef.current ?? pack.name)
        handleThemeChange(variants[0]!.id, { id: pack.id, category: 'custom' })
      } else {
        // Single theme document (legacy shape).
        if (typeof parsed.id !== 'string' || !parsed.id) throw new Error(t('theme:themeManagement.importMissingId'))
        if (typeof parsed.name !== 'string' || !parsed.name) throw new Error(t('theme:themeManagement.importMissingName'))
        const variant = toVariant(parsed as Partial<ThemeDefinition>)
        if (svc?.registerTheme) {
          svc.registerTheme({ ...variant, origin: 'custom', packId: variant.id })
        } else {
          setPacks((prev) => [
            ...prev,
            { id: variant.id, name: variant.name, origin: 'custom' as const, variants: [variant] },
          ])
        }
        setLastImportLabel(importFileNameRef.current ?? variant.name)
        handleThemeChange(variant.id, { id: variant.id, category: 'custom' })
      }
      setShowImportModal(false)
      setImportJson('')
      setImportError(null)
      importFileNameRef.current = null
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  /* ── shared bits ──────────────────────────────────────────────────────── */

  const chipStyle = (selected: boolean) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px',
    borderRadius: 20,
    border: selected
      ? '1px solid var(--color-primary, #5F87FF)'
      : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
    background: selected
      ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
      : 'var(--surface-1, rgba(255, 255, 255, 0.04))',
    color: selected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, #C5CAD8)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: selected ? 600 : 400,
    boxShadow: selected ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.25))' : 'none',
    transition: 'all 0.15s ease',
  })

  const renderVariantButton = (theme: ThemeDefinition, deletable: boolean): ReactElement =>
    h(
      'button',
      {
        key: theme.id,
        type: 'button',
        onClick: () => handleThemeChange(theme.id),
        'aria-pressed': currentThemeId === theme.id,
        'data-testid': `theme-option-${theme.id}`,
        style: chipStyle(currentThemeId === theme.id),
      },
      h('span', {
        style: {
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: theme.tokens?.brand?.primary ?? 'var(--color-primary, #5F87FF)',
          flexShrink: 0,
          boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
        },
      }),
      theme.name ?? theme.id,
      deletable
        ? h(
            'span',
            {
              role: 'button',
              tabIndex: 0,
              title: t('theme:themeManagement.deleteTheme', { name: theme.name ?? theme.id }),
              'aria-label': t('theme:themeManagement.deleteTheme', { name: theme.name ?? theme.id }),
              'data-testid': `delete-theme-${theme.id}`,
              onClick: (e: { stopPropagation(): void }) => {
                e.stopPropagation()
                handleDeleteVariant(theme.id)
              },
              onKeyDown: (e: { key: string; stopPropagation(): void }) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  handleDeleteVariant(theme.id)
                }
              },
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 4,
                padding: 2,
                borderRadius: 4,
                color: 'var(--text-tertiary, #8B95B0)',
                cursor: 'pointer',
                opacity: 0.8,
              },
            },
            tablerIcon('trash', { size: 14 }),
          )
        : null,
    )

  const renderPackGroup = (pack: ThemePack, deletable: boolean): ReactElement => {
    const colors = previewColors(pack)
    // A single-variant pack whose name equals its variant's name needs no
    // header — the variant button already says it (and a duplicated label
    // is noise). Multi-variant packs get the header with the pack actions.
    const showHeader = pack.variants.length > 1 || pack.name !== pack.variants[0]?.name
    return h(
      'div',
      { key: pack.id, 'data-testid': `theme-pack-${pack.id}`, style: { width: '100%', marginBottom: 14 } },
      showHeader ? h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
        h(
          'span',
          { style: { display: 'inline-flex', gap: 3 } },
          colors.map((c, i) =>
            h('span', {
              key: i,
              style: { width: 10, height: 10, borderRadius: '50%', background: c, boxShadow: '0 0 3px rgba(0,0,0,0.35)' },
            }),
          ),
        ),
        h(
          'span',
          { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #F5F5F7)' } },
          pack.name ?? pack.id,
        ),
        h(
          'span',
          { style: { fontSize: 11, color: 'var(--text-tertiary, #8B95B0)' } },
          `${pack.variants.length}`,
        ),
        deletable
          ? h(
              'button',
              {
                type: 'button',
                'data-testid': `delete-pack-${pack.id}`,
                title: t('theme:themeManagement.deletePack', { name: pack.name ?? pack.id }),
                onClick: () => handleDeletePack(pack.id),
                style: {
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 10px',
                  borderRadius: 12,
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                  background: 'transparent',
                  color: 'var(--text-secondary, #C5CAD8)',
                  cursor: 'pointer',
                  fontSize: 12,
                },
              },
              tablerIcon('trash', { size: 12 }),
              t('theme:themeManagement.deletePackLabel'),
            )
          : null,
      ) : null,
      h(
        'div',
        { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
        pack.variants.map((v) => renderVariantButton(v, deletable)),
      ),
    )
  }

  const sliderRow = (
    testId: string,
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ): ReactElement =>
    h(
      'label',
      { key: testId, style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
      h('span', { style: { width: 92, flexShrink: 0 } }, label),
      h('input', {
        type: 'range',
        min,
        max,
        value,
        'data-testid': testId,
        onChange: (e: { target: { value: string } }) => onChange(Number(e.target.value)),
        style: { flex: 1, cursor: 'pointer' },
      }),
      h('span', { style: { width: 36, textAlign: 'right', color: 'var(--text-primary, #F5F5F7)' } }, `${value}`),
    )

  const toggleButton = (testId: string, on: boolean, onClick: () => void): ReactElement =>
    h(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        'data-testid': testId,
        onClick,
        style: {
          width: 40,
          height: 22,
          borderRadius: 999,
          border: 'none',
          background: on ? 'var(--color-primary, #5F87FF)' : 'var(--surface-3, rgba(255,255,255,0.18))',
          position: 'relative',
          cursor: 'pointer',
          flexShrink: 0,
        },
      },
      h('span', {
        style: {
          position: 'absolute',
          top: 3,
          left: on ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#FFFFFF',
          transition: 'left 0.15s ease',
        },
      }),
    )

  /* ── category bodies ──────────────────────────────────────────────────── */

  const packsIn = (cat: ThemeCategory) => packs.filter((p) => categoryOfPack(p) === cat)

  // The import entry lives only in the Custom panel (product decision,
  // confirmed 2026-10-24): an imported theme lands in Custom, so the
  // entry belongs with its content — 通用/自动/浏览 intentionally have
  // no import button.
  const importButton = () =>
    h(
      'button',
      {
        type: 'button',
        'data-testid': 'import-theme-button',
        onClick: () => {
          setImportJson('')
          setImportError(null)
          setShowImportModal(true)
        },
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 20,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: 'var(--border-default, rgba(255, 255, 255, 0.25))',
          background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
          color: 'var(--text-secondary, #C5CAD8)',
          cursor: 'pointer',
          fontSize: 13,
          transition: 'all 0.15s ease',
          flexShrink: 0,
        },
      },
      tablerIcon('plus', { size: 14 }),
      t('theme:themeManagement.importTheme'),
    )

  const renderImportRow = () =>
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 14 } }, importButton())

  const renderGeneral = (): ReactElement =>
    h(
      'div',
      { 'data-testid': 'theme-panel-builtin' },
      packsIn('builtin').map((p) => renderPackGroup(p, false)),
    )

  const renderDynamic = (): ReactElement => {
    const dynamicPack = packs.find((p) => p.origin === 'dynamic')
    const dynSettings = settings?.getSync()?.dynamicTheme ?? { scheme: 'tonal-spot' as const, contrast: 0, fallbackThemeId: 'midnight-purple' }
    const colors = dynamicPack ? previewColors(dynamicPack) : null
    return h(
      'div',
      { 'data-testid': 'theme-panel-dynamic', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        colors
          ? h('span', {
              style: {
                width: 44,
                height: 44,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${colors[2]} 0%, ${colors[1]} 100%)`,
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                flexShrink: 0,
              },
            })
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, t('theme:themeManagement.dynamicSource')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)' } },
            t('theme:themeManagement.dynamicSourceDesc'),
          ),
        ),
        dynamicPack
          ? h(
              'button',
              {
                type: 'button',
                'data-testid': 'theme-option-dynamic-cover',
                onClick: () => handleThemeChange('dynamic-cover'),
                'aria-pressed': currentThemeId === 'dynamic-cover',
                style: { ...chipStyle(currentThemeId === 'dynamic-cover'), marginLeft: 'auto' },
              },
              t('theme:themeManagement.dynamicEnable'),
            )
          : null,
      ),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
        h('span', { style: { width: 92, flexShrink: 0 } }, t('theme:themeManagement.dynamicScheme')),
        h(
          'select',
          {
            'data-testid': 'dynamic-scheme',
            value: dynSettings.scheme,
            onChange: (e: { target: { value: string } }) =>
              updateDynamic({ scheme: e.target.value as DynamicThemeScheme }),
            style: {
              flex: 1,
              padding: '6px 10px',
              borderRadius: 8,
              background: 'var(--surface-2, rgba(255,255,255,0.06))',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
              color: 'var(--text-primary, #F5F5F7)',
              fontSize: 13,
            },
          },
          SCHEMES.map((s) =>
            h('option', { key: s, value: s }, t(`theme:themeManagement.scheme_${s.replace('-', '_')}`)),
          ),
        ),
      ),
      sliderRow('dynamic-contrast', t('theme:themeManagement.dynamicContrast'), dynSettings.contrast, -100, 100, (v) =>
        updateDynamic({ contrast: v }),
      ),
    )
  }

  const renderCustom = (): ReactElement =>
    h(
      'div',
      { 'data-testid': 'theme-panel-custom' },
      renderImportRow(),
      lastImportLabel
        ? h(
            'div',
            {
              'data-testid': 'custom-last-import',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--surface-1, rgba(255,255,255,0.04))',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                marginBottom: 14,
                fontSize: 13,
                color: 'var(--text-primary, #F5F5F7)',
              },
            },
            tablerIcon('folder', { size: 16 }),
            lastImportLabel,
          )
        : null,
      packsIn('custom').length === 0
        ? h(
            'p',
            { style: { margin: 0, fontSize: 12, color: 'var(--text-secondary, #8E8E93)' } },
            t('theme:themeManagement.customEmpty'),
          )
        : packsIn('custom').map((p) => renderPackGroup(p, true)),
    )

  const renderBrowse = (): ReactElement => {
    const installed = packsIn('registry')
    const installedIds = new Set([...installed.map((p) => p.id), ...allThemes.map((x) => x.id)])
    return h(
      'div',
      { 'data-testid': 'theme-panel-registry', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'browse-refresh',
            onClick: () => void refreshBrowse(true),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 20,
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
              background: 'var(--surface-1, rgba(255,255,255,0.04))',
              color: 'var(--text-primary, #F5F5F7)',
              cursor: 'pointer',
              fontSize: 13,
            },
          },
          tablerIcon('refresh', { size: 14 }),
          t('theme:themeManagement.browseRefresh'),
        ),
        browseError
          ? h('span', { style: { fontSize: 12, color: 'var(--color-error, #F43F5E)' } }, browseError)
          : null,
      ),
      installed.map((p) => renderPackGroup(p, true)),
      browseEntries.length === 0
        ? h(
            'p',
            { style: { margin: 0, fontSize: 12, color: 'var(--text-secondary, #8E8E93)' } },
            t('theme:themeManagement.browseEmpty'),
          )
        : h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 } },
            browseEntries.map((entry) => {
              const isInstalled = installedIds.has(entry.id)
              return h(
                'div',
                {
                  key: entry.id,
                  'data-testid': `browse-theme-${entry.id}`,
                  style: {
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                    background: 'var(--surface-1, rgba(255,255,255,0.04))',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  },
                },
                // Miniature window preview drawn from the pack's preview
                // colours ([bg, surface, brand] from themes/index.json):
                // bg frame, a surface window inset with a brand sidebar,
                // and a brand player bar along the bottom. Falls back to a
                // neutral gradient for entries without preview colours.
                entry.previewColors
                  ? h(
                      'div',
                      {
                        'data-testid': `browse-preview-${entry.id}`,
                        style: {
                          height: 64,
                          borderRadius: 8,
                          background: entry.previewColors[0],
                          border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                          position: 'relative',
                          overflow: 'hidden',
                        },
                      },
                      h('div', {
                        style: {
                          position: 'absolute',
                          inset: '8px 8px 16px 8px',
                          borderRadius: 5,
                          background: entry.previewColors[1],
                          borderLeft: `10px solid ${entry.previewColors[2]}`,
                          opacity: 0.92,
                        },
                      }),
                      h('div', {
                        style: {
                          position: 'absolute',
                          left: 8,
                          right: 8,
                          bottom: 6,
                          height: 5,
                          borderRadius: 3,
                          background: entry.previewColors[2],
                        },
                      }),
                    )
                  : h('div', {
                      style: {
                        height: 64,
                        borderRadius: 8,
                        background:
                          'linear-gradient(135deg, var(--surface-2, rgba(255,255,255,0.08)) 0%, var(--surface-1, rgba(255,255,255,0.03)) 100%)',
                        border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                      },
                    }),
                h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #F5F5F7)' } }, entry.name ?? entry.id),
                entry.variantCount && entry.variantCount > 1
                  ? h(
                      'div',
                      { style: { fontSize: 11, color: 'var(--text-tertiary, #8B95B0)' } },
                      `${t('theme:themeManagement.variantCount', { count: entry.variantCount })}${entry.variants?.length ? ` · ${entry.variants.map((v) => v.name).join(' / ')}` : ''}`,
                    )
                  : null,
                entry.description
                  ? h('div', { style: { fontSize: 11, color: 'var(--text-secondary, #8E8E93)', lineHeight: 1.4 } }, entry.description)
                  : null,
                isInstalled
                  ? h(
                      'span',
                      { style: { fontSize: 12, color: 'var(--success, #22C55E)', display: 'inline-flex', gap: 4, alignItems: 'center' } },
                      tablerIcon('check', { size: 13 }),
                      t('theme:themeManagement.installed'),
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        'data-testid': `install-theme-${entry.id}`,
                        onClick: () => void handleInstallEntry(entry),
                        style: {
                          padding: '5px 12px',
                          borderRadius: 16,
                          border: 'none',
                          background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                          color: '#FFFFFF',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                          alignSelf: 'flex-start',
                        },
                      },
                      t('theme:themeManagement.download'),
                    ),
              )
            }),
          ),
    )
  }

  const renderGlass = (): ReactElement => {
    const g = glass
    const setWindow = (patch: Partial<GlassSettings['window']>) => updateGlass({ ...g, window: { ...g.window, ...patch } })
    const setComponents = (patch: Partial<GlassSettings['components']>) =>
      updateGlass({ ...g, components: { ...g.components, ...patch } })
    const setSurface = (id: GlassSurfaceId, patch: Partial<{ blurPx: number; opacity: number }>) =>
      updateGlass({ ...g, surfaces: { ...g.surfaces, [id]: { ...(g.surfaces[id] ?? {}), ...patch } } })

    // Each layer is its own sub-card with a header (label, chevron,
    // switch). Turning a switch on pops its adjustment region open; the
    // chevron collapses/expands the region without touching the switch,
    // so an enabled layer can still be folded away. Sliders inside a
    // region sit in a two-column grid instead of one long column, and
    // the per-surface overrides live in their own nested collapsible
    // group, folded by default.
    const expandButton = (testId: string, open: boolean, onToggle: () => void): ReactElement =>
      h(
        'button',
        {
          type: 'button',
          'data-testid': testId,
          'aria-expanded': open,
          'aria-label': t(open ? 'theme:themeManagement.collapse' : 'theme:themeManagement.expand'),
          onClick: onToggle,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary, #C5CAD8)',
            cursor: 'pointer',
            flexShrink: 0,
          },
        },
        tablerIcon(open ? 'chevron-down' : 'chevron-right', { size: 15 }),
      )

    const layerHeader = (
      label: string,
      expandTestId: string,
      open: boolean,
      onToggleOpen: () => void,
      enabled: boolean,
      toggle: ReactElement,
    ): ReactElement =>
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #C5CAD8)' } }, label),
        h('span', { style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 } },
          enabled ? expandButton(expandTestId, open, onToggleOpen) : null,
          toggle,
        ),
      )

    const layerCard = (children: (ReactElement | null)[]): ReactElement =>
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--surface-1, rgba(255, 255, 255, 0.03))',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.07))',
          },
        },
        children,
      )

    const sliderGrid = (rows: ReactElement[]): ReactElement =>
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '8px 18px' } },
        rows,
      )

    const selectStyle = {
      flex: 1,
      padding: '6px 10px',
      borderRadius: 8,
      background: 'var(--surface-2, rgba(255,255,255,0.06))',
      border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
      color: 'var(--text-primary, #F5F5F7)',
      fontSize: 13,
    } as const
    const selectLabelStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 12,
      color: 'var(--text-secondary, #C5CAD8)',
    } as const

    const toggleWindow = () => {
      const next = !g.window.enabled
      setWindow({ enabled: next })
      if (next) setGlassOpen((o) => ({ ...o, window: true }))
    }
    const toggleComponents = () => {
      const next = !g.components.enabled
      setComponents({ enabled: next })
      if (next) setGlassOpen((o) => ({ ...o, components: true }))
    }

    return h(
      'div',
      { 'data-testid': 'glass-settings', style: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 } },
      h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #F5F5F7)' } }, t('theme:themeManagement.glassTitle')),
      // Window layer (B)
      layerCard([
        layerHeader(
          t('theme:themeManagement.glassWindow'),
          'glass-window-expand',
          glassOpen.window,
          () => setGlassOpen((o) => ({ ...o, window: !o.window })),
          g.window.enabled,
          toggleButton('glass-window-toggle', g.window.enabled, toggleWindow),
        ),
        g.window.enabled && glassOpen.window
          ? h(
              'div',
              { 'data-testid': 'glass-window-region', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h(
                'label',
                { style: selectLabelStyle },
                h('span', { style: { width: 92, flexShrink: 0 } }, t('theme:themeManagement.windowEffect')),
                h(
                  'select',
                  {
                    'data-testid': 'glass-window-effect',
                    value: g.window.effect,
                    onChange: (e: { target: { value: string } }) =>
                      setWindow({ effect: e.target.value as GlassSettings['window']['effect'] }),
                    style: selectStyle,
                  },
                  (['auto', 'acrylic', 'mica', 'vibrancy', 'blur'] as const).map((fx) =>
                    h('option', { key: fx, value: fx }, t(`theme:themeManagement.effect_${fx}`)),
                  ),
                ),
              ),
              sliderGrid([
                sliderRow('glass-window-tint', t('theme:themeManagement.tintOpacity'), g.window.tintOpacity, 0, 100, (v) =>
                  setWindow({ tintOpacity: v }),
                ),
              ]),
            )
          : null,
      ]),
      // Component layer (A)
      layerCard([
        layerHeader(
          t('theme:themeManagement.glassComponents'),
          'glass-components-expand',
          glassOpen.components,
          () => setGlassOpen((o) => ({ ...o, components: !o.components })),
          g.components.enabled,
          toggleButton('glass-components-toggle', g.components.enabled, toggleComponents),
        ),
        g.components.enabled && glassOpen.components
          ? h(
              'div',
              { 'data-testid': 'glass-components-region', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              sliderGrid([
                sliderRow('glass-blur', t('theme:themeManagement.glassBlur'), g.components.blurPx, 0, 40, (v) =>
                  setComponents({ blurPx: v }),
                ),
                sliderRow('glass-saturate', t('theme:themeManagement.glassSaturate'), g.components.saturate, 100, 200, (v) =>
                  setComponents({ saturate: v }),
                ),
                sliderRow('glass-opacity', t('theme:themeManagement.glassOpacity'), g.components.opacity, 40, 95, (v) =>
                  setComponents({ opacity: v }),
                ),
              ]),
              h(
                'label',
                { style: selectLabelStyle },
                h('span', { style: { width: 92, flexShrink: 0 } }, t('theme:themeManagement.ambientSource')),
                h(
                  'select',
                  {
                    'data-testid': 'glass-ambient-source',
                    value: g.components.ambientSource,
                    onChange: (e: { target: { value: string } }) =>
                      setComponents({ ambientSource: e.target.value as GlassSettings['components']['ambientSource'] }),
                    style: selectStyle,
                  },
                  (['cover', 'theme', 'desktop', 'none'] as const).map((src) =>
                    h('option', { key: src, value: src }, t(`theme:themeManagement.ambient_${src}`)),
                  ),
                ),
              ),
              // Per-surface overrides: nested collapsible group.
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h(
                    'span',
                    { style: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #C5CAD8)' } },
                    t('theme:themeManagement.glassSurfaces'),
                  ),
                  h('span', { style: { marginLeft: 'auto' } },
                    expandButton('glass-surfaces-expand', glassOpen.surfaces, () =>
                      setGlassOpen((o) => ({ ...o, surfaces: !o.surfaces })),
                    ),
                  ),
                ),
                glassOpen.surfaces
                  ? h(
                      'div',
                      { 'data-testid': 'glass-surfaces-region', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                      SURFACES.map((surface) => {
                        const override = g.surfaces[surface.id] ?? {}
                        return h(
                          'div',
                          { key: surface.id, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                          h('span', { style: { fontSize: 12, color: 'var(--text-tertiary, #8B95B0)' } }, t(surface.labelKey)),
                          sliderGrid([
                            sliderRow(
                              `glass-surface-${surface.id}-blur`,
                              t('theme:themeManagement.glassBlur'),
                              override.blurPx ?? g.components.blurPx,
                              0,
                              40,
                              (v) => setSurface(surface.id, { blurPx: v }),
                            ),
                            sliderRow(
                              `glass-surface-${surface.id}-opacity`,
                              t('theme:themeManagement.glassOpacity'),
                              override.opacity ?? g.components.opacity,
                              40,
                              95,
                              (v) => setSurface(surface.id, { opacity: v }),
                            ),
                          ]),
                        )
                      }),
                    )
                  : null,
              ),
            )
          : null,
      ]),
    )
  }

  /* ── root ─────────────────────────────────────────────────────────────── */

  const activeDescKey = CATEGORIES.find((c) => c.id === category)?.descKey ?? CATEGORIES[0]!.descKey

  return h(
    'section',
    { 'data-testid': 'theme-management-card', style: { marginBottom: 32 } },
    h(
      'header',
      { style: { paddingBottom: 4, marginBottom: 2 } },
      h(
        'h3',
        { style: { fontSize: 15, fontWeight: 600, color: 'var(--bb-text-primary, #FFFFFF)', margin: 0, letterSpacing: '-0.01em' } },
        t('theme:themeManagement.appearanceMode'),
      ),
      h(
        'p',
        { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', margin: '3px 0 0', lineHeight: 1.4 } },
        t('theme:themeManagement.appearanceModeDesc'),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '16px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
          gap: 16,
        },
      },
      // Current theme line (name with id fallback — never "undefined")
      h(
        'div',
        { style: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 3 } },
        h(
          'div',
          { 'data-testid': 'current-theme-label', style: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #F5F5F7)' } },
          `${t('theme:themeManagement.currentTheme')}：${currentLabel}`,
        ),
        h('div', { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)' } }, t(activeDescKey)),
      ),
      // Category tabs
      h(
        'div',
        {
          role: 'tablist',
          'aria-label': t('theme:themeManagement.interfaceTheme'),
          style: { display: 'flex', justifyContent: 'center' },
        },
        h(
          'div',
          {
            style: {
              display: 'inline-flex',
              padding: 3,
              borderRadius: 20,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              gap: 4,
            },
          },
          CATEGORIES.map((c) => {
            const selected = category === c.id
            return h(
              'button',
              {
                key: c.id,
                type: 'button',
                role: 'tab',
                'aria-selected': selected,
                'data-testid': `theme-category-${c.id}`,
                onClick: () => handleCategoryChange(c.id),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 16px',
                  borderRadius: 16,
                  border: selected ? '1px solid var(--color-primary, #5F87FF)' : '1px solid transparent',
                  background: selected ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))' : 'transparent',
                  color: selected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, #C5CAD8)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: selected ? 600 : 400,
                  transition: 'all 0.15s ease',
                },
              },
              selected ? tablerIcon('check', { size: 13 }) : null,
              t(c.labelKey),
            )
          }),
        ),
      ),
      // Appearance mode row
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            paddingBottom: 16,
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, t('theme:themeManagement.theme')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', lineHeight: 1.45 } },
            t('theme:themeManagement.themeModeDesc'),
          ),
        ),
        h(
          'div',
          {
            role: 'radiogroup',
            'aria-label': t('theme:themeManagement.appearanceMode'),
            style: {
              display: 'inline-flex',
              padding: 3,
              borderRadius: 20,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              gap: 4,
            },
          },
          ([
            { id: 'system', labelKey: 'theme:themeManagement.followSystem' },
            { id: 'dark', labelKey: 'theme:themeManagement.darkMode' },
            { id: 'light', labelKey: 'theme:themeManagement.lightMode' },
          ] as const).map((mode) => {
            const isSelected = appearanceMode === mode.id
            return h(
              'button',
              {
                key: mode.id,
                type: 'button',
                role: 'radio',
                'aria-checked': isSelected,
                'data-testid': `appearance-mode-${mode.id}`,
                onClick: () => handleAppearanceModeChange(mode.id as 'system' | 'dark' | 'light'),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '5px 14px',
                  borderRadius: 16,
                  border: isSelected ? '1px solid var(--color-primary, #5F87FF)' : '1px solid transparent',
                  background: isSelected ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))' : 'transparent',
                  color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, #C5CAD8)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 400,
                  boxShadow: isSelected ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.25))' : 'none',
                  transition: 'all 0.15s ease',
                },
              },
              t(mode.labelKey),
            )
          }),
        ),
      ),
      // Category body
      category === 'builtin'
        ? renderGeneral()
        : category === 'dynamic'
          ? renderDynamic()
          : category === 'custom'
            ? renderCustom()
            : renderBrowse(),
      renderGlass(),
    ),
    h(
      Sheet,
      {
        open: showImportModal,
        onClose: () => {
          setShowImportModal(false)
          setImportError(null)
        },
        title: t('theme:themeManagement.importTheme'),
        accessibilityLabel: t('theme:themeManagement.importTheme'),
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          'p',
          { style: { margin: 0, fontSize: 13, color: 'var(--text-secondary, #C5CAD8)', lineHeight: 1.5 } },
          t('theme:themeManagement.importHint'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: '.json,application/json',
            'data-testid': 'import-theme-file-input',
            style: { display: 'none' },
            onChange: handleFileChange,
          }),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'choose-theme-file-btn',
              onClick: () => fileInputRef.current?.click(),
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-primary, #FFFFFF)',
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            tablerIcon('upload', { size: 14 }),
            t('theme:themeManagement.chooseLocalJsonFile'),
          ),
        ),
        h('textarea', {
          value: importJson,
          onChange: (e: { target: { value: string } }) => {
            setImportJson(e.target.value)
            setImportError(null)
          },
          placeholder: t('theme:themeManagement.importPlaceholder'),
          rows: 8,
          'data-testid': 'import-theme-textarea',
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            borderRadius: 8,
            background: 'var(--color-bg-tertiary, rgba(0, 0, 0, 0.35))',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
            color: 'var(--text-primary, #F5F7FF)',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.4,
            resize: 'vertical',
          },
        }),
        importError
          ? h(
              'div',
              {
                'data-testid': 'import-theme-error',
                style: {
                  color: 'var(--color-error, #F43F5E)',
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'rgba(244, 63, 94, 0.1)',
                  border: '1px solid rgba(244, 63, 94, 0.25)',
                },
              },
              importError,
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 } },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'cancel-import-theme',
              onClick: () => {
                setShowImportModal(false)
                setImportError(null)
              },
              style: {
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                background: 'transparent',
                color: 'var(--text-secondary, #C5CAD8)',
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            t('app:common.cancel'),
          ),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'submit-import-theme',
              onClick: handleImportSubmit,
              style: {
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                color: 'var(--bb-accent-on, #FFFFFF)',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            t('theme:themeManagement.importAndEnable'),
          ),
        ),
      ),
    ),
  )
}
