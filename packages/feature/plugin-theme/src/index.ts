/**
 * `plugin-theme` — application color management and theme service.
 *
 * Implements `ctx.theme` and provides dynamic theme registration,
 * real-time CSS variable injection into the DOM, and persistence.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type { Disposable, ThemeDefinition, ThemeService } from '@BBeBee/protocol'
import {
  applyThemeToDom,
  builtInThemes,
  defaultTheme,
} from '@BBeBee/ui-tokens'
import { THEME_VIEWS } from './views.js'

const STORE_KEY = 'theme_preference'
const CUSTOM_THEMES_STORE_KEY = 'theme_custom_themes'

export class ThemePlugin extends Service implements ThemeService {
  static override readonly name = 'theme'
  static readonly inject = []

  private readonly ownCtx: Context
  private readonly registry = new Map<string, ThemeDefinition>()
  private activeThemeId = defaultTheme.id
  private appearanceMode: 'dark' | 'light' | 'system' = 'dark'

  constructor(ctx: Context) {
    super(ctx, 'theme')
    this.ownCtx = ctx

    // Seed registry with built-in themes
    for (const [id, def] of Object.entries(builtInThemes)) {
      this.registry.set(id, def)
    }
  }

  async [Service.init]() {
    this.ownCtx.logger?.info?.('plugin-theme: initialized')

    // 1. Try to restore custom themes and active theme preference via store if available
    this.ownCtx.inject(['store'], (scoped) => {
      void scoped.store.get<ThemeDefinition[]>(CUSTOM_THEMES_STORE_KEY).then((customList) => {
        if (Array.isArray(customList)) {
          for (const customTheme of customList) {
            if (customTheme && customTheme.id && !(customTheme.id in builtInThemes)) {
              this.registry.set(customTheme.id, customTheme)
            }
          }
          this.ownCtx.emit('theme/registry-changed', this.getThemes())
        }
      }).catch(() => {})

      void scoped.store.get<string>(STORE_KEY).then((storedId) => {
        if (storedId && this.registry.has(storedId)) {
          this.activeThemeId = storedId
          this.applyActiveTheme()
        }
      }).catch(() => {})
    })

    // 2. Synchronize with settings if available
    this.ownCtx.inject(['settings'], (scoped) => {
      const initial = scoped.settings.getSync?.()
      let updated = false
      if (initial?.theme && (initial.theme === 'dark' || initial.theme === 'light' || initial.theme === 'system')) {
        this.appearanceMode = initial.theme
        updated = true
      }
      if (initial?.themeId && this.registry.has(initial.themeId)) {
        this.activeThemeId = initial.themeId
        updated = true
      }
      if (updated) {
        this.applyActiveTheme()
      }

      scoped.on('settings/changed', (s) => {
        let changed = false
        if (s.theme && (s.theme === 'dark' || s.theme === 'light' || s.theme === 'system') && s.theme !== this.appearanceMode) {
          this.appearanceMode = s.theme
          changed = true
        }
        if (s.themeId && s.themeId !== this.activeThemeId && this.registry.has(s.themeId)) {
          this.activeThemeId = s.themeId
          changed = true
        }
        if (changed) {
          this.applyActiveTheme()
          this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
        }
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

    // 2.5 Contribute this plugin's settings entries — the theme management
    // card and the appearance-mode selector. The settings screen aggregates
    // whatever is contributed and owns none of it (docs/08 §3).
    this.ownCtx.inject(['ui'], (scoped) => {
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'settings',
          id: THEME_VIEWS.settingsCard,
          section: 'general',
          title: '主题与色彩管理',
          description: '切换播放器主题风格，或动态导入/管理更多色彩方案',
          icon: 'palette',
          display: 'card',
          order: 20,
        })
        yield scoped.ui.contribute({
          kind: 'settings',
          id: 'theme.mode',
          section: 'general',
          title: '外观模式',
          description: '切换应用深色/浅色/跟随系统外观',
          icon: 'moon',
          order: 30,
          fields: [
            {
              key: 'theme',
              type: 'select',
              label: '主题模式',
              options: [
                { value: 'dark', label: '深色模式' },
                { value: 'light', label: '浅色模式' },
                { value: 'system', label: '跟随系统' },
              ],
            },
          ],
        })
      }, 'theme-settings-contributions')
    })

    // 3. Immediately apply the active theme to DOM
    this.applyActiveTheme()
  }

  getThemes(): readonly ThemeDefinition[] {
    return Array.from(this.registry.values())
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

  async setTheme(themeId: string): Promise<void> {
    const target = this.registry.get(themeId)
    if (!target) {
      this.ownCtx.logger.warn(`theme: unknown theme id "${themeId}"`)
      return
    }

    if (this.activeThemeId === themeId) return

    this.activeThemeId = themeId
    this.applyActiveTheme()

    // Persist to store
    try {
      const store = (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
        .reflect?.get('store', false) as { set(k: string, v: unknown): Promise<void> } | undefined
      if (store) {
        await store.set(STORE_KEY, themeId)
      }
    } catch (err) {
      this.ownCtx.logger?.warn?.(`theme: failed to persist theme: ${err}`)
    }

    // Sync with settings service if present
    const settings = (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('settings', false) as { update(p: unknown): Promise<unknown> } | undefined
    if (settings) {
      void settings.update({ themeId }).catch(() => {})
    }

    this.ownCtx.emit('theme/changed', this.getCurrentTheme(), this.getEffectiveScheme())
  }

  registerTheme(theme: ThemeDefinition): Disposable {
    this.registry.set(theme.id, theme)
    this.ownCtx.logger.info(`theme: registered runtime theme "${theme.id}" (${theme.name})`)
    if (!(theme.id in builtInThemes)) {
      void this.persistCustomThemes()
    }
    this.ownCtx.emit('theme/registry-changed', this.getThemes())

    return () => {
      this.removeTheme(theme.id)
    }
  }

  removeTheme(themeId: string): boolean {
    if (themeId in builtInThemes) {
      this.ownCtx.logger.warn(`theme: cannot remove built-in theme "${themeId}"`)
      return false
    }

    if (this.registry.delete(themeId)) {
      this.ownCtx.logger.info(`theme: removed theme "${themeId}"`)
      if (this.activeThemeId === themeId) {
        void this.setTheme(defaultTheme.id)
      }
      void this.persistCustomThemes()
      this.ownCtx.emit('theme/registry-changed', this.getThemes())
      return true
    }

    return false
  }

  private async persistCustomThemes(): Promise<void> {
    try {
      const store = (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
        .reflect?.get('store', false) as { set(k: string, v: unknown): Promise<void> } | undefined
      if (store) {
        const customThemes = this.getThemes().filter((t) => !(t.id in builtInThemes))
        await store.set(CUSTOM_THEMES_STORE_KEY, customThemes)
      }
    } catch (err) {
      this.ownCtx.logger?.warn?.(`theme: failed to persist custom themes: ${err}`)
    }
  }

  onThemeChange(listener: (theme: ThemeDefinition, scheme?: 'dark' | 'light') => void): Disposable {
    return this.ownCtx.on('theme/changed', listener)
  }

  private applyActiveTheme(): void {
    const base = this.registry.get(this.activeThemeId) ?? defaultTheme
    const effectiveScheme = this.getEffectiveScheme()
    applyThemeToDom(base, effectiveScheme)
  }
}

export const name = 'plugin-theme'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-theme: loaded')
  const fiber = await ctx.plugin(ThemePlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
