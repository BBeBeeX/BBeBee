// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from '@BBeBee/kernel'
import type { ChainEntry, DspService } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
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

describe('plugin-dsp-ui-mobile', () => {
  it('registers views with ui service upon load', async () => {
    const { ctx } = await createHarness()
    expect((ctx.ui as any).viewFor('dsp.view')).toBeDefined()
    expect((ctx.ui as any).viewFor('settings.dsp')).toBeDefined()
    expect((ctx.ui as any).viewFor('settings.loudness-normalization')).toBeDefined()
  })

  it('renders mobile LoudnessNormalizationCard', async () => {
    const { ctx } = await createHarness()
    const Card = (ctx.ui as any).viewFor('settings.loudness-normalization')
    expect(Card).toBeDefined()
    const { container } = render(h(Card, {}))
    expect(container.textContent).toContain('Loudness normalization between tracks')
    expect(container.textContent).toContain('Enable loudness normalization')
  })

  it('renders mobile DspScreen with controls', async () => {
    const { ctx } = await createHarness()
    const { container } = render(h(DspScreen, { ctx }))

    expect(container.textContent).toContain('Audio effects & equalizer (DSP)')
    expect(container.textContent).toContain('10-Band EQ')
    expect(container.textContent).toContain('Enable equalizer')
  })
})
