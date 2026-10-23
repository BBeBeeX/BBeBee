import { describe, expect, it } from 'vitest'
import { Context } from '@BBeBee/kernel'
import { ThemePlugin } from './index.js'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'
import type { ThemeDefinition } from '@BBeBee/protocol'

describe('ThemePlugin', () => {
  it('initializes with default midnight-purple theme', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
    expect(ctx.theme.getThemes().length).toBeGreaterThanOrEqual(2)
  })

  it('switches between built-in themes and fires event', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    let changedTo: ThemeDefinition | undefined
    ctx.theme.onThemeChange((t) => {
      changedTo = t
    })

    await ctx.theme.setTheme('emerald-green')
    expect(ctx.theme.getCurrentTheme().id).toBe('emerald-green')
    expect(changedTo?.id).toBe('emerald-green')
    expect(ctx.theme.getCurrentTheme().tokens.brand.primary).toBe('#1DB954')
  })

  it('supports runtime dynamic theme registration and deregistration', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    const customTheme: ThemeDefinition = {
      id: 'custom-neon',
      name: 'Custom Neon',
      isDark: true,
      tokens: {
        ...midnightPurpleTheme.tokens,
        brand: {
          ...midnightPurpleTheme.tokens.brand,
          primary: '#00F0FF',
        },
      },
    }

    const unregister = ctx.theme.registerTheme(customTheme)
    expect(ctx.theme.getThemes().some((t) => t.id === 'custom-neon')).toBe(true)

    await ctx.theme.setTheme('custom-neon')
    expect(ctx.theme.getCurrentTheme().id).toBe('custom-neon')
    expect(ctx.theme.getCurrentTheme().tokens.brand.primary).toBe('#00F0FF')

    // Disposing unregisters the theme and falls back to default
    unregister()
    expect(ctx.theme.getThemes().some((t) => t.id === 'custom-neon')).toBe(false)
    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
  })

  it('supports removeTheme explicitly and prevents removing built-in themes', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    expect(ctx.theme.removeTheme('midnight-purple')).toBe(false)
    expect(ctx.theme.removeTheme('emerald-green')).toBe(false)

    const customTheme: ThemeDefinition = {
      id: 'custom-solar',
      name: 'Warm Gold',
      isDark: true,
      tokens: {
        ...midnightPurpleTheme.tokens,
        brand: { ...midnightPurpleTheme.tokens.brand, primary: '#FFAA00' },
      },
    }

    ctx.theme.registerTheme(customTheme)
    await ctx.theme.setTheme('custom-solar')
    expect(ctx.theme.getCurrentTheme().id).toBe('custom-solar')

    const removed = ctx.theme.removeTheme('custom-solar')
    expect(removed).toBe(true)
    expect(ctx.theme.getThemes().some((t) => t.id === 'custom-solar')).toBe(false)
    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
  })

  it('resolves effective scheme and adapts tokens to light mode when settings change', async () => {
    const ctx = new Context()
    ctx.provide('settings', {
      getSync: () => ({ theme: 'dark', themeId: 'midnight-purple' }),
    } as never)

    await ctx.plugin(ThemePlugin)

    expect(ctx.theme.getEffectiveScheme()).toBe('dark')
    expect(ctx.theme.getCurrentTheme().isDark).toBe(true)
    expect(ctx.theme.getCurrentTheme().tokens.bg.app).toBe('#05060A')

    let emittedTheme: ThemeDefinition | undefined
    let emittedScheme: 'dark' | 'light' | undefined
    ctx.theme.onThemeChange((t, scheme) => {
      emittedTheme = t
      emittedScheme = scheme
    })

    // Simulate settings update to light mode via kernel event
    ctx.emit('settings/changed', { theme: 'light' } as never)

    expect(ctx.theme.getEffectiveScheme()).toBe('light')
    expect(ctx.theme.getCurrentTheme().isDark).toBe(false)
    expect(ctx.theme.getCurrentTheme().tokens.bg.app).toBe('#F0F4FC')
    expect(emittedTheme?.isDark).toBe(false)
    expect(emittedScheme).toBe('light')
  })
})

describe('ThemePlugin packs', () => {
  const makeVariant = (id: string, primary: string) => ({
    id,
    name: `Variant ${id}`,
    isDark: true,
    tokens: {
      ...midnightPurpleTheme.tokens,
      brand: { ...midnightPurpleTheme.tokens.brand, primary },
    },
  })

  it('seeds the built-in themes as single-variant packs grouped by the general category', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)
    const packs = ctx.theme.getPacks!()
    expect(packs.length).toBeGreaterThanOrEqual(4)
    for (const pack of packs.filter((p) => p.origin === 'builtin')) {
      expect(pack.variants).toHaveLength(1)
      expect(pack.variants[0]?.packId).toBe(pack.id)
    }
  })

  it('registers a multi-variant pack, switches inside it, and removes it whole', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)
    const dispose = ctx.theme.registerThemePack!({
      id: 'acme-suite',
      name: 'Acme Suite',
      origin: 'plugin',
      variants: [makeVariant('acme-a', '#FF0000'), makeVariant('acme-b', '#00FF00')],
    })
    expect(ctx.theme.getPacks!().some((p) => p.id === 'acme-suite')).toBe(true)
    await ctx.theme.setTheme('acme-b')
    expect(ctx.theme.getCurrentTheme().id).toBe('acme-b')
    expect(ctx.theme.getCurrentTheme().tokens.brand.primary).toBe('#00FF00')

    dispose()
    expect(ctx.theme.getPacks!().some((p) => p.id === 'acme-suite')).toBe(false)
    expect(ctx.theme.getThemes().some((t) => t.id === 'acme-a')).toBe(false)
    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
  })

  it('re-registering the active variant refreshes it without a theme switch', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)
    ctx.theme.registerThemePack!({
      id: 'live-pack',
      name: 'Live',
      origin: 'plugin',
      variants: [makeVariant('live-one', '#FF0000')],
    })
    await ctx.theme.setTheme('live-one')
    let emitted: string | undefined
    ctx.theme.onThemeChange((t) => {
      emitted = t.tokens.brand.primary
    })
    ctx.theme.registerThemePack!({
      id: 'live-pack',
      name: 'Live',
      origin: 'plugin',
      variants: [makeVariant('live-one', '#0000FF')],
    })
    expect(ctx.theme.getCurrentTheme().tokens.brand.primary).toBe('#0000FF')
    expect(emitted).toBe('#0000FF')
  })

  it('refuses to remove a built-in pack', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)
    expect(ctx.theme.removePack!('midnight-purple')).toBe(false)
    expect(ctx.theme.getThemes().some((t) => t.id === 'midnight-purple')).toBe(true)
  })

  it('persists custom packs only, under the split key', async () => {
    const data = new Map<string, unknown>()
    const ctx = new Context()
    ctx.provide('store', {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: unknown) => {
        data.set(k, v)
      },
    } as never)
    await ctx.plugin(ThemePlugin)
    await new Promise((r) => setTimeout(r, 10))

    ctx.theme.registerThemePack!({
      id: 'my-pack',
      name: 'Mine',
      origin: 'custom',
      variants: [makeVariant('my-one', '#FF00FF')],
    })
    ctx.theme.registerThemePack!({
      id: 'plug-pack',
      name: 'Plugin Pack',
      origin: 'plugin',
      variants: [makeVariant('plug-one', '#00FFFF')],
    })
    await new Promise((r) => setTimeout(r, 10))

    const custom = data.get('theme_packs_custom') as Array<{ id: string }> | undefined
    expect(custom?.map((p) => p.id)).toEqual(['my-pack'])
    expect(data.has('theme_packs_registry')).toBe(false)
    expect(data.has('theme_custom_themes')).toBe(false)
  })

  it('migrates the legacy flat custom-theme list into packs', async () => {
    const data = new Map<string, unknown>([
      ['theme_custom_themes', [makeVariant('legacy-one', '#ABCDEF')]],
    ])
    const ctx = new Context()
    ctx.provide('store', {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: unknown) => {
        data.set(k, v)
      },
    } as never)
    await ctx.plugin(ThemePlugin)
    await new Promise((r) => setTimeout(r, 20))

    const pack = ctx.theme.getPacks!().find((p) => p.id === 'legacy-one')
    expect(pack?.origin).toBe('custom')
    expect(pack?.variants[0]?.id).toBe('legacy-one')
    expect(data.has('theme_packs_custom')).toBe(true)
  })

  it('generates the dynamic pack from the playing track dominant colour', async () => {
    const ctx = new Context()
    const playerState = {
      nowPlaying: { title: 'Song', artwork: { id: 'a1', dominantColor: '#FF8800' } },
    }
    ctx.provide('player', { state: playerState } as never)
    await ctx.plugin(ThemePlugin)
    await new Promise((r) => setTimeout(r, 10))

    const dynamicBrand = () =>
      ctx.theme.getPacks!().find((p) => p.id === 'dynamic-cover')?.variants[0]?.tokens.brand.primary
    expect(ctx.theme.getPacks!().find((p) => p.id === 'dynamic-cover')?.origin).toBe('dynamic')
    const before = dynamicBrand()

    // Real-player ordering: track-changed fires synchronously while the
    // state still shows the *previous* track; the new nowPlaying (with
    // the new cover colour) only lands afterwards, announced by
    // state-changed. The seed must not move on track-changed alone…
    ctx.emit('player/track-changed', 'bbebee:track:x', undefined)
    await new Promise((r) => setTimeout(r, 10))
    expect(dynamicBrand()).toBe(before)

    // …and must move when state-changed publishes the new nowPlaying.
    playerState.nowPlaying.artwork.dominantColor = '#0044FF'
    ctx.emit('player/state-changed', playerState as never)
    await new Promise((r) => setTimeout(r, 10))
    const after = dynamicBrand()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })

  it('extracts the dynamic seed from cover pixels when no dominant colour is declared', async () => {
    // Local scans store artworks.dominant_color as NULL, so the declared
    // colour is absent in the common case; the seed must come from the
    // cover image itself (the detail pages' fallback, shared via
    // ui-tokens). Fake the image + canvas: a solid red cover.
    const size = 32
    const data = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200
      data[i + 1] = 30
      data[i + 2] = 40
      data[i + 3] = 255
    }
    const images: Array<{ src: string; onload: (() => void) | null }> = []
    class FakeImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(v: string) {
        images.push(this as never)
        ;(this as { _src?: string })._src = v
      }
      get src() {
        return (this as { _src?: string })._src ?? ''
      }
    }
    const g = globalThis as Record<string, unknown>
    const realImage = g['Image']
    const realDocument = g['document']
    g['Image'] = FakeImage
    g['document'] = {
      documentElement: {
        style: { colorScheme: '', setProperty: () => {}, removeProperty: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {},
        getAttribute: () => null,
      },
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data }) }),
      }),
    }
    try {
      const ctx = new Context()
      const playerState = {
        nowPlaying: {
          title: 'Song',
          artworkUri: 'file:///covers/red.jpg',
          artwork: { id: 'a1', sourceUrl: 'file:///covers/red.jpg' },
        },
      }
      ctx.provide('player', { state: playerState } as never)
      await ctx.plugin(ThemePlugin)
      await new Promise((r) => setTimeout(r, 10))
      expect(images.length).toBe(1)
      expect(images[0]!.src).toContain('red.jpg')

      images[0]!.onload?.()
      await new Promise((r) => setTimeout(r, 10))
      const { generateThemeFromSeed } = await import('@BBeBee/ui-tokens')
      const expected = generateThemeFromSeed('#c81e28', { scheme: 'tonal-spot', contrast: 0 })
      const dynamic = ctx.theme.getPacks!().find((p) => p.id === 'dynamic-cover')
      expect(dynamic?.variants[0]?.tokens.brand.primary).toBe(expected.tokens.brand.primary)
    } finally {
      g['Image'] = realImage
      g['document'] = realDocument
    }
  })

  it('falls back to the artwork source URL when the first cover candidate fails', async () => {
    const size = 32
    const data = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200
      data[i + 1] = 30
      data[i + 2] = 40
      data[i + 3] = 255
    }
    const images: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = []
    class FakeImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(v: string) {
        ;(this as { _src?: string })._src = v
        images.push(this as never)
      }
      get src() {
        return (this as { _src?: string })._src ?? ''
      }
    }
    const g = globalThis as Record<string, unknown>
    const realImage = g['Image']
    const realDocument = g['document']
    g['Image'] = FakeImage
    g['document'] = {
      documentElement: {
        style: { colorScheme: '', setProperty: () => {}, removeProperty: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {},
        getAttribute: () => null,
      },
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data }) }),
      }),
    }
    try {
      const ctx = new Context()
      ctx.provide('player', {
        state: {
          nowPlaying: {
            title: 'Song',
            artworkUri: 'file:///covers/missing.jpg',
            artwork: { id: 'a1', sourceUrl: 'file:///covers/red.jpg' },
          },
        },
      } as never)
      await ctx.plugin(ThemePlugin)
      await new Promise((r) => setTimeout(r, 10))
      expect(images.length).toBe(1)
      expect(images[0]!.src).toContain('missing.jpg')
      images[0]!.onerror?.()
      await new Promise((r) => setTimeout(r, 5))
      expect(images.length).toBe(2)
      expect(images[1]!.src).toContain('red.jpg')
      images[1]!.onload?.()
      await new Promise((r) => setTimeout(r, 10))
      const { generateThemeFromSeed } = await import('@BBeBee/ui-tokens')
      const expected = generateThemeFromSeed('#c81e28', { scheme: 'tonal-spot', contrast: 0 })
      const dynamic = ctx.theme.getPacks!().find((p) => p.id === 'dynamic-cover')
      expect(dynamic?.variants[0]?.tokens.brand.primary).toBe(expected.tokens.brand.primary)
    } finally {
      g['Image'] = realImage
      g['document'] = realDocument
    }
  })

  it('applies glass variables to :root when the glass settings change', async () => {
    const props = new Map<string, string>()
    const attrs = new Map<string, string>()
    const element = {
      style: {
        colorScheme: '',
        setProperty: (k: string, v: string) => void props.set(k, v),
        removeProperty: (k: string) => void props.delete(k),
      },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    }
    ;(globalThis as Record<string, unknown>).document = { documentElement: element }
    try {
      const ctx = new Context()
      let current: Record<string, unknown> = {}
      ctx.provide('settings', {
        getSync: () => current,
        update: async (patch: Record<string, unknown>) => {
          current = { ...current, ...patch }
          ctx.emit('settings/changed', current as never)
          return current
        },
      } as never)
      await ctx.plugin(ThemePlugin)
      await new Promise((r) => setTimeout(r, 10))
      expect(props.get('--glass-sidebar-bg')).toBeUndefined()

      const { DEFAULT_GLASS_SETTINGS } = await import('@BBeBee/protocol')
      await (
        ctx as unknown as {
          settings: { update(p: unknown): Promise<unknown> }
        }
      ).settings.update({
        glass: {
          ...DEFAULT_GLASS_SETTINGS,
          window: { ...DEFAULT_GLASS_SETTINGS.window, enabled: true },
          components: { ...DEFAULT_GLASS_SETTINGS.components, enabled: true },
        },
      })
      await new Promise((r) => setTimeout(r, 10))
      expect(props.get('--glass-sidebar-bg')).toContain('color-mix')
      expect(props.get('--glass-ambient-bg')).toContain('var(--primary)')
      expect(props.get('--glass-ambient-bg')).not.toContain('--brand-')
      // Window glass marks the root element so the stylesheet can lift
      // the opaque :root/body/#root backgrounds (index.html).
      expect(attrs.get('data-window-glass')).toBe('on')
    } finally {
      delete (globalThis as Record<string, unknown>).document
    }
  })
})
