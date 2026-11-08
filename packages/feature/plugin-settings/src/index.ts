/**
 * `plugin-settings` — application preferences and configuration service.
 *
 * Implements `ctx.settings` and contributes the `/settings` navigation route.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  AppSettings,
  Disposable,
  SecretsService,
  SettingsContribution,
  SettingsPatch,
  SettingsService,
} from '@BBeBee/protocol'
import {
  APP_SETTINGS_STORE_KEY,
  DEFAULT_APP_SETTINGS,
  resolveMobileLiquidGlassSettings,
} from '@BBeBee/protocol'
import { SETTINGS_ROUTES, SETTINGS_VIEWS } from './views.js'
import { watchGlobalShortcuts } from './shortcuts.js'

/**
 * The persisted-preferences key. A protocol constant, not a local
 * fact: the shells' grant resolution reads the same document through
 * the same namespace+key to derive plugin-manager's download hosts
 * before this plugin has even loaded (see `readConfiguredAppSettings`
 * in the kernel).
 */
const STORE_KEY = APP_SETTINGS_STORE_KEY

/**
 * The secrets key the proxy password lives under, inside this plugin's own
 * capability scope — on disk `<pluginScope>/proxy.password`. Never in the
 * settings document, the store file, or a log (see the custody chain in
 * `apps/desktop/src-tauri/src/proxy_config.rs`).
 */
const PROXY_PASSWORD_KEY = 'proxy.password'

/**
 * Normalizes a manual mirror/registry URL override: trims whitespace, drops
 * trailing slashes, and maps empty input to `undefined` (i.e. "derive from
 * the region default" rather than persisting an empty string).
 */
function normalizeMirrorUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * A `password` must never survive into the settings document — the secret
 * file is its only home (`setProxyPassword`), and an older build's plaintext
 * leftover is emptied here on every merge rather than trusted to a one-time
 * migration.
 */
function stripLegacyProxyPassword(proxy: AppSettings['proxy']): AppSettings['proxy'] {
  delete (proxy as { password?: unknown }).password
  return proxy
}

function mergeSettings(base: AppSettings, patch?: SettingsPatch): AppSettings {
  if (!patch) return { ...base, proxy: stripLegacyProxyPassword({ ...base.proxy }) }
  return {
    ...base,
    ...patch,
    // A region outside the known enum (e.g. from a hand-edited store) falls
    // back to the built-in default instead of leaking through.
    downloadRegion:
      patch.downloadRegion === undefined
        ? base.downloadRegion
        : patch.downloadRegion === 'global' || patch.downloadRegion === 'mainland-china'
          ? patch.downloadRegion
          : DEFAULT_APP_SETTINGS.downloadRegion,
    downloadFormat: patch.downloadFormat ?? base.downloadFormat ?? DEFAULT_APP_SETTINGS.downloadFormat,
    downloadWifiOnly:
      patch.downloadWifiOnly !== undefined
        ? Boolean(patch.downloadWifiOnly)
        : (base.downloadWifiOnly ?? DEFAULT_APP_SETTINGS.downloadWifiOnly),
    // Acceleration lines are an ordered list: a patch replaces the whole
    // array (never merges element-wise), with non-string junk dropped.
    githubAccelerationPrefixes: Array.isArray(patch.githubAccelerationPrefixes)
      ? patch.githubAccelerationPrefixes.filter(
          (p): p is string => typeof p === 'string' && p.length > 0,
        )
      : base.githubAccelerationPrefixes,
    // Manual npm / registry-raw overrides. An explicit empty string clears
    // back to the region-derived default; junk non-strings are dropped.
    npmRegistryUrl: normalizeMirrorUrl(patch.npmRegistryUrl ?? base.npmRegistryUrl),
    githubRawBaseUrl: normalizeMirrorUrl(patch.githubRawBaseUrl ?? base.githubRawBaseUrl),
    desktopLyrics: {
      ...base.desktopLyrics,
      ...(patch.desktopLyrics ?? {}),
      position: {
        ...(base.desktopLyrics?.position ?? { x: -1, y: -1 }),
        ...(patch.desktopLyrics?.position ?? {}),
      },
    },
    shortcuts: {
      ...base.shortcuts,
      ...(patch.shortcuts ?? {}),
      keybindings: {
        ...base.shortcuts.keybindings,
        ...(patch.shortcuts?.keybindings ?? {}),
      },
    },
    proxy: stripLegacyProxyPassword({
      ...base.proxy,
      ...(patch.proxy ?? {}),
      sourceRules: {
        ...base.proxy.sourceRules,
        ...(patch.proxy?.sourceRules ?? {}),
      },
    }),
    visualizer: {
      ...base.visualizer,
      ...(patch.visualizer ?? {}),
    },
    // Theme category: same enum-guard treatment as downloadRegion — a
    // value outside the known set falls back instead of leaking through.
    themeCategory:
      patch.themeCategory === undefined
        ? base.themeCategory
        : patch.themeCategory === 'builtin' ||
            patch.themeCategory === 'dynamic' ||
            patch.themeCategory === 'custom' ||
            patch.themeCategory === 'registry'
          ? patch.themeCategory
          : DEFAULT_APP_SETTINGS.themeCategory,
    dynamicTheme: {
      ...(base.dynamicTheme ?? DEFAULT_APP_SETTINGS.dynamicTheme),
      ...(patch.dynamicTheme ?? {}),
    },
    glass: {
      window: {
        ...(base.glass?.window ?? DEFAULT_APP_SETTINGS.glass.window),
        ...(patch.glass?.window ?? {}),
      },
      components: {
        ...(base.glass?.components ?? DEFAULT_APP_SETTINGS.glass.components),
        ...(patch.glass?.components ?? {}),
      },
      surfaces: {
        ...(base.glass?.surfaces ?? {}),
        ...(patch.glass?.surfaces ?? {}),
      },
    },
    // Mobile Liquid Glass: deep-merge per tier (a general-only patch must
    // not wipe the advanced tier, and vice versa), then resolve so a
    // hand-edited store value is clamped/guarded like every other field.
    liquidGlass: resolveMobileLiquidGlassSettings({
      general: {
        ...(base.liquidGlass?.general ??
          DEFAULT_APP_SETTINGS.liquidGlass!.general),
        ...(patch.liquidGlass?.general ?? {}),
      },
      advanced: {
        ...(base.liquidGlass?.advanced ??
          DEFAULT_APP_SETTINGS.liquidGlass!.advanced),
        ...(patch.liquidGlass?.advanced ?? {}),
      },
    }),
  }
}

export class SettingsPlugin extends Service implements SettingsService {
  static override readonly name = 'settings'
  static readonly inject = ['store']

  private readonly ownCtx: Context
  private current: AppSettings = mergeSettings(DEFAULT_APP_SETTINGS)
  private readonly contributions = new Map<string, SettingsContribution>()
  private uiScopedCtx?: Context
  /** Captured when the optional secrets service arrives; see the password methods. */
  private secrets?: SecretsService
  /**
   * A plaintext password an older build left in the stored document — kept
   * aside at load time, because `mergeSettings` strips the field before the
   * secrets custody migration (below) has a place to move it to.
   */
  private legacyProxyPassword: string | undefined

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.ownCtx = ctx
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-settings: initialized')
    try {
      const stored = await this.ownCtx.store.get<Partial<AppSettings>>(STORE_KEY)
      if (stored) {
        const legacyPassword = (stored.proxy as { password?: unknown } | undefined)?.password
        this.legacyProxyPassword = typeof legacyPassword === 'string' && legacyPassword ? legacyPassword : undefined
        this.current = mergeSettings(DEFAULT_APP_SETTINGS, stored)
      }
    } catch (err) {
      this.ownCtx.logger.warn(`settings: failed to load persisted preferences: ${err}`)
    }

    // Optional: the credential store. Without one there is nowhere for the
    // proxy password to live, and `setProxyPassword` says so instead of
    // pretending to persist.
    this.ownCtx.inject(['secrets'], (scoped) => {
      this.secrets = scoped.secrets
      void this.migrateLegacyProxyPassword()
      return () => {
        this.secrets = undefined
      }
    })

    this.ownCtx.inject(['ui'], (scoped) => {
      this.uiScopedCtx = scoped
      // Register any contributions made before ui service was loaded
      for (const contrib of this.contributions.values()) {
        try {
          scoped.ui.contribute(contrib)
        } catch {
          // ignore
        }
      }

      scoped.effect(function* () {
        scoped.logger.debug(`settings: contributing route ${SETTINGS_ROUTES.main}`)
        yield scoped.ui.contribute({
          kind: 'route',
          id: SETTINGS_ROUTES.main,
          path: '/settings',
          title: 'Settings',
          icon: 'settings',
          // 'tray' opts the page into the desktop top-bar tray: Ui.tray maps
          // tray-placed routes into tray items. The shells exclude this id
          // from their sidebars, so the placement only adds reachability.
          placement: ['sidebar', 'tab-bar', 'tray'],
          order: 95,
        })
        // Global shortcuts are this plugin's own domain (watchGlobalShortcuts
        // below lives and dies with this service) — the card is contributed
        // like any other plugin's, and the settings screen renders the
        // descriptor instead of hardcoding it.
        yield scoped.ui.contribute({
          kind: 'settings',
          id: SETTINGS_VIEWS.shortcutsCard,
          section: 'shortcuts',
          title: 'Global shortcuts',
          description:
            'Control music playback, volume, and window show/hide globally from the OS with keyboard shortcuts',
          icon: 'keyboard',
          display: 'card',
          order: 10,
        })
      }, 'settings-ui-contributions')
    })

    // Global shortcuts follow the settings service's lifetime, not the
    // settings screen's mount cycle (see shortcuts.ts).
    watchGlobalShortcuts(this.ownCtx)
  }

  async get(): Promise<AppSettings> {
    return { ...this.current }
  }

  getSync(): AppSettings {
    return { ...this.current }
  }

  async update(partial: SettingsPatch): Promise<AppSettings> {
    this.ownCtx.logger.debug('settings: update', partial)
    this.current = mergeSettings(this.current, partial)
    await this.ownCtx.store.set(STORE_KEY, this.current)
    this.ownCtx.emit('settings/changed', { ...this.current })
    return { ...this.current }
  }

  async reset(): Promise<AppSettings> {
    this.ownCtx.logger.info('settings: reset to defaults')
    this.current = { ...DEFAULT_APP_SETTINGS }
    await this.ownCtx.store.set(STORE_KEY, this.current)
    this.ownCtx.emit('settings/changed', { ...this.current })
    return { ...this.current }
  }

  onSettingsChange(listener: (settings: AppSettings) => void): Disposable {
    return this.ownCtx.on('settings/changed', listener)
  }

  contribute(contribution: SettingsContribution): Disposable {
    const item: SettingsContribution = {
      ...contribution,
      kind: 'settings',
    }
    this.contributions.set(item.id, item)
    this.ownCtx.emit('settings/contributions-changed', this.getContributions())

    let uiDisposer: Disposable | undefined
    if (this.uiScopedCtx?.ui) {
      try {
        uiDisposer = this.uiScopedCtx.ui.contribute(item)
      } catch {
        // ignore
      }
    }

    return () => {
      this.contributions.delete(item.id)
      uiDisposer?.()
      this.ownCtx.emit('settings/contributions-changed', this.getContributions())
    }
  }

  getContributions(): readonly SettingsContribution[] {
    return Array.from(this.contributions.values()).sort(
      (a, b) => (a.order ?? 50) - (b.order ?? 50),
    )
  }

  async setProxyPassword(password: string): Promise<void> {
    if (!this.secrets) {
      throw new Error('settings: no secrets service — the proxy password cannot be stored')
    }
    const trimmed = password.trim()
    if (!trimmed) {
      await this.clearProxyPassword()
      return
    }
    await this.secrets.set(PROXY_PASSWORD_KEY, trimmed)
    // Not a settings-document change, but the desktop shell reloads its
    // sidecar-side proxy config on this event — the new password must reach
    // the dispatcher, so the ping fires the same way an address change does.
    this.ownCtx.emit('settings/changed', { ...this.current })
  }

  async clearProxyPassword(): Promise<void> {
    await this.secrets?.delete(PROXY_PASSWORD_KEY)
    this.ownCtx.emit('settings/changed', { ...this.current })
  }

  async hasProxyPassword(): Promise<boolean> {
    return (await this.secrets?.get(PROXY_PASSWORD_KEY)) !== undefined
  }


  /**
   * One-time custody migration: an older build kept the proxy password in
   * the settings document — plaintext inside `store.json`. Move it to the
   * secrets and empty the field, so the document stops carrying a credential
   * (and `stripLegacyProxyPassword` keeps it emptied against any older
   * write arriving late).
   */
  private async migrateLegacyProxyPassword(): Promise<void> {
    const legacy = this.legacyProxyPassword
    this.legacyProxyPassword = undefined
    if (!legacy) return
    if (!this.secrets) {
      this.ownCtx.logger.warn(
        'settings: a plaintext proxy password is in the settings document but no secrets service exists to receive it — it stays until one does',
      )
      return
    }
    try {
      await this.secrets.set(PROXY_PASSWORD_KEY, legacy)
      delete (this.current.proxy as { password?: unknown }).password
      await this.ownCtx.store.set(STORE_KEY, this.current)
      this.ownCtx.logger.info('settings: migrated the proxy password out of the settings document')
    } catch (err) {
      this.ownCtx.logger.warn(`settings: proxy password migration failed: ${String(err)}`)
    }
  }
}

export const name = 'plugin-settings'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-settings: loaded')
  const fiber = await ctx.plugin(SettingsPlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
