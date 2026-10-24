// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { render } from '@testing-library/react'
import type { Context } from 'cordis'
import { Context as CordisContext, Service } from 'cordis'
import { apply, name, inject, VisualizerCanvas, VisualizerSettingsCard } from './index.js'
import { DEFAULT_VISUALIZER_SETTINGS } from '@BBeBee/protocol'
import visualizerLocales from '../../../feature/plugin-i18n/src/locales/visualizer.json'

/**
 * English stub for `ctx.i18n` — resolves keys against the shipped en
 * catalogue so assertions keep reading the English copy. Test-only; the
 * real service is provided by `@bbebee/plugin-i18n` in the app.
 */
class I18nStub extends Service {
  public locale = 'en'
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

describe('plugin-visualizer-ui-desktop', () => {
  it('declares correct name and dependencies', () => {
    expect(name).toBe('plugin-visualizer-ui-desktop')
    expect(inject).toEqual(['ui', 'visualizer', 'player', 'settings'])
  })

  it('registers views and slot on apply', async () => {
    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    const views = new Map<string, unknown>()
    const contributions: unknown[] = []

    untyped['ui'] = {
      registerView: vi.fn((id: string, comp: unknown) => {
        views.set(id, comp)
        return () => views.delete(id)
      }),
      contribute: vi.fn((c: unknown) => {
        contributions.push(c)
        return () => {}
      }),
    }

    const dispose = await apply(mockCtx)
    expect(views.has('visualizer.canvas')).toBe(true)
    expect(views.has('visualizer.settings')).toBe(true)
    expect(contributions).toContainEqual(
      expect.objectContaining({
        kind: 'slot',
        id: 'visualizer.canvas',
        slot: 'now-playing.visualizer',
      }),
    )

    dispose()
  })

  it('renders VisualizerCanvas and VisualizerSettingsCard without throwing', async () => {
    const mockCtx = new CordisContext() as unknown as Context
    await mockCtx.plugin(I18nStub)
    const untyped = mockCtx as unknown as Record<string, unknown>
    const mockSettings = { ...DEFAULT_VISUALIZER_SETTINGS }

    untyped['settings'] = {
      getSync: () => ({ visualizer: mockSettings }),
      get: async () => ({ visualizer: mockSettings }),
      update: vi.fn(),
    }
    untyped['player'] = {
      state: { status: 'playing' },
    }
    untyped['visualizer'] = {
      settings: mockSettings,
      getFrequencyData: vi.fn(),
      getTimeDomainData: vi.fn(),
      updateSettings: vi.fn(),
    }

    const canvasResult = render(h(VisualizerCanvas, { ctx: mockCtx }))
    expect(canvasResult.container.querySelector('canvas')).toBeDefined()

    const settingsResult = render(h(VisualizerSettingsCard, { ctx: mockCtx }))
    expect(settingsResult.getByText('Audio Visualizer')).toBeDefined()
    expect(settingsResult.getByText('Display style')).toBeDefined()
    expect(settingsResult.getByText('Color theme')).toBeDefined()
  })
})
