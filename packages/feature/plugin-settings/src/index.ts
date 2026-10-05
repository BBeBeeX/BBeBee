/**
 * `plugin-settings` — application preferences and configuration service.
 *
 * Implements `ctx.settings` and contributes the `/settings` navigation route.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { AppSettings, Disposable, SettingsContribution, SettingsService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { SETTINGS_ROUTES } from './views.js'
import { watchGlobalShortcuts } from './shortcuts.js'

const STORE_KEY = 'preferences'

function mergeSettings(base: AppSettings, patch?: Partial<AppSettings>): AppSettings {
  if (!patch) return { ...base }
  return {
    ...base,
    ...patch,
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
    proxy: {
      ...base.proxy,
      ...(patch.proxy ?? {}),
      sourceRules: {
        ...base.proxy.sourceRules,
        ...(patch.proxy?.sourceRules ?? {}),
      },
    },
    visualizer: {
      ...base.visualizer,
      ...(patch.visualizer ?? {}),
    },
  }
}

export class SettingsPlugin extends Service implements SettingsService {
  static override readonly name = 'settings'
  static readonly inject = ['store']

  private readonly ownCtx: Context
  private current: AppSettings = mergeSettings(DEFAULT_APP_SETTINGS)
  private readonly contributions = new Map<string, SettingsContribution>()
  private uiScopedCtx?: Context

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.ownCtx = ctx
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-settings: initialized')
    try {
      const stored = await this.ownCtx.store.get<Partial<AppSettings>>(STORE_KEY)
      if (stored) {
        this.current = mergeSettings(DEFAULT_APP_SETTINGS, stored)
      }
    } catch (err) {
      this.ownCtx.logger.warn(`settings: failed to load persisted preferences: ${err}`)
    }

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
          title: '设置',
          icon: 'settings',
          // 'tray' opts the page into the desktop top-bar tray: Ui.tray maps
          // tray-placed routes into tray items. The shells exclude this id
          // from their sidebars, so the placement only adds reachability.
          placement: ['sidebar', 'tab-bar', 'tray'],
          order: 95,
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

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
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
}

export const name = 'plugin-settings'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-settings: loaded')
  const fiber = await ctx.plugin(SettingsPlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
