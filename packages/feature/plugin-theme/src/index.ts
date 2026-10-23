/**
 * `plugin-theme` — application color management and theme service.
 *
 * Implements `ctx.theme` and provides dynamic theme registration,
 * real-time CSS variable injection into the DOM, and persistence.
 *
 * Themes are managed as packs ({@link ThemePack}): a pack is the
 * grouping/distribution unit (built-in, plugin, custom-imported, registry
 * or cover-derived dynamic), each variant inside it a selectable
 * `ThemeDefinition`. Persistence is split by origin — custom packs under
 * `theme_packs_custom`, registry packs under `theme_packs_registry` —
 * while built-in, plugin and dynamic packs are never written to the
 * store. The pre-pack store key (`theme_custom_themes`, a flat variant
 * list) is migrated once on load.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type {
  AppSettings,
  Disposable,
  DynamicThemeSettings,
  GlassSettings,
  PlayerService,
  ThemeDefinition,
  ThemePack,
  ThemeService,
} from '@BBeBee/protocol'
import {
  applyThemeToDom,
  builtInThemePacks,
  builtInThemes,
  defaultTheme,
  extractVibrantColor,
  generateThemeFromSeed,
  resolveGlassVariables,
} from '@BBeBee/ui-tokens'
import { toBbebeeFileUri } from '@BBeBee/toolkit'
import { THEME_VIEWS } from './views.js'

const STORE_KEY = 'theme_preference'
const CUSTOM_PACKS_STORE_KEY = 'theme_packs_custom'
const REGISTRY_PACKS_STORE_KEY = 'theme_packs_registry'
const LEGACY_CUSTOM_THEMES_STORE_KEY = 'theme_custom_themes'

export const DYNAMIC_PACK_ID = 'dynamic-cover'

const DEFAULT_DYNAMIC_SETTINGS: DynamicThemeSettings = {
  scheme: 'tonal-spot',
  contrast: 0,
  fallbackThemeId: defaultTheme.id,
}

type StoreLike = {
  get<T>(k: string): Promise<T | undefined>
  set(k: string, v: unknown): Promise<void>
}

export class ThemePlugin extends Service implements ThemeService {
  static override readonly name = 'theme'
  static readonly inject = []

  private readonly ownCtx: Context
  private readonly packs = new Map<string, ThemePack>()
  private readonly registry = new Map<string, ThemeDefinition>()
  private activeThemeId = defaultTheme.id
  private appearanceMode: 'dark' | 'light' | 'system' = 'dark'
  private dynamicSettings: DynamicThemeSettings = { ...DEFAULT_DYNAMIC_SETTINGS }
  private dynamicSeed = defaultTheme.tokens.brand.primary
  private dynamicCacheKey = ''
  private playerWired = false
  /** Extracted cover colours by source URL, so a cover is decoded once. */
  private readonly seedColourCache = new Map<string, string>()
  /** The in-flight cover extraction, if any; a newer track supersedes it. */
  private seedRequest: { url: string } | null = null
  private glassSettings: GlassSettings | undefined
  private glassSignature = ''
  private appliedGlassKeys = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'theme')
    this.ownCtx = ctx

    // Seed the pack registry with the built-in packs (one per theme).
    for (const pack of Object.values(builtInThemePacks)) {
      this.packs.set(pack.id, ThemePlugin.normalizePack(pack))
    }
    this.rebuildRegistry()
    this.refreshDynamicPack()
  }

  async [Service.init]() {
    this.ownCtx.logger?.info?.('plugin-theme: initialized')

    // 1. Restore persisted packs + the active theme preference via store.
    this.ownCtx.inject(['store'], (scoped) => {
      const store = scoped.store as unknown as StoreLike
      void this.restoreFromStore(store).catch(() => {})
    })

    // 2. Synchronize with settings if available.
    this.ownCtx.inject(['settings'], (scoped) => {
      const initial = scoped.settings.getSync?.()
      this.applySettings(initial, true)
      scoped.on('settings/changed', (s) => {
        this.applySettings(s, false)
      })
    })

    // 2.2 System color-scheme listener for 'system' mode
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        if (this.appearanceMode === 'system') {
          this.applyActiveTheme()
          this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
        }
      }
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handler)
        this.ownCtx.effect(() => () => mq.removeEventListener('change', handler), 'theme-media-query')
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(handler)
        this.ownCtx.effect(() => () => mq.removeListener(handler), 'theme-media-query')
      }
    }

    // 2.4 Dynamic cover theme: follow the playing track's cover colour.
    // The seed lives on `state.nowPlaying`, which the player publishes
    // *asynchronously* after a track change (store lookup, then source
    // enrichment) — so `player/track-changed` fires while the state still
    // shows the previous track (or nothing). The reliable signal is
    // `player/state-changed`, whose payload is the new state itself;
    // track-changed stays as a fallback re-read. (Listening only to
    // track-changed was the "dynamic theme does not follow the cover"
    // bug: the seed update was always one track behind, or lost.)
    this.ownCtx.inject(['player'], (scoped) => {
      if (this.playerWired) return
      this.playerWired = true
      const player = scoped.player as unknown as PlayerService
      const read = (state?: PlayerService['state']) => {
        const np = state?.nowPlaying ?? player.state?.nowPlaying
        if (!np) return
        const declared = np.artwork?.dominantColor
        if (declared) {
          this.seedRequest = null
          this.setDynamicSeed(declared)
          return
        }
        // No declared colour — the common case, not an edge: local scans
        // insert artworks.dominant_color as NULL (there is no image
        // decoder at scan time, see plugin-local-scanner's import), and
        // nothing ever backfills it. Extract the seed from the cover
        // pixels instead, the same fallback the detail pages use.
        const rawUrl = np.artworkUri ?? np.artwork?.sourceUrl
        if (rawUrl) this.extractSeedFromCover(rawUrl)
      }
      read()
      const offState = this.ownCtx.on('player/state-changed', (s) => read(s))
      const offTrack = this.ownCtx.on('player/track-changed', () => read())
      this.ownCtx.effect(
        () => () => {
          offState()
          offTrack()
        },
        'theme-dynamic-player',
      )
    })

    // 2.5 Contribute this plugin's settings entries — the theme management
    // card. The settings screen aggregates whatever is contributed and owns
    // none of it (docs/08 §3). Appearance mode is controlled directly inside
    // the theme management card.
    this.ownCtx.inject(['ui'], (scoped) => {
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'settings',
          id: THEME_VIEWS.settingsCard,
          section: 'general',
          title: 'Theme and color management',
          description: 'Switch the player theme, or dynamically import and manage more color schemes',
          icon: 'palette',
          display: 'card',
          order: 20,
        })
      }, 'theme-settings-contributions')
    })

    // 3. Immediately apply the active theme to DOM
    this.applyActiveTheme()
  }

  /* ── queries ──────────────────────────────────────────────────────────── */

  getThemes(): readonly ThemeDefinition[] {
    return [...this.registry.values()]
  }

  getPacks(): readonly ThemePack[] {
    return [...this.packs.values()]
  }

  getEffectiveScheme(): 'dark' | 'light' {
    if (this.appearanceMode === 'system') {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      return 'dark'
    }
    return this.appearanceMode
  }

  getCurrentTheme(): ThemeDefinition {
    const base = this.registry.get(this.activeThemeId) ?? defaultTheme
    const scheme = this.getEffectiveScheme()
    if (scheme === 'light' && base.lightTokens) {
      return {
        ...base,
        isDark: false,
        tokens: base.lightTokens,
      }
    }
    return base
  }

  /* ── switching ────────────────────────────────────────────────────────── */

  async setTheme(themeId: string): Promise<void> {
    const target = this.registry.get(themeId)
    if (!target) {
      this.ownCtx.logger.warn(`theme: unknown theme id "${themeId}"`)
      return
    }

    if (this.activeThemeId === themeId) return

    this.activeThemeId = target.id
    this.applyActiveTheme()

    // Persist to store
    try {
      const store = this.reflectStore()
      if (store) {
        await store.set(STORE_KEY, target.id)
      }
    } catch (err) {
      this.ownCtx.logger?.warn?.(`theme: failed to persist theme: ${err}`)
    }

    // Sync with settings service if present
    const settings = (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('settings', false) as { update(p: unknown): Promise<unknown> } | undefined
    if (settings) {
      void settings.update({
        themeId: target.id,
        themePackId: target.packId,
      }).catch(() => {})
    }

    this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
  }

  /* ── registration ─────────────────────────────────────────────────────── */

  registerTheme(theme: ThemeDefinition): Disposable {
    const packId = theme.packId ?? theme.id
    const origin = theme.origin ?? 'custom'
    const existing = this.packs.get(packId)
    if (existing && existing.variants.length > 1) {
      // Upsert into the multi-variant pack instead of replacing it.
      const variants = existing.variants.filter((v) => v.id !== theme.id)
      variants.push(theme)
      this.registerThemePack({ ...existing, variants })
    } else {
      this.registerThemePack({
        id: packId,
        name: theme.name,
        description: theme.description,
        author: theme.author,
        version: theme.version,
        origin,
        variants: [theme],
      })
    }
    return () => {
      this.removeTheme(theme.id)
    }
  }

  registerThemePack(pack: ThemePack): Disposable {
    if (!pack || typeof pack.id !== 'string' || !pack.id || !Array.isArray(pack.variants) || pack.variants.length === 0) {
      this.ownCtx.logger.warn('theme: refusing to register an empty or malformed theme pack')
      return () => {}
    }
    const normalized = ThemePlugin.normalizePack(pack)
    const previous = this.packs.get(normalized.id)
    this.packs.set(normalized.id, normalized)
    this.rebuildRegistry()
    this.ownCtx.logger.info(
      `theme: registered pack "${normalized.id}" (${normalized.variants.length} variant(s), origin ${normalized.origin})`,
    )
    if (normalized.origin === 'custom' || normalized.origin === 'registry') {
      void this.persistPacks(normalized.origin)
    }
    this.emitRegistryChanged()
    // Re-apply when the pack (re-)defines the active variant: this is what
    // makes a live update (accent change, glass preset change, dynamic
    // regeneration) repaint without a theme switch. setTheme() alone
    // early-returns on an unchanged id, so registration owns repaints.
    const activeBefore = previous?.variants.find((v) => v.id === this.activeThemeId)
    const activeNow = normalized.variants.find((v) => v.id === this.activeThemeId)
    if (activeNow && activeNow !== activeBefore) {
      this.applyActiveTheme()
      this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
    }
    return () => {
      this.removePack(normalized.id)
    }
  }

  removeTheme(themeId: string): boolean {
    const variant = this.registry.get(themeId)
    if (!variant) return false
    if (variant.origin === 'builtin' || themeId in builtInThemes) {
      this.ownCtx.logger.warn(`theme: cannot remove built-in theme "${themeId}"`)
      return false
    }
    const pack = variant.packId ? this.packs.get(variant.packId) : undefined
    if (!pack) return false
    const remaining = pack.variants.filter((v) => v.id !== themeId)
    if (remaining.length === 0) {
      this.packs.delete(pack.id)
    } else {
      this.packs.set(pack.id, { ...pack, variants: remaining })
    }
    this.rebuildRegistry()
    this.ownCtx.logger.info(`theme: removed theme "${themeId}"`)
    if (this.activeThemeId === themeId) {
      void this.setTheme(defaultTheme.id)
    }
    if (pack.origin === 'custom' || pack.origin === 'registry') {
      void this.persistPacks(pack.origin)
    }
    this.emitRegistryChanged()
    return true
  }

  removePack(packId: string): boolean {
    const pack = this.packs.get(packId)
    if (!pack) return false
    if (pack.origin === 'builtin') {
      this.ownCtx.logger.warn(`theme: cannot remove built-in pack "${packId}"`)
      return false
    }
    this.packs.delete(packId)
    this.rebuildRegistry()
    this.ownCtx.logger.info(`theme: removed pack "${packId}"`)
    if (!this.registry.has(this.activeThemeId)) {
      void this.setTheme(defaultTheme.id)
    }
    if (pack.origin === 'custom' || pack.origin === 'registry') {
      void this.persistPacks(pack.origin)
    }
    this.emitRegistryChanged()
    return true
  }

  onThemeChange(listener: (theme: ThemeDefinition, scheme?: 'dark' | 'light') => void): Disposable {
    return this.ownCtx.on('theme/changed', listener)
  }

  /* ── internals ────────────────────────────────────────────────────────── */

  private static normalizePack(pack: ThemePack): ThemePack {
    return {
      ...pack,
      variants: pack.variants.map((v) => ({ ...v, packId: pack.id, origin: v.origin ?? pack.origin })),
    }
  }

  private rebuildRegistry(): void {
    this.registry.clear()
    for (const pack of this.packs.values()) {
      for (const variant of pack.variants) {
        this.registry.set(variant.id, variant)
      }
    }
  }

  private emitRegistryChanged(): void {
    this.ownCtx.emit('theme/registry-changed', this.getThemes())
    this.ownCtx.emit('theme/packs-changed', this.getPacks())
  }

  private reflectStore(): StoreLike | undefined {
    try {
      return (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
        .reflect?.get('store', false) as StoreLike | undefined
    } catch {
      return undefined
    }
  }

  private async persistPacks(origin: 'custom' | 'registry'): Promise<void> {
    try {
      const store = this.reflectStore()
      if (!store) return
      const key = origin === 'custom' ? CUSTOM_PACKS_STORE_KEY : REGISTRY_PACKS_STORE_KEY
      const packs = [...this.packs.values()].filter((p) => p.origin === origin)
      await store.set(key, packs)
    } catch (err) {
      this.ownCtx.logger?.warn?.(`theme: failed to persist ${origin} packs: ${err}`)
    }
  }

  private async restoreFromStore(store: StoreLike): Promise<void> {
    const [customPacks, registryPacks] = await Promise.all([
      store.get<ThemePack[]>(CUSTOM_PACKS_STORE_KEY).catch(() => undefined),
      store.get<ThemePack[]>(REGISTRY_PACKS_STORE_KEY).catch(() => undefined),
    ])
    for (const pack of [...(customPacks ?? []), ...(registryPacks ?? [])]) {
      if (pack && pack.id && !(pack.id in builtInThemePacks) && Array.isArray(pack.variants)) {
        this.packs.set(pack.id, ThemePlugin.normalizePack(pack))
      }
    }

    // One-time migration of the pre-pack flat variant list. Runs only
    // when the new custom-packs key has never been written; the legacy
    // key itself is left in place (the store has no delete) but never
    // read again once the new key exists.
    if (!Array.isArray(customPacks)) {
      const legacy = await store.get<ThemeDefinition[]>(LEGACY_CUSTOM_THEMES_STORE_KEY).catch(() => undefined)
      if (Array.isArray(legacy) && legacy.length > 0) {
        const grouped = new Map<string, ThemeDefinition[]>()
        for (const def of legacy) {
          if (!def || !def.id || def.id in builtInThemes) continue
          const key = def.packId ?? def.id
          const list = grouped.get(key) ?? []
          list.push(def)
          grouped.set(key, list)
        }
        for (const [packId, variants] of grouped) {
          if (!this.packs.has(packId)) {
            this.packs.set(packId, ThemePlugin.normalizePack({
              id: packId,
              name: variants[0]!.name,
              origin: 'custom',
              variants,
            }))
          }
        }
        await this.persistPacks('custom')
      }
    }

    this.rebuildRegistry()
    this.emitRegistryChanged()

    const storedId = await store.get<string>(STORE_KEY).catch(() => undefined)
    if (storedId && this.registry.has(storedId)) {
      this.activeThemeId = storedId
      this.applyActiveTheme()
    }
  }

  private applySettings(s: AppSettings | undefined, initial: boolean): void {
    if (!s) return
    let changed = false
    if (s.theme && (s.theme === 'dark' || s.theme === 'light' || s.theme === 'system') && s.theme !== this.appearanceMode) {
      this.appearanceMode = s.theme
      changed = true
    }
    if (s.themeId && s.themeId !== this.activeThemeId && this.registry.has(s.themeId)) {
      this.activeThemeId = s.themeId
      changed = true
    }
    if (s.dynamicTheme) {
      const next: DynamicThemeSettings = {
        scheme: s.dynamicTheme.scheme ?? this.dynamicSettings.scheme,
        contrast: typeof s.dynamicTheme.contrast === 'number' ? s.dynamicTheme.contrast : this.dynamicSettings.contrast,
        fallbackThemeId: s.dynamicTheme.fallbackThemeId ?? this.dynamicSettings.fallbackThemeId,
      }
      if (
        next.scheme !== this.dynamicSettings.scheme ||
        next.contrast !== this.dynamicSettings.contrast ||
        next.fallbackThemeId !== this.dynamicSettings.fallbackThemeId
      ) {
        this.dynamicSettings = next
        this.refreshDynamicPack()
      }
    }
    if (s.glass) {
      const signature = JSON.stringify(s.glass)
      if (signature !== this.glassSignature) {
        this.glassSignature = signature
        this.glassSettings = s.glass
        changed = true
      }
    }
    if (changed && !initial) {
      this.applyActiveTheme()
      this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
    } else if (changed && initial) {
      this.applyActiveTheme()
    }
  }

  private setDynamicSeed(seed: string): void {
    if (seed === this.dynamicSeed) return
    this.dynamicSeed = seed
    this.refreshDynamicPack()
  }

  /**
   * Extracts the dynamic seed from a cover image's pixels. Used when the
   * artwork carries no declared `dominantColor` — which, for local
   * libraries, is always: the scanner stores that column as NULL. The
   * image loads through the same servable-URL mapping the artwork
   * components use, and extraction is the ui-tokens algorithm the
   * detail pages seed their header tint with. Failures (unreachable
   * file, tainted canvas, non-renderer host) simply leave the current
   * seed in place.
   */
  private extractSeedFromCover(rawUrl: string): void {
    const cached = this.seedColourCache.get(rawUrl)
    if (cached) {
      this.setDynamicSeed(cached)
      return
    }
    if (this.seedRequest?.url === rawUrl) return
    if (typeof Image === 'undefined' || typeof document === 'undefined') return
    const url = toBbebeeFileUri(rawUrl)
    if (!url) return
    const request = { url: rawUrl }
    this.seedRequest = request
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (this.seedRequest !== request) return
      this.seedRequest = null
      const colour = extractVibrantColor(image)
      if (colour) {
        this.seedColourCache.set(rawUrl, colour)
        this.setDynamicSeed(colour)
      }
    }
    image.onerror = () => {
      if (this.seedRequest === request) this.seedRequest = null
    }
    image.src = url
  }

  /**
   * (Re)generates the dynamic cover pack from the last known seed colour.
   * Cached on seed+scheme+contrast so track changes to a cover with the
   * same dominant colour do not churn the registry.
   */
  private refreshDynamicPack(): void {
    const { scheme, contrast } = this.dynamicSettings
    const key = `${this.dynamicSeed}|${scheme}|${contrast}`
    if (key === this.dynamicCacheKey && this.packs.has(DYNAMIC_PACK_ID)) return
    this.dynamicCacheKey = key
    const theme = generateThemeFromSeed(this.dynamicSeed, { scheme, contrast })
    const pack: ThemePack = {
      id: DYNAMIC_PACK_ID,
      name: theme.name,
      description: theme.description,
      origin: 'dynamic',
      variants: [theme],
      preview: { colors: [theme.tokens.bg.primary, theme.tokens.surface.s1, theme.tokens.brand.primary] },
    }
    const wasActive = this.activeThemeId === DYNAMIC_PACK_ID
    this.packs.set(DYNAMIC_PACK_ID, ThemePlugin.normalizePack(pack))
    this.rebuildRegistry()
    if (wasActive) {
      this.applyActiveTheme()
      this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
    }
    this.emitRegistryChanged()
  }

  private applyActiveTheme(): void {
    const base = this.registry.get(this.activeThemeId) ?? defaultTheme
    const effectiveScheme = this.getEffectiveScheme()
    applyThemeToDom(base, effectiveScheme)
    this.applyGlassVariables(base)
  }

  /**
   * Diffs the resolved `--glass-*` variables onto `:root`. Surfaces read
   * them with solid fallbacks, so an empty resolution (glass off) simply
   * removes every variable again. The ambient colour follows the dynamic
   * seed when the ambient source is the playing cover.
   */
  private applyGlassVariables(base: ThemeDefinition): void {
    if (typeof document === 'undefined' || !document.documentElement?.style) return
    // The window layer needs the page itself transparent: index.html
    // paints :root/body/#root opaque with --bg-app, which would seal
    // the OS effect behind three opaque layers no matter what the
    // shell root does. The attribute is the switch for the stylesheet
    // rule that lifts those backgrounds (same pattern as the
    // mini-player / lyrics windows' html classes).
    if (this.glassSettings?.window?.enabled) {
      document.documentElement.setAttribute('data-window-glass', 'on')
    } else {
      document.documentElement.removeAttribute('data-window-glass')
    }
    const vars = resolveGlassVariables(base, this.glassSettings)
    if (this.glassSettings?.components?.ambientSource === 'cover' && vars['--glass-ambient-bg']) {
      vars['--glass-ambient-color'] = this.dynamicSeed
    }
    const style = document.documentElement.style
    for (const key of this.appliedGlassKeys) {
      if (!(key in vars)) style.removeProperty(key)
    }
    for (const [key, value] of Object.entries(vars)) {
      style.setProperty(key, value)
    }
    this.appliedGlassKeys = new Set(Object.keys(vars))
  }
}

export const name = 'plugin-theme'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-theme: loaded')
  const fiber = await ctx.plugin(ThemePlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
