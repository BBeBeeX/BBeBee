// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from '@BBeBee/kernel'
import type { AppSettings, SettingsService, SettingsContribution, CacheClass, CacheStats, DspService, ChainEntry, EffectDefinition } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { configureNative, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import settingsCatalogue from '../../../feature/plugin-i18n/src/locales/settings.json'
import localScannerCatalogue from '../../../feature/plugin-i18n/src/locales/localScanner.json'
import sourcesCatalogue from '../../../feature/plugin-i18n/src/locales/sources.json'
import enCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'
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
        onClick: typeof onPress === 'function' ? (e: any) => {
          e?.stopPropagation?.()
          ;(onPress as () => void)()
        } : undefined,
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
      const ns = key.slice(0, sep)
      const catalogues: Record<string, any> = {
        settings: settingsCatalogue.en,
        localScanner: localScannerCatalogue.en,
        sources: sourcesCatalogue.en,
        app: enCatalogue,
      }
      let cur: unknown = catalogues[ns]
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

  let calls: string[] = []

  class SourcesStub extends Service {
    static override readonly name = 'sources'
    public sources: any[] = [
      {
        id: 'local',
        name: 'Local files',
        sourceUrl: 'local://',
        type: 'local',
        enabled: true,
      },
      {
        id: 'mock-bili',
        name: 'Bilibili Music',
        sourceUrl: 'https://bilibili.com',
        type: 'music',
        enabled: true,
      },
    ]

    constructor(ctx: Context) {
      super(ctx, 'sources')
    }

    setEnabled = async (id: string, enabled: boolean) => {
      calls.push(`sources:setEnabled:${id}:${enabled}`)
      const s = this.sources.find((item) => item.id === id)
      if (s) {
        s.enabled = enabled
        this.ctx.emit('source/changed', id, ['enabled'])
      }
    }

    remove = async (id: string) => {
      calls.push(`sources:remove:${id}`)
      this.sources = this.sources.filter((item) => item.id !== id)
      this.ctx.emit('source/removed', id, true)
    }

    testConnection = async (id: string) => {
      calls.push(`sources:testConnection:${id}`)
      return { status: 'ok' as const, latencyMs: 35 }
    }
  }

  class ScannerStub extends Service {
    static override readonly name = 'scanner'
    public specifiedDirs = [
      { id: 'dir-1', uri: '/music/pop', enabled: true, recursive: true },
      { id: 'dir-2', uri: '/music/rock', enabled: false, recursive: true, lastError: 'Permission denied' },
    ]

    constructor(ctx: Context) {
      super(ctx, 'scanner')
    }

    addSpecifiedDir = async (uri: string) => {
      calls.push(`scanner:addSpecifiedDir:${uri}`)
      const dir = { id: `dir-${Date.now()}`, uri, enabled: true, recursive: true }
      this.specifiedDirs.push(dir)
      this.ctx.emit('scan/specified-dirs-changed', this.specifiedDirs)
      return dir
    }

    removeSpecifiedDir = async (id: string) => {
      calls.push(`scanner:removeSpecifiedDir:${id}`)
      this.specifiedDirs = this.specifiedDirs.filter((d) => d.id !== id)
      this.ctx.emit('scan/specified-dirs-changed', this.specifiedDirs)
    }

    setEnabled = async (id: string, enabled: boolean) => {
      calls.push(`scanner:setEnabled:${id}:${enabled}`)
      const d = this.specifiedDirs.find((dir) => dir.id === id)
      if (d) d.enabled = enabled
      this.ctx.emit('scan/specified-dirs-changed', this.specifiedDirs)
    }

    scan = async (opts?: { specifiedDirId?: string }) => {
      calls.push(`scanner:scan:${opts?.specifiedDirId ?? 'all'}`)
      this.ctx.emit('scan/started', opts?.specifiedDirId ?? 'all')
      this.ctx.emit('scan/progress', opts?.specifiedDirId ?? 'dir-1', 42, 100)
      this.ctx.emit('scan/finished', opts?.specifiedDirId ?? 'all', { added: 1, updated: 0, removed: 0, errors: 0 })
    }

    cancel = () => {
      calls.push('scanner:cancel')
      this.ctx.emit('scan/finished', 'all', { added: 0, updated: 0, removed: 0, errors: 0, incomplete: true, cancelled: true })
    }
  }

  class FsStub extends Service {
    static override readonly name = 'fs'
    constructor(ctx: Context) {
      super(ctx, 'fs')
    }
    pickDirectory = async () => {
      calls.push('fs:pickDirectory')
      return '/music/jazz'
    }
  }

  async function createHarness() {
    calls = []
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(DefaultI18nStub)
    await ctx.plugin(SettingsStub)
    await ctx.plugin(CacheStub)
    await ctx.plugin(DspStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(ScannerStub)
    await ctx.plugin(FsStub)
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

    return { ctx, calls }
  }

  describe('plugin-settings-ui-mobile', () => {
    it('registers the settings home and one view per category sub-page', async () => {
      const { ctx } = await createHarness()
      expect((ctx.ui as any).viewFor('settings.view')).toBeDefined()
      for (const id of ['settings.appearance', 'settings.playback', 'settings.network', 'settings.sources', 'settings.storage', 'settings.about', 'debug.view']) {
        expect((ctx.ui as any).viewFor(id)).toBeDefined()
      }
      // The sub-routes are contributed (placement-less): programmatic
      // navigation only — never desktop sidebar/tray, never the drawer.
      expect((ctx.ui as any).routes).toEqual(
        expect.arrayContaining(['settings.appearance', 'settings.playback', 'settings.network', 'settings.storage', 'settings.about']),
      )
    })

    it('renders the settings home as a directory of category rows', async () => {
      const { ctx } = await createHarness()
      const { container } = render(h(SettingsScreen, { ctx }))

      expect(container.textContent).toContain('Appearance & language')
      expect(container.textContent).toContain('Playback & audio')
      expect(container.textContent).toContain('Network & proxy')
      expect(container.textContent).toContain('Music sources')
      expect(container.textContent).toContain('Storage & cache')
      expect(container.textContent).toContain('About')
      // Category content moved to the sub-pages: the home carries none of it.
      expect(container.textContent).not.toContain('Audio output engine')
      expect(container.textContent).not.toContain('10-Band equalizer (EQ)')
      expect(container.textContent).not.toContain('Audio effects & equalizer (DSP)')
    })

    it('renders the network sub-page with proxy and third-party settings', async () => {
      const { ctx } = await createHarness()
      const NetworkPage = (ctx.ui as any).viewFor('settings.network')
      const { container } = render(h(NetworkPage, {}))

      expect(container.textContent).toContain('Third-party service settings')
      expect(container.textContent).toContain('Network proxy settings')
      expect(container.textContent).toContain('Download & GitHub acceleration')
    })

    it('renders the sources sub-page with configured sources card', async () => {
      const { ctx } = await createHarness()
      const SourcesPage = (ctx.ui as any).viewFor('settings.sources')
      const { container } = render(h(SourcesPage, {}))

      expect(container.textContent).toContain('Music sources & files')
      expect(container.textContent).toContain('Configured sources')
    })

    it('supports local source folder management, scan, and directory picking on mobile', async () => {
      const { ctx, calls } = await createHarness()
      const SourcesPage = (ctx.ui as any).viewFor('settings.sources')
      const { getByTestId, queryByTestId, container } = render(h(SourcesPage, {}))

      // 1. Configured sources: local source item exists
      expect(getByTestId('settings-source-item-local')).toBeTruthy()
      expect(getByTestId('settings-source-dot-local')).toBeTruthy()
      expect(getByTestId('settings-source-add-folder-local')).toBeTruthy()
      expect(getByTestId('settings-source-scan-local')).toBeTruthy()

      // 2. Scan all local folders
      await act(async () => {
        getByTestId('settings-source-scan-local').click()
      })
      expect(calls.includes('scanner:scan:all')).toBe(true)

      // 3. Folders sheet collapsed by default
      expect(queryByTestId('source-local-folders-sheet')).toBeNull()

      // 4. Clicking local source item expands local folders sheet
      await act(async () => {
        getByTestId('settings-source-item-local').click()
      })
      expect(getByTestId('source-local-folders-sheet')).toBeTruthy()
      expect(getByTestId('local-folder-row-dir-1')).toBeTruthy()
      expect(getByTestId('local-folder-row-dir-2')).toBeTruthy()
      expect(container.textContent).toContain('/music/pop')
      expect(container.textContent).toContain('/music/rock')
      expect(container.textContent).toContain('Permission denied')

      // 5. Toggle folder
      await act(async () => {
        getByTestId('local-folder-toggle-dir-1').click()
      })
      expect(calls.includes('scanner:setEnabled:dir-1:false')).toBe(true)

      // 6. Scan single folder
      await act(async () => {
        getByTestId('local-folder-scan-dir-1').click()
      })
      expect(calls.includes('scanner:scan:dir-1')).toBe(true)

      // 7. Delete folder flow with confirmation
      await act(async () => {
        getByTestId('local-folder-delete-dir-1').click()
      })
      expect(getByTestId('local-folder-delete-confirm-dir-1')).toBeTruthy()
      await act(async () => {
        getByTestId('local-folder-delete-confirm-dir-1').click()
      })
      expect(calls.includes('scanner:removeSpecifiedDir:dir-1')).toBe(true)

      // 8. Add folder via pickDirectory
      await act(async () => {
        getByTestId('settings-source-add-folder-local').click()
      })
      expect(calls.includes('fs:pickDirectory')).toBe(true)
      expect(calls.includes('scanner:addSpecifiedDir:/music/jazz')).toBe(true)
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

    it('renders the storage sub-page with download settings and storage contributions', async () => {
      const { ctx } = await createHarness()
      ;(ctx.settings as any).contribute({
        id: 'audio-converter.view',
        section: 'storage',
        title: 'Audio Converter',
        description: 'Convert audio formats and compress files',
        actionText: 'Open',
      })
      const StoragePage = (ctx.ui as any).viewFor('settings.storage')
      const { container } = render(h(StoragePage, {}))

      expect(container.textContent).toContain('Storage & cache')
      expect(container.textContent).toContain('Download format')
      expect(container.textContent).toContain('Download on Wi-Fi only')
      expect(container.textContent).toContain('Cache usage')
      expect(container.textContent).toContain('Clear cache')
      expect(container.textContent).toContain('Audio Converter')
      expect(container.textContent).toContain('Convert audio formats and compress files')
      expect(container.textContent).toContain('Open')
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

      // The tool cards all render with active views.
      expect(container.textContent).toContain('System logs (Discover)')
      expect(container.textContent).toContain('Test sources (Test Sources)')
      expect(container.textContent).toContain('Plugins')
      expect(getByTestId('debug-open-sources-test')).toBeTruthy()
      expect(getByTestId('debug-open-plugins')).toBeTruthy()
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
