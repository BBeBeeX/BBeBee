// @vitest-environment jsdom
/**
 * The mobile visualizer views: registration, the now-playing slot contribution
 * (same ids as desktop), the settings card wiring, and the canvas's
 * enabled/disabled gate.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@BBeBee/kernel'
import type { AppSettings, VisualizerSettings } from '@BBeBee/protocol'
import { DEFAULT_VISUALIZER_SETTINGS } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import pluginVisualizerUi, { inject, name, VisualizerCanvas, VisualizerSettingsCard } from './index.js'
import visualizerLocales from '../../../feature/plugin-i18n/src/locales/visualizer.json'

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: hostComponent('FlashList'),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

/** English stub serving the real `visualizer` catalogue. */
class I18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private en: Record<string, string> = {}
  constructor(ctx: Context) {
    super(ctx, 'i18n')
    const flatten = (node: unknown, prefix: string): void => {
      if (typeof node === 'string') {
        this.en[prefix] = node
        return
      }
      if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k)
      }
    }
    flatten((visualizerLocales as { en: unknown }).en, '')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const path = key.startsWith('visualizer:') ? key.slice('visualizer:'.length) : null
    let text = path !== null && this.en[path] !== undefined ? this.en[path]! : key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (m: string, p: string) =>
        params[p] !== undefined ? String(params[p]) : m,
      )
    }
    return text
  }
  onLocaleChange = (): (() => void) => () => {}
}

class VisualizerStub extends Service {
  public settingsState: VisualizerSettings = { ...DEFAULT_VISUALIZER_SETTINGS }
  public updates: Partial<VisualizerSettings>[] = []
  constructor(ctx: Context) {
    super(ctx, 'visualizer')
  }
  get settings() {
    return this.settingsState
  }
  getFrequencyData = vi.fn()
  getTimeDomainData = vi.fn()
  updateSettings = async (patch: Partial<VisualizerSettings>) => {
    this.updates.push(patch)
    this.settingsState = { ...this.settingsState, ...patch }
  }
}

class SettingsStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'settings')
  }
  getSync = (): Partial<AppSettings> => ({})
  get = async (): Promise<Partial<AppSettings>> => ({})
  update = async () => {}
}

class PlayerStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  get state() {
    return {
      status: 'idle',
      positionMs: 0,
      durationMs: 0,
      bufferedMs: 0,
      volume: 1,
      muted: false,
      repeat: 'off',
      shuffle: false,
      playMode: 'sequence',
    }
  }
}

class UiStub extends Service {
  public views = new Map<string, unknown>()
  public contributions: unknown[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }
  contribute(contribution: unknown) {
    this.contributions.push(contribution)
    return () => {}
  }
  viewFor(id: string) {
    return this.views.get(id)
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(I18nStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(SettingsStub)
  await ctx.plugin(PlayerStub)
  await ctx.plugin(VisualizerStub)
  await ctx.plugin(pluginVisualizerUi)
  const visualizer = (ctx as unknown as { visualizer: VisualizerStub }).visualizer
  const ui = ctx.ui as unknown as UiStub
  return { ctx, visualizer, ui }
}

describe('plugin-visualizer-ui-mobile', () => {
  it('declares the desktop twin dependency set', () => {
    expect(name).toBe('plugin-visualizer-ui-mobile')
    expect(inject).toEqual(['ui', 'visualizer', 'player', 'settings'])
  })

  it('registers the same view ids as desktop and contributes the now-playing slot', async () => {
    const { ui } = await harness()
    expect(ui.viewFor('visualizer.canvas')).toBeDefined()
    expect(ui.viewFor('visualizer.settings')).toBeDefined()
    expect(ui.contributions).toContainEqual(
      expect.objectContaining({
        kind: 'slot',
        id: 'visualizer.canvas',
        slot: 'now-playing.visualizer',
        order: 10,
      }),
    )
  })

  it('renders the canvas frame when enabled and nothing when disabled', async () => {
    const { ctx } = await harness()
    const { container } = render(h(VisualizerCanvas, { ctx }))
    expect(container.querySelector('[data-testid="visualizer-canvas"]')).toBeTruthy()
    // 32 bars plus their 32 peak caps — the dark-accent frame is drawn.
    expect(container.querySelectorAll('[data-host="View"]').length).toBeGreaterThan(32)

    // Disabled flows through the real path: a `settings/changed` write, which
    // is how the settings service reaches `useVisualizer`.
    await act(async () => {
      ctx.emit('settings/changed', {
        visualizer: { ...DEFAULT_VISUALIZER_SETTINGS, enabled: false },
      } as AppSettings)
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="visualizer-canvas"]')).toBeNull()
  })

  it('renders the settings card and hands style picks to ctx.visualizer', async () => {
    const { ctx, visualizer } = await harness()
    const { container, getByTestId } = render(h(VisualizerSettingsCard, { ctx }))

    expect(container.textContent).toContain('Audio Visualizer')
    expect(container.textContent).toContain('Display style')
    expect(container.textContent).toContain('Color theme')
    expect(getByTestId('visualizer-style-circle')).toBeTruthy()

    await act(async () => {
      getByTestId('visualizer-style-circle').click()
      getByTestId('visualizer-theme-rainbow').click()
    })
    expect(visualizer.updates).toContainEqual({ style: 'circle' })
    expect(visualizer.updates).toContainEqual({ colorTheme: 'rainbow' })
  })

  it('toggles the visualizer off from the settings card', async () => {
    const { ctx, visualizer } = await harness()
    const { getByTestId } = render(h(VisualizerSettingsCard, { ctx }))
    await act(async () => {
      getByTestId('visualizer-enabled-switch').click()
    })
    expect(visualizer.updates).toContainEqual({ enabled: false })
  })
})
