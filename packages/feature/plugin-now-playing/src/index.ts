/**
 * `plugin-now-playing` — the "what is playing" surfaces.
 *
 * A **surface** plugin: the full-screen player and the persistent bar that
 * opens it. Both were part of `plugin-player`, which made the transport
 * service also the owner of two screens — a plugin whose job is playback
 * should not have to change when a screen does.
 *
 * It provides the `ctx.nowPlaying` service for layout style preference
 * management (classic, full-cover, vinyl, compact). Transport state and the
 * queue belong to `ctx.player`.
 *
 * The queue screen is its own plugin (`plugin-queue`): up-next is a different
 * question from what is playing now, and the queue model is the player's.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from 'cordis'
import type { Disposable, NowPlayingService, NowPlayingStyleId, NowPlayingStyleMeta } from '@BBeBee/protocol'
import { DEFAULT_NOW_PLAYING_STYLE, NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { NOW_PLAYING_ROUTES, NOW_PLAYING_VIEWS } from './views.js'

const STORE_KEY = 'now-playing.style'
const CUSTOM_STYLES_STORE_KEY = 'now-playing.custom-styles'

export class NowPlayingPlugin extends Service implements NowPlayingService {
  static override readonly name = 'nowPlaying'
  static readonly inject = []

  private currentStyle: NowPlayingStyleId = DEFAULT_NOW_PLAYING_STYLE
  private readonly styles = new Map<string, NowPlayingStyleMeta>()
  private cachedStyles: readonly NowPlayingStyleMeta[] = []

  private refreshCachedStyles(): void {
    this.cachedStyles = Object.freeze(Array.from(this.styles.values()))
  }

  constructor(ctx: Context) {
    super(ctx, 'nowPlaying')

    // Seed registry with built-in styles
    for (const style of NOW_PLAYING_STYLES) {
      this.styles.set(style.id, { ...style, type: 'builtin' })
    }
    this.refreshCachedStyles()

    // 1. Restore persisted custom styles & preferred style via store
    this.ctx.inject(['store'], (scoped) => {
      void scoped.store.get<NowPlayingStyleMeta[]>(CUSTOM_STYLES_STORE_KEY).then((customList) => {
        if (Array.isArray(customList)) {
          for (const item of customList) {
            if (item && item.id && !this.styles.has(item.id)) {
              this.styles.set(item.id, { ...item, type: item.type ?? 'sandboxed' })
            }
          }
          this.refreshCachedStyles()
          this.ctx.emit('now-playing/registry-changed', this.getStyles())
        }
      }).catch(() => {})

      void scoped.store.get<string>(STORE_KEY).then((storedId) => {
        if (storedId && this.styles.has(storedId)) {
          this.currentStyle = storedId as NowPlayingStyleId
          this.ctx.emit('now-playing/style-changed', this.currentStyle)
        }
      }).catch(() => {})
    })

    // 2. Sync with settings service if present
    this.ctx.inject(['settings'], (scoped) => {
      const initial = scoped.settings.getSync?.()
      if (initial?.nowPlayingStyle && this.styles.has(initial.nowPlayingStyle)) {
        this.currentStyle = initial.nowPlayingStyle as NowPlayingStyleId
        this.ctx.emit('now-playing/style-changed', this.currentStyle)
      }

      scoped.on('settings/changed', (s) => {
        if (s.nowPlayingStyle && s.nowPlayingStyle !== this.currentStyle && this.styles.has(s.nowPlayingStyle)) {
          this.setStyle(s.nowPlayingStyle as NowPlayingStyleId)
        }
      })
    })
  }

  getStyle(): NowPlayingStyleId {
    return this.currentStyle
  }

  getStyles(): readonly NowPlayingStyleMeta[] {
    return this.cachedStyles
  }

  setStyle(id: NowPlayingStyleId): void {
    if (!this.styles.has(id)) {
      this.ctx.logger.warn(`now-playing: unknown style "${id}"`)
      return
    }
    if (id === this.currentStyle) return
    this.currentStyle = id
    this.ctx.emit('now-playing/style-changed', id)

    // Persist to store if available
    const store = (this.ctx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('store', false) as { set(k: string, v: unknown): Promise<void> } | undefined
    if (store) {
      store.set(STORE_KEY, id).catch((err) => {
        this.ctx.logger.warn(`now-playing: failed to persist style: ${err}`)
      })
    }

    // Persist to settings if available
    const settings = (this.ctx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('settings', false) as { update(p: Record<string, unknown>): Promise<unknown> } | undefined
    if (settings) {
      settings.update({ nowPlayingStyle: id }).catch(() => {})
    }
  }

  registerStyle(meta: NowPlayingStyleMeta): Disposable {
    if (!meta.id || !meta.name) {
      throw new Error('registerStyle: style must have non-empty id and name')
    }
    const finalMeta: NowPlayingStyleMeta = {
      ...meta,
      type: meta.type ?? 'sandboxed',
    }
    this.styles.set(meta.id, finalMeta)
    this.refreshCachedStyles()
    this.persistCustomStyles()
    this.ctx.emit('now-playing/registry-changed', this.getStyles())

    return () => {
      this.removeStyle(meta.id)
    }
  }

  removeStyle(id: string): boolean {
    const existing = this.styles.get(id)
    if (!existing) return false
    if (existing.type === 'builtin') {
      this.ctx.logger.warn(`now-playing: cannot remove built-in style "${id}"`)
      return false
    }

    this.styles.delete(id)
    this.refreshCachedStyles()
    this.persistCustomStyles()

    // If active style was deleted, reset to default style
    if (this.currentStyle === id) {
      this.setStyle(DEFAULT_NOW_PLAYING_STYLE)
    }

    this.ctx.emit('now-playing/registry-changed', this.getStyles())
    return true
  }

  private persistCustomStyles(): void {
    const customList = Array.from(this.styles.values()).filter((s) => s.type !== 'builtin')
    const store = (this.ctx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('store', false) as { set(k: string, v: unknown): Promise<void> } | undefined
    if (store) {
      store.set(CUSTOM_STYLES_STORE_KEY, customList).catch((err) => {
        this.ctx.logger.warn(`now-playing: failed to persist custom styles: ${err}`)
      })
    }
  }
}

export const name = 'plugin-now-playing'

/**
 * The page's route descriptor.
 *
 * `placement: ['tab-bar']` is unchanged from when the player contributed it:
 * on mobile the full-screen player is a tab, and on desktop it is reached by
 * opening the bar — a tab for a screen the bar already reaches would be a
 * second door to the same room.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-now-playing: loaded')

  const serviceFiber = await ctx.plugin(NowPlayingPlugin)

  // The `ui` inject is a child fiber, so unloading this plugin unloads the
  // contribution with it. Not awaited: a build without `plugin-ui` is a build
  // with no contribution, not a plugin that never finishes loading.
  const uiFiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      scoped.logger.debug(`now-playing: contributing route ${NOW_PLAYING_ROUTES.nowPlaying}`)
      yield scoped.ui.contribute({
        kind: 'route',
        id: NOW_PLAYING_ROUTES.nowPlaying,
        path: '/now-playing',
        title: 'Now playing',
        icon: 'play',
        placement: ['tab-bar'],
        order: 10,
      })
      yield scoped.ui.contribute({
        kind: 'settings',
        id: NOW_PLAYING_VIEWS.stylesSettings,
        section: 'playback',
        title: '播放页样式模板 (Now Playing Layout Styles)',
        description: '选择全屏播放页呈现布局，支持原生内置样式与动态导入第三方沙箱模板插件',
        icon: 'layout',
        display: 'card',
        order: 10,
      })
    }, 'now-playing-ui-contributions'),
  )

  return () => {
    uiFiber.dispose()
    serviceFiber.dispose()
  }
}

export default { name, apply }
