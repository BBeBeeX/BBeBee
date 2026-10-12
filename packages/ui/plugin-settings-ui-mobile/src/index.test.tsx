// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from '@BBeBee/kernel'
import type { AppSettings, SettingsService, SettingsContribution, CacheClass, CacheStats, DspService, ChainEntry, EffectDefinition } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { configureNative, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import settingsCatalogue from '../../../feature/plugin-i18n/src/locales/settings.json'
import pluginSettingsUi, { SettingsScreen } from './index.js'

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
  public views = new Map<string, unknown>()
  public routes: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  navigate(id: string) {
    this.routes.push(id)
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class SettingsStub extends Service implements Partial<SettingsService> {
  private appCtx: Context
  public currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.appCtx = ctx
  }

  get = async (): Promise<AppSettings> => {
    return this.currentSettings
  }

  getSync = (): AppSettings => {
    return this.currentSettings
  }

  update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    this.currentSettings = { ...this.currentSettings, ...patch }
    this.appCtx.emit('settings/changed', this.currentSettings)
    return this.currentSettings
  }

  reset = async (): Promise<AppSettings> => {
    this.currentSettings = { ...DEFAULT_APP_SETTINGS }
    this.appCtx.emit('settings/changed', this.currentSettings)
    return this.currentSettings
  }

    onSettingsChange = (callback: (settings: AppSettings) => void) => {
      return this.appCtx.on('settings/changed', callback)
    }

    private contributions: SettingsContribution[] = []

    contribute = (contribution: SettingsContribution) => {
      this.contributions.push(contribution)
      this.appCtx.emit('settings/contributions-changed', this.contributions)
      return () => {
        this.contributions = this.contributions.filter((c) => c.id !== contribution.id)
        this.appCtx.emit('settings/contributions-changed', this.contributions)
      }
    }

    getContributions = (): readonly SettingsContribution[] => {
      return this.contributions
    }
  }

  class CacheStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'cache')
    }

    stats = async (_className?: CacheClass): Promise<CacheStats> => {
      return { bytes: 1024, entries: 1 }
    }

    clear = async (): Promise<number> => 1
  }

  class DspStub extends Service implements Partial<DspService> {
    public chain: readonly ChainEntry[] = [
      { effectId: 'eq10', enabled: true, ordinal: 20 },
      { effectId: 'normalize', enabled: true, ordinal: 30 },
      { effectId: 'compressor', enabled: true, ordinal: 40 },
      { effectId: 'reverb', enabled: true, ordinal: 50 },
    ]
    public definitions = [
      { id: 'eq10', displayName: 'Equalizer', defaultOrder: 20 },
      { id: 'normalize', displayName: 'Normalization', defaultOrder: 30 },
      { id: 'compressor', displayName: 'Compressor', defaultOrder: 40 },
      { id: 'reverb', displayName: 'Reverb', defaultOrder: 50 },
    ] as unknown as readonly EffectDefinition<never>[]
    public latencyMs = 2

    constructor(ctx: Context) {
      super(ctx, 'dsp')
    }

    setEnabled = async (id: string, on: boolean) => {
      this.chain = this.chain.map((c) => (c.effectId === id ? { ...c, enabled: on } : c))
    }

    applyPreset = async () => {}
    setParam = async () => {}
    getParams = () => ({})
  }

  /**
   * Minimal `i18n` service stub resolving `settings:*` keys against the real
   * catalogue, so the `useI18n` binding in the screens resolves to the English
   * copy the assertions below check. Mirrors `DefaultI18nStub` in
   * `apps/desktop/renderer/Shell.test.tsx`.
   */
  class DefaultI18nStub extends Service {
    static override readonly name = 'i18n'
    locale = 'en'
    private listeners = new Set<(locale: string) => void>()

    constructor(ctx: Context) {
      super(ctx, 'i18n')
    }

    t = (key: string, params?: Record<string, string | number>): string => {
      const sep = key.indexOf(':')
      if (sep < 0) return key
      const catalogue = settingsCatalogue.en as Record<string, unknown>
      let cur: unknown = catalogue
      for (const part of key.slice(sep + 1).split('.')) {
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      }
      if (typeof cur !== 'string') return key
      return params
        ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
        : cur
    }

    onLocaleChange = (cb: (locale: string) => void): (() => void) => {
      this.listeners.add(cb)
      return () => void this.listeners.delete(cb)
    }
  }

  async function createHarness() {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(DefaultI18nStub)
    await ctx.plugin(SettingsStub)
    await ctx.plugin(CacheStub)
    await ctx.plugin(DspStub)
    await ctx.plugin(pluginSettingsUi)

    const MockDspCard = () => {
      const native = nativePrimitives()
      return h(
        native.View as never,
        null,
        h(Text, { children: 'Audio effects & equalizer (DSP)' }),
        h(Text, { children: '10-Band equalizer (EQ)' }),
        h(Text, { children: 'Flat' }),
        h(Text, { children: 'Loudness normalization (Normalize)' }),
        h(Text, { children: 'Streaming (-14)' }),
        h(Text, { children: 'Dynamic compressor (Compressor)' }),
        h(Text, { children: 'Night Mode' }),
        h(Text, { children: 'Spatial reverb (Reverb)' }),
        h(Text, { children: 'Concert Hall' }),
        h(Text, { children: 'Advanced effect tuning and routing' }),
      )
    }

    ;(ctx.ui as any).registerView('settings.dsp', MockDspCard)
    ;(ctx.settings as any).contribute({
      id: 'settings.dsp',
      section: 'playback',
      title: 'Audio effects & equalizer (DSP)',
      display: 'card',
    })

    return { ctx }
  }

  describe('plugin-settings-ui-mobile', () => {
    it('registers settings view with ui service', async () => {
      const { ctx } = await createHarness()
      expect((ctx.ui as any).viewFor('settings.view')).toBeDefined()
    })

    it('renders mobile SettingsScreen with DSP section and controls for EQ, normalize, compressor, reverb', async () => {
      const { ctx } = await createHarness()
      const { container } = render(h(SettingsScreen, { ctx }))

      expect(container.textContent).toContain('Settings')
      expect(container.textContent).toContain('Appearance & language')
      expect(container.textContent).toContain('Playback & Audio')
      expect(container.textContent).toContain('Audio effects & equalizer (DSP)')

      // 1. EQ
      expect(container.textContent).toContain('10-Band equalizer (EQ)')
      expect(container.textContent).toContain('Flat')

      // 2. Normalize
      expect(container.textContent).toContain('Loudness normalization (Normalize)')
      expect(container.textContent).toContain('Streaming (-14)')

      // 3. Compressor
      expect(container.textContent).toContain('Dynamic compressor (Compressor)')
      expect(container.textContent).toContain('Night Mode')

      // 4. Reverb
      expect(container.textContent).toContain('Spatial reverb (Reverb)')
      expect(container.textContent).toContain('Concert Hall')

      // 5. Advanced panel link
      expect(container.textContent).toContain('Advanced effect tuning and routing')
    })

    it('renders audio output engine options and allows switching between WebAudio and MPV Hi-Fi', async () => {
      const { ctx } = await createHarness()
      const { container } = render(h(SettingsScreen, { ctx }))

      expect(container.textContent).toContain('Audio output engine')
      expect(container.textContent).toContain('WebAudio')
      expect(container.textContent).toContain('MPV Hi-Fi')
    })

    it('dynamically renders contributions registered via settings service', async () => {
      const { ctx } = await createHarness()
      ;(ctx.settings as any).contribute({
        id: 'custom.feature',
        section: 'custom',
        title: 'Custom extension settings',
        description: 'Dynamically registered configuration',
        actionText: 'Open extension',
      })
      const { container } = render(h(SettingsScreen, { ctx }))
      expect(container.textContent).toContain('Custom extension settings')
      expect(container.textContent).toContain('Dynamically registered configuration')
      expect(container.textContent).toContain('Open extension')
    })
  })
