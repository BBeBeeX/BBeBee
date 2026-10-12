// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from '@BBeBee/kernel'
import type { ChainEntry, DspService } from '@BBeBee/protocol'
import { DspScreen } from './DspScreen.js'
import pluginDspUi from './index.js'
import dspCatalogue from '../../../feature/plugin-i18n/src/locales/dsp.json'

/**
 * English i18n service for tests: serves the real dsp catalogue so components
 * under test render the same copy the app shows (mirrors the DefaultI18nStub
 * in apps/desktop/renderer/Shell.test.tsx).
 */
class I18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0 || key.slice(0, sep) !== 'dsp') return key
    let cur: unknown = (dspCatalogue as { en: unknown }).en
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

class UiStub extends Service {
  public views = new Map<string, any>()
  public contributions: any[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: any) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  contribute(contribution: any) {
    this.contributions.push(contribution)
    return () => {}
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class DspStub extends Service implements DspService {
  public chain: readonly ChainEntry[] = [
    { effectId: 'preamp', enabled: false, ordinal: 10 },
    { effectId: 'eq10', enabled: true, ordinal: 20 },
    { effectId: 'limiter', enabled: true, ordinal: 90 },
  ]
  public definitions: any[] = [
    {
      id: 'preamp',
      displayName: 'Preamp',
      defaultOrder: 10,
    },
    {
      id: 'eq10',
      displayName: 'Equalizer',
      defaultOrder: 20,
      presets: [{ name: 'Flat', params: { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }],
    },
    {
      id: 'limiter',
      displayName: 'Peak Limiter',
      defaultOrder: 90,
    },
  ]
  public latencyMs = 0

  constructor(ctx: Context) {
    super(ctx, 'dsp')
  }

  register() {
    return () => {}
  }
  async setEnabled(id: string, on: boolean) {
    this.chain = this.chain.map((c) => (c.effectId === id ? { ...c, enabled: on } : c))
  }
  async setOrder(id: string, ordinal: number) {
    this.chain = this.chain.map((c) => (c.effectId === id ? { ...c, ordinal } : c))
  }
  async setParam() {}
  async applyPreset() {}
  getParams(id: string) {
    if (id === 'eq10') return { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
    if (id === 'preamp') return { gainDb: 0 }
    if (id === 'limiter') return { ceilingDb: -0.5 }
    return {}
  }
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(DspStub)
  await ctx.plugin(I18nStub)
  await ctx.plugin(pluginDspUi)
  return { ctx }
}

describe('plugin-dsp-ui-desktop', () => {
  it('registers views with ui service upon load', async () => {
    const { ctx } = await createHarness()
    expect((ctx.ui as any).viewFor('dsp.view')).toBeDefined()
    expect((ctx.ui as any).viewFor('settings.dsp')).toBeDefined()
    expect((ctx.ui as any).viewFor('settings.loudness-normalization')).toBeDefined()
  })

  it('renders LoudnessNormalizationCard with normalization toggle', async () => {
    const { ctx } = await createHarness()
    const Card = (ctx.ui as any).viewFor('settings.loudness-normalization')
    expect(Card).toBeDefined()
    const html = renderToStaticMarkup(h(Card, {}))
    expect(html).toContain('Loudness normalization between tracks')
    expect(html).toContain('Enable loudness normalization')
  })

  it('renders DspScreen with EQ sliders and titles', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(DspScreen, { ctx }))

    expect(html).toContain('Audio effects &amp; equalizer (DSP)')
    expect(html).toContain('10-Band equalizer (EQ)')
    expect(html).toContain('Effect chain (Effect Chain)')
    expect(html).toContain('Processing latency: 0 ms')
    expect(html).toContain('Equalizer')
    expect(html).toContain('Presets')
    expect(html).toContain('Reset')
    expect(html).toContain('Save preset')
    expect(html).toContain('31Hz')
    expect(html).toContain('16KHz')
    expect(html).toContain('+12dB')
    expect(html).toContain('-12dB')
    expect(html).toContain('Enabled')
  })
})
