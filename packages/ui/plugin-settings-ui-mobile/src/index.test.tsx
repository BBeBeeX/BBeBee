// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
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
  ScrollView: hostComponent('ScrollView'),
})

class UiStub extends Service {
  public views = new Map<string, unknown>()
  public routes: string[] = []
  public lastNavigateParams?: Record<string, unknown>

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  contribute(contribution: { id: string }) {
    this.routes.push(contribution.id)
    return () => {
      this.routes = this.routes.filter((id) => id !== contribution.id)
    }
  }

  navigate(id: string, params?: Record<string, unknown>) {
    this.routes.push(id)
    this.lastNavigateParams = params
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
    it('registers the settings home and one view per category sub-page', async () => {
      const { ctx } = await createHarness()
      expect((ctx.ui as any).viewFor('settings.view')).toBeDefined()
      for (const id of ['settings.appearance', 'settings.playback', 'settings.sources', 'settings.storage', 'settings.about', 'debug.view']) {
        expect((ctx.ui as any).viewFor(id)).toBeDefined()
      }
      // The sub-routes are contributed (placement-less): programmatic
      // navigation only — never desktop sidebar/tray, never the drawer.
      expect((ctx.ui as any).routes).toEqual(
        expect.arrayContaining(['settings.appearance', 'settings.playback', 'settings.storage', 'settings.about']),
      )
    })

    it('renders the settings home as a directory of category rows', async () => {
      const { ctx } = await createHarness()
      const { container } = render(h(SettingsScreen, { ctx }))

      expect(container.textContent).toContain('Appearance & language')
      expect(container.textContent).toContain('Playback & audio')
      expect(container.textContent).toContain('Music sources')
      expect(container.textContent).toContain('Storage & cache')
      expect(container.textContent).toContain('About')
      // Category content moved to the sub-pages: the home carries none of it.
      expect(container.textContent).not.toContain('Audio output engine')
      expect(container.textContent).not.toContain('10-Band equalizer (EQ)')
      expect(container.textContent).not.toContain('Audio effects & equalizer (DSP)')
    })

    it('renders the playback sub-page with engine row and DSP contributions', async () => {
      const { ctx } = await createHarness()
      const PlaybackPage = (ctx.ui as any).viewFor('settings.playback')
      const { container } = render(h(PlaybackPage, {}))

      expect(container.textContent).toContain('Audio output engine')
      expect(container.textContent).toContain('MPV Hi-Fi')
      expect(container.textContent).not.toContain('WebAudio')

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

    it('omits a card contribution with no view on this target from the home list', async () => {
      const { ctx } = await createHarness()
      ;(ctx.settings as any).contribute({
        id: 'desktop.only.card',
        section: 'desktopOnly',
        title: 'Desktop-only card',
        description: 'Registered everywhere, viewable nowhere on mobile',
        display: 'card',
      })
      const { container } = render(h(SettingsScreen, { ctx }))
      // No placeholder row, and no section header for a section that has
      // nothing usable here.
      expect(container.textContent).not.toContain('Desktop-only card')
      expect(container.textContent).not.toContain('DesktopOnly')
    })

    it('renders the same card once a view is registered for it', async () => {
      const { ctx } = await createHarness()
      ;(ctx.ui as any).registerView(
        'desktop.only.card',
        () => h('div', null, 'desktop only card body'),
      )
      ;(ctx.settings as any).contribute({
        id: 'desktop.only.card',
        section: 'desktopOnly',
        title: 'Desktop-only card',
        display: 'card',
      })
      const { container } = render(h(SettingsScreen, { ctx }))
      expect(container.textContent).toContain('desktop only card body')
    })

    it('renders the About sub-page with the desktop twin’s sections and rows', async () => {
      const { ctx } = await createHarness()
      const AboutPage = (ctx.ui as any).viewFor('settings.about')
      const { container, getByTestId } = render(h(AboutPage, {}))

      // Brand badge: name and tagline with the version baked in.
      expect(container.textContent).toContain('BBeBee')
      expect(container.textContent).toContain('Cross-platform plugin-based music player · Version 0.1.0')
      // The onboarding guide row, the architecture/sandbox/license rows.
      expect(container.textContent).toContain('Onboarding & Quick Start Guide')
      expect(container.textContent).toContain('Microkernel architecture')
      expect(container.textContent).toContain('Secure sandbox')
      expect(container.textContent).toContain('Open-source license')
      // Danger zone exists only behind the advanced-settings toggle.
      expect(container.textContent).not.toContain('Danger zone')

      // The guide row navigates to the recommend page with the guide flag.
      await act(async () => {
        getByTestId('about-open-guide').click()
      })
      expect((ctx.ui as any).routes).toContain('sources.recommend')
      expect((ctx.ui as any).lastNavigateParams).toEqual({ showGuide: true })
    })

    it('gates the developer diagnostics and danger zone behind advanced settings', async () => {
      const { ctx } = await createHarness()
      const AboutPage = (ctx.ui as any).viewFor('settings.about')
      const { container, getByTestId } = render(h(AboutPage, {}))

      expect(container.textContent).not.toContain('Developer & system diagnostics')
      expect(container.textContent).not.toContain('Reset all settings')

      // Flipping the advanced toggle reveals both sections.
      await act(async () => {
        getByTestId('about-advanced-toggle').click()
      })
      expect(container.textContent).toContain('Developer & system diagnostics')
      expect(container.textContent).toContain('Danger zone')
      expect(container.textContent).toContain('Reset all settings')

      // The reset flow: restore-defaults → confirm, and the settings
      // service's reset actually runs (the danger zone stays while advanced
      // settings is on — same as the desktop twin).
      await act(async () => {
        getByTestId('about-restore-defaults').click()
      })
      expect(container.textContent).toContain('Confirm reset')
      await act(async () => {
        getByTestId('about-confirm-reset').click()
      })
      expect(container.textContent).toContain('Restore defaults')
      expect(container.textContent).not.toContain('Confirm reset')
    })

    it('renders the debug screen with tools gated by view availability', async () => {
      const { ctx } = await createHarness()
      // The two tool cards whose views belong to other packages: on the
      // device those packages are loaded, so stub them here.
      ;(ctx.ui as any).registerView('sources.test', () => h('div', null))
      ;(ctx.ui as any).registerView('plugin-manager.screen', () => h('div', null))
      const DebugPage = (ctx.ui as any).viewFor('debug.view')
      const { container, getByTestId } = render(h(DebugPage, {}))

      expect(container.textContent).toContain('Current debug status')
      expect(container.textContent).toContain('Current runtime environment')
      expect(container.textContent).toContain('RingBuffer (2000 lines)')
      expect(container.textContent).toContain('QuickJS Realm Isolation')

      // The tool cards all render; the desktop-only DevTools card is the one
      // surface without a mobile view, and it says so instead of navigating
      // into the shell's dead end.
      expect(container.textContent).toContain('System logs (Discover)')
      expect(container.textContent).toContain('Test sources (Test Sources)')
      expect(container.textContent).toContain('Plugins')
      const unavailable = container.textContent!.split('Not available on this platform').length - 1
      expect(unavailable).toBe(1)
      expect(getByTestId('debug-open-sources-test')).toBeTruthy()
      expect(getByTestId('debug-open-plugins')).toBeTruthy()
      expect(getByTestId('debug-open-devtools')).toBeTruthy()
    })

    it('renders the appearance page with a language select and no device-feature cards', async () => {
      const { ctx } = await createHarness()
      // The theme management card has a view here (plugin-theme registers
      // one); the device-feature cards' views belong to their own packages.
      ;(ctx.ui as any).registerView('theme.settings', () => h('div', null, 'theme card body'))
      ;(ctx.settings as any).contribute({
        id: 'theme.settings',
        section: 'general',
        title: 'Theme and color management',
        display: 'card',
        order: 20,
      })
      ;(ctx.settings as any).contribute({ id: 'history.view', section: 'general', title: 'history:history.playHistory', order: 70 })
      ;(ctx.settings as any).contribute({ id: 'car-mode.view', section: 'general', title: 'Car mode', order: 71 })
      ;(ctx.settings as any).contribute({ id: 'audio-converter.view', section: 'general', title: 'Audio format conversion', order: 72 })
      ;(ctx.settings as any).contribute({
        id: 'mobile.layoutMode',
        section: 'general',
        title: 'app:common.app.layoutMode',
        order: 60,
        fields: [{ key: 'mobile.layoutMode', label: 'app:common.app.layoutMode', type: 'select', options: [] }],
      })

      const AppearancePage = (ctx.ui as any).viewFor('settings.appearance')
      const { container, getByTestId } = render(h(AppearancePage, {}))

      // 界面语言 is a dropdown select, not the three-button row.
      expect(getByTestId('language-select')).toBeTruthy()
      expect(container.textContent).toContain('Choose the display language')

      // The theme card renders; the device-feature cards — reachable from
      // the drawer — are gone from the appearance page.
      expect(container.textContent).toContain('theme card body')
      expect(container.textContent).not.toContain('Play history')
      expect(container.textContent).not.toContain('Car mode')
      expect(container.textContent).not.toContain('Audio format conversion')

      // The layout-mode card is a wide-window (tablet / unfolded foldable)
      // surface: on a phone-width window it does not render at all.
      expect(container.textContent).not.toContain('app:common.app.layoutMode')
    })

    it('reports the i18n service locale as the interface language', async () => {
      const { ctx } = await createHarness()
      const DebugPage = (ctx.ui as any).viewFor('debug.view')
      const { container } = render(h(DebugPage, {}))

      // The device's OS locale is not the app's UI language: the i18n
      // service's locale is what the 界面语言 row reports (label and value
      // are adjacent in the rendered text).
      expect(container.textContent).toContain('Interface languageen')
    })
  })
