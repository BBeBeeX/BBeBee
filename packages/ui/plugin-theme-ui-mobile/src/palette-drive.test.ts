/**
 * The palette driver — scheme resolution, definition resolution, and the
 * wire/unwire lifecycle against a real cordis context with stub services.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { AppSettings, ThemeDefinition } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { emeraldGreenTheme, midnightPurpleTheme } from '@BBeBee/ui-tokens'
import {
  activePalette,
  configureNative,
  getScheme,
  setPalette,
  setScheme,
  type AppearanceLike,
} from '@BBeBee/ui-kit-mobile'
import { resolveDefinition, resolveEffectiveScheme, wirePaletteDrive } from './palette-drive.js'
import plugin from './index.js'

/** The runtime reflection surface cordis exposes on a Context (see plugin-theme's own store access). */
function reflectGet(ctx: Context, key: string): unknown {
  return (ctx as unknown as { reflect?: { get(k: string, req: boolean): unknown } }).reflect?.get(key, false)
}

afterEach(() => {
  setPalette(null)
  setScheme('dark')
})

describe('resolveEffectiveScheme', () => {
  it('passes explicit modes straight through', () => {
    expect(resolveEffectiveScheme('dark', undefined)).toBe('dark')
    expect(resolveEffectiveScheme('light', undefined)).toBe('light')
  })

  it('degrades system mode to dark without an Appearance primitive', () => {
    expect(resolveEffectiveScheme('system', undefined)).toBe('dark')
  })

  it('asks the injected Appearance in system mode', () => {
    const light: AppearanceLike = {
      getColorScheme: () => 'light',
      addChangeListener: () => ({ remove: () => {} }),
    }
    const dark: AppearanceLike = {
      getColorScheme: () => 'dark',
      addChangeListener: () => ({ remove: () => {} }),
    }
    const unset: AppearanceLike = {
      getColorScheme: () => null,
      addChangeListener: () => ({ remove: () => {} }),
    }
    expect(resolveEffectiveScheme('system', light)).toBe('light')
    expect(resolveEffectiveScheme('system', dark)).toBe('dark')
    expect(resolveEffectiveScheme('system', unset)).toBe('dark')
  })
})

describe('resolveDefinition', () => {
  const registry = [midnightPurpleTheme, emeraldGreenTheme]

  it('prefers the event payload', () => {
    expect(resolveDefinition({ getCurrentTheme: () => midnightPurpleTheme, getThemes: () => registry }, emeraldGreenTheme)).toBe(
      emeraldGreenTheme,
    )
  })

  it('re-reads the registry by the current id so lightTokens are visible', () => {
    expect(resolveDefinition({ getCurrentTheme: () => midnightPurpleTheme, getThemes: () => registry })).toBe(
      midnightPurpleTheme,
    )
    expect(
      resolveDefinition({
        getCurrentTheme: () => ({ ...emeraldGreenTheme, tokens: midnightPurpleTheme.tokens }),
        getThemes: () => registry,
      }),
    ).toBe(emeraldGreenTheme)
  })

  it('falls back to the default theme with nothing at all', () => {
    expect(resolveDefinition(undefined)).toBe(midnightPurpleTheme)
    expect(resolveDefinition({})).toBe(midnightPurpleTheme)
  })
})

describe('wirePaletteDrive', () => {
  /** A theme that ships dedicated light tokens, to prove the scheme swap. */
  const DUAL: ThemeDefinition = {
    ...midnightPurpleTheme,
    id: 'dual-scheme',
    lightTokens: {
      ...midnightPurpleTheme.tokens,
      bg: { ...midnightPurpleTheme.tokens.bg, app: '#F4F4F6' },
    },
  }

  class ThemeStub extends Service {
    current: ThemeDefinition = midnightPurpleTheme
    constructor(ctx: Context) {
      super(ctx, 'theme')
    }
    getCurrentTheme = () => this.current
    getThemes = () => [midnightPurpleTheme, emeraldGreenTheme, DUAL]
  }

  class SettingsStub extends Service {
    settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
    constructor(ctx: Context) {
      super(ctx, 'settings')
    }
    getSync = () => this.settings
  }

  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    registerView = () => () => {}
    viewFor = () => undefined
    navigate = () => {}
    contribute = () => () => {}
  }

  async function harness(appearance?: AppearanceLike) {
    configureNative({
      View: 'View',
      Text: 'Text',
      Pressable: 'Pressable',
      Image: 'Image',
      Modal: 'Modal',
      FlashList: 'FlashList',
      ActivityIndicator: 'ActivityIndicator',
      TextInput: 'TextInput',
      ...(appearance ? { Appearance: appearance } : {}),
    })
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(ThemeStub)
    await ctx.plugin(SettingsStub)
    return ctx
  }

  it('installs the active theme palette once the services are reachable', async () => {
    const ctx = await harness()
    await ctx.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(activePalette().accent.base).toBe(midnightPurpleTheme.tokens.brand.primary)
    expect(activePalette().bg.base).toBe(midnightPurpleTheme.tokens.bg.primary)
  })

  it('follows theme/changed events', async () => {
    const ctx = await harness()
    await ctx.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))

    ctx.emit('theme/changed', emeraldGreenTheme, 'dark')
    expect(activePalette().accent.base).toBe(emeraldGreenTheme.tokens.brand.primary)
  })

  it('swaps to lightTokens when the appearance mode goes light', async () => {
    const ctx = await harness()
    await ctx.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const settings = reflectGet(ctx, 'settings') as SettingsStub

    // A theme with dedicated light tokens, painted dark first.
    ctx.emit('theme/changed', DUAL, 'dark')
    expect(activePalette().bg.sunken).toBe(DUAL.tokens.bg.app)

    settings.settings = { ...DEFAULT_APP_SETTINGS, theme: 'light' }
    ctx.emit('settings/changed', settings.settings)

    expect(activePalette().bg.sunken).toBe('#F4F4F6')
  })

  it('resolves system mode through the Appearance change listener', async () => {
    let systemScheme: 'light' | 'dark' | null = 'dark'
    const listeners = new Set<(prefs: { colorScheme: 'light' | 'dark' | null }) => void>()
    const appearance: AppearanceLike = {
      getColorScheme: () => systemScheme,
      addChangeListener: (listener) => {
        listeners.add(listener)
        return { remove: () => listeners.delete(listener) }
      },
    }
    const ctx = await harness(appearance)
    const settings = reflectGet(ctx, 'settings') as SettingsStub
    settings.settings = { ...DEFAULT_APP_SETTINGS, theme: 'system' }

    await ctx.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getScheme()).toBe('dark')

    // The OS flips to light. The headless service cannot see this on mobile
    // (no matchMedia) — the drive is the only listener that can react.
    systemScheme = 'light'
    for (const listener of listeners) listener({ colorScheme: 'light' })

    expect(getScheme()).toBe('light')
  })

  it('stops applying after disposal', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(activePalette().accent.base).toBe(midnightPurpleTheme.tokens.brand.primary)
    await fiber.dispose()

    ctx.emit('theme/changed', emeraldGreenTheme, 'dark')
    expect(activePalette().accent.base).toBe(midnightPurpleTheme.tokens.brand.primary)
  })

  it('exposes wirePaletteDrive as the standalone entry point', async () => {
    const ctx = await harness()
    const stop = wirePaletteDrive(ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(activePalette().accent.base).toBe(midnightPurpleTheme.tokens.brand.primary)
    stop()
    expect(typeof stop).toBe('function')
  })
})
