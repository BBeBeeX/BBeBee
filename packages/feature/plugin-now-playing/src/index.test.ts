/**
 * `plugin-now-playing` as a plugin: it contributes the route that opens the
 * player, provides the nowPlaying service for style preferences, and unloads
 * cleanly.
 *
 * The route id is the contract the shells navigate to and the bar calls, so it
 * is pinned here rather than only exercised through a screen.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'
import { NOW_PLAYING_ROUTES, NOW_PLAYING_VIEWS } from './views.js'

/** `ctx.ui`, as far as this plugin is concerned: a place to contribute. */
class UiStub extends Service {
  readonly contributed: { id: string; path?: string; kind: string }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  contribute(c: { kind: string; id: string; path?: string }) {
    this.contributed.push({ kind: c.kind, id: c.id, ...(c.path ? { path: c.path } : {}) })
    return () => {}
  }
}

describe('plugin-now-playing', () => {
  it('contributes the now-playing route once the ui registry is up', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(plugin)
    await tick()

    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributed).toEqual([
      { kind: 'route', id: NOW_PLAYING_ROUTES.nowPlaying, path: '/now-playing' },
      { kind: 'settings', id: NOW_PLAYING_VIEWS.stylesSettings },
    ])
  })

  it('loads with no ui registry at all, contributing nothing', async () => {
    // A build without `plugin-ui` is a build without a shell, not a broken
    // plugin: the contribution waits in a child fiber that never activates.
    const ctx = new Context()
    await expect(ctx.plugin(plugin)).resolves.toBeDefined()
  })
})

describe('plugin-now-playing style preference', () => {
  it('defaults to classic style and allows changing style with event emission', async () => {
    const ctx = new Context()
    const emitted: string[] = []
    ctx.on('now-playing/style-changed', (id) => {
      emitted.push(id)
    })

    await ctx.plugin(plugin)
    await tick()

    expect(ctx.nowPlaying).toBeDefined()
    expect(ctx.nowPlaying.getStyle()).toBe('classic')

    ctx.nowPlaying.setStyle('vinyl')
    expect(ctx.nowPlaying.getStyle()).toBe('vinyl')
    expect(emitted).toEqual(['vinyl'])

    // Setting same style is a no-op
    ctx.nowPlaying.setStyle('vinyl')
    expect(emitted).toEqual(['vinyl'])

    // Setting invalid style is ignored
    ctx.nowPlaying.setStyle('invalid-style' as any)
    expect(ctx.nowPlaying.getStyle()).toBe('vinyl')
    expect(emitted).toEqual(['vinyl'])
  })

  it('restores stored style and persists changes', async () => {
    const ctx = new Context()
    class SeededStore extends Service {
      data = new Map<string, unknown>([['now-playing.style', 'compact']])
      constructor(c: Context) {
        super(c, 'store')
      }
      async get<T>(key: string): Promise<T | undefined> {
        return this.data.get(key) as T | undefined
      }
      async set(key: string, value: unknown): Promise<void> {
        this.data.set(key, value)
      }
    }
    await ctx.plugin(SeededStore)
    await ctx.plugin(plugin)
    await tick()

    expect(ctx.nowPlaying.getStyle()).toBe('compact')

    ctx.nowPlaying.setStyle('full-cover')
    await tick()

    const store = (ctx as unknown as { store: SeededStore }).store
    expect(await store.get('now-playing.style')).toBe('full-cover')
  })

  it('supports dynamic style registration and removal with store persistence and active fallback', async () => {
    const ctx = new Context()
    class MemoryStore extends Service {
      data = new Map<string, unknown>()
      constructor(c: Context) {
        super(c, 'store')
      }
      async get<T>(key: string): Promise<T | undefined> {
        return this.data.get(key) as T | undefined
      }
      async set(key: string, value: unknown): Promise<void> {
        this.data.set(key, value)
      }
    }
    await ctx.plugin(MemoryStore)
    await ctx.plugin(plugin)
    await tick()

    const initialStyles = ctx.nowPlaying.getStyles()
    expect(initialStyles.length).toBe(5)
    expect(initialStyles.every((s) => s.type === 'builtin')).toBe(true)

    // Cannot remove built-in style
    expect(ctx.nowPlaying.removeStyle('classic')).toBe(false)

    // Register custom sandboxed plugin style
    const customStyle = {
      id: 'neon-cyberpunk',
      name: '霓虹赛博',
      description: '动态全息流光沙箱插件',
      icon: 'sparkles',
      author: 'Tester',
      htmlContent: '<html><body>Hello Neon</body></html>',
    }
    const unregister = ctx.nowPlaying.registerStyle(customStyle)
    await tick()

    expect(ctx.nowPlaying.getStyles().some((s) => s.id === 'neon-cyberpunk')).toBe(true)
    const store = (ctx as unknown as { store: MemoryStore }).store
    const savedCustom = await store.get<any[]>('now-playing.custom-styles')
    expect(savedCustom?.length).toBe(1)
    expect(savedCustom?.[0].id).toBe('neon-cyberpunk')

    // Switch to custom style
    ctx.nowPlaying.setStyle('neon-cyberpunk')
    expect(ctx.nowPlaying.getStyle()).toBe('neon-cyberpunk')

    // Remove active custom style -> resets to classic default
    unregister()
    await tick()

    expect(ctx.nowPlaying.getStyles().some((s) => s.id === 'neon-cyberpunk')).toBe(false)
    expect(ctx.nowPlaying.getStyle()).toBe('classic')
  })
})

describe('plugin-now-playing lifecycle', () => {
  it('snapshots clean after unload, contribution and all', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('snapshots clean after unload when the ui registry never appeared', async () => {
    const ctx = new Context()
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
