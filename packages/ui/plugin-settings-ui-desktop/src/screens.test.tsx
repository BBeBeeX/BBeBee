// @vitest-environment jsdom
/**
 * Desktop Settings Screen component tests.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor, act } from '@testing-library/react'
import { Context, Service } from 'cordis'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import type { AppSettings, SettingsService, SettingsContribution, CacheClass, CacheStats, ThemeDefinition, NowPlayingStyleMeta, LyricSourceDefinition, SourceRecord, PluginInfo, PluginManagerService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS, NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { apply as applyI18n } from '@BBeBee/plugin-i18n'
import { midnightPurpleTheme, spotifyTheme } from '@BBeBee/ui-tokens'
import { SettingsScreen } from './SettingsScreen.js'
import { ShortcutsCard } from './components/ShortcutsCard.js'
import { DebugScreen } from './DebugScreen.js'
import { LogsScreen } from './LogsScreen.js'
import { HttpLogsScreen } from './HttpLogsScreen.js'
import { ThemePaletteScreen } from './ThemePaletteScreen.js'
import { LyricSourcesSection } from './components/sections/LyricSourcesSection.js'

afterEach(() => {
  cleanup()
})

async function harness(initialSettings: Partial<AppSettings> = {}) {
  // English by default: the suite asserts the en strings; language-specific
  // behaviour (the live zh↔en switch) is covered explicitly below.
  // English by default: the suite asserts the en strings; the live zh<->en
  // switch is covered explicitly in the pilot test below.
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, language: 'en', ...initialSettings }
  const calls: string[] = []

  class LogBufferStub extends Service {
    public entries = [
      {
        sn: 1,
        time: Date.now() - 5000,
        level: 'info' as const,
        scope: 'kernel',
        message: 'kernel: cordis booted successfully',
      },
      {
        sn: 2,
        time: Date.now() - 3000,
        level: 'info' as const,
        scope: 'http',
        message: '[HTTP] GET https://api.example.com/search?q=test -> 200 (45ms)',
      },
      {
        sn: 3,
        time: Date.now() - 1000,
        level: 'error' as const,
        scope: 'source-runtime',
        message: 'source-runtime: custom source request failed with 500',
      },
    ]

    constructor(ctx: Context) {
      super(ctx, 'logBuffer')
    }

    get all() {
      return this.entries
    }

    clear = () => {
      calls.push('clearLogBuffer')
      this.entries = []
    }

    toNdjson = () => {
      calls.push('toNdjson')
      return this.entries.map((e) => JSON.stringify(e)).join('\n')
    }
  }

  class DeviceStub extends Service {
  static override readonly name = 'device'
  constructor(ctx: Context) {
    super(ctx, 'device')
  }
  get locale(): string {
    return 'en'
  }
}

class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context

    constructor(ctx: Context) {
      super(ctx, 'settings')
      this.appCtx = ctx
    }

    get = async (): Promise<AppSettings> => {
      calls.push('get')
      return currentSettings
    }

    getSync = (): AppSettings => {
      return currentSettings
    }

    update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      calls.push(`update:${JSON.stringify(patch)}`)
      currentSettings = { ...currentSettings, ...patch }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }

    reset = async (): Promise<AppSettings> => {
      calls.push('reset')
      currentSettings = { ...DEFAULT_APP_SETTINGS }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }

    onSettingsChange = (callback: (settings: AppSettings) => void) => {
      return this.appCtx.on('settings/changed', callback)
    }

    private contributions: SettingsContribution[] = []

    contribute = (c: SettingsContribution) => {
      this.contributions.push(c)
      this.appCtx.emit('settings/contributions-changed', this.contributions)
      return () => {
        this.contributions = this.contributions.filter((item) => item.id !== c.id)
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
      return {
        bytes: 5242880,
        entries: 10,
      }
    }

    clear = async (_className?: CacheClass): Promise<number> => {
      calls.push('clearCache')
      return 10
    }
  }

  class UiStub extends Service {
    public views = new Map<string, unknown>()
    public settings: SettingsContribution[] = []
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }

    navigate = (id: string) => {
      calls.push(`navigate:${id}`)
    }

    viewFor = (id: string) => {
      return this.views.get(id)
    }

    registerView = (id: string, component: unknown) => {
      this.views.set(id, component)
      return () => {
        this.views.delete(id)
      }
    }
  }

  class DspStub extends Service {
    public chain = [
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
    ]
    public latencyMs = 2

    constructor(ctx: Context) {
      super(ctx, 'dsp')
    }

    setEnabled = async (id: string, on: boolean) => {
      calls.push(`dsp:setEnabled:${id}:${on}`)
    }

    applyPreset = async (id: string, name: string) => {
      calls.push(`dsp:applyPreset:${id}:${name}`)
    }

    setParam = async (id: string, name: string, value: unknown) => {
      calls.push(`dsp:setParam:${id}:${name}:${value}`)
    }

    getParams = () => ({})
  }

  class ThemeStub extends Service {
    public themes: ThemeDefinition[] = [midnightPurpleTheme, spotifyTheme]
    public currentTheme: ThemeDefinition = this.themes[0]!
    private appCtx: Context

    constructor(ctx: Context) {
      super(ctx, 'theme')
      this.appCtx = ctx
    }

    getThemes = () => this.themes
    getCurrentTheme = () => this.currentTheme
    setTheme = async (id: string) => {
      calls.push(`theme:setTheme:${id}`)
      const found = this.themes.find((t) => t.id === id)
      if (found) {
        this.currentTheme = found
        this.appCtx.emit('theme/changed', found)
      }
    }
    registerTheme = (theme: ThemeDefinition) => {
      calls.push(`theme:register:${theme.id}`)
      this.themes.push(theme)
      this.appCtx.emit('theme/registry-changed', this.themes)
      return () => this.removeTheme(theme.id)
    }
    removeTheme = (id: string) => {
      calls.push(`theme:remove:${id}`)
      if (id === 'midnight-purple' || id === 'spotify') return false
      this.themes = this.themes.filter((t) => t.id !== id)
      if (this.currentTheme.id === id) {
        this.currentTheme = this.themes[0]!
      }
      this.appCtx.emit('theme/registry-changed', this.themes)
      return true
    }
  }

  class NowPlayingStub extends Service {
    public styles: NowPlayingStyleMeta[] = [...NOW_PLAYING_STYLES]
    public currentStyle: string = currentSettings.nowPlayingStyle || 'classic'
    private appCtx: Context

    constructor(ctx: Context) {
      super(ctx, 'nowPlaying')
      this.appCtx = ctx
    }

    getStyle = () => this.currentStyle
    getStyles = () => this.styles
    setStyle = (id: string) => {
      calls.push(`nowPlaying:setStyle:${id}`)
      this.currentStyle = id
      this.appCtx.emit('now-playing/style-changed', id)
    }
    registerStyle = (meta: NowPlayingStyleMeta) => {
      calls.push(`nowPlaying:register:${meta.id}`)
      this.styles.push(meta)
      this.appCtx.emit('now-playing/registry-changed', this.styles)
      return () => this.removeStyle(meta.id)
    }
    removeStyle = (id: string) => {
      calls.push(`nowPlaying:remove:${id}`)
      this.styles = this.styles.filter((s) => s.id !== id)
      this.appCtx.emit('now-playing/registry-changed', this.styles)
      return true
    }
  }

  class SourcesStub extends Service {
    static override readonly name = 'sources'
    public sources: SourceRecord[] = [
      {
        id: 'mock-bili',
        name: 'Bilibili Music',
        sourceUrl: 'https://bilibili.com',
        type: 'music',
        doc: {} as any,
        docJson: '{}',
        docHash: 'hash',
        enabled: true,
        sortOrder: 0,
        allowedHosts: [],
        locallyModified: false,
        importedAt: 0,
        updatedAt: 0,
        failCount: 0,
        needsLyricSource: false,
      },
    ]

    constructor(ctx: Context) {
      super(ctx, 'sources')
    }

    setNeedsLyricSource = async (id: string, needed: boolean) => {
      calls.push(`sources:setNeedsLyricSource:${id}:${needed}`)
      const s = this.sources.find((item) => item.id === id)
      if (s) {
        ;(s as any).needsLyricSource = needed
        this.ctx.emit('source/changed', id, ['needsLyricSource'])
      }
    }
  }

  class LyricSourcesStub extends Service {
    static override readonly name = 'lyricSources'
    public lyricSources: LyricSourceDefinition[] = [
      {
        id: 'builtin-lrclib',
        name: 'LRCLIB (default lyric source)',
        enabled: true,
        sortOrder: 0,
        script: 'async function searchLyrics() {}',
      },
    ]

    constructor(ctx: Context) {
      super(ctx, 'lyricSources')
    }

    getSources = () => this.lyricSources
    registerSource = async (def: LyricSourceDefinition) => {
      calls.push(`lyricSources:register:${def.id}`)
      this.lyricSources.push(def)
      this.ctx.emit('lyric-sources/changed', this.lyricSources)
    }
    removeSource = async (id: string) => {
      calls.push(`lyricSources:remove:${id}`)
      this.lyricSources = this.lyricSources.filter((s) => s.id !== id)
      this.ctx.emit('lyric-sources/changed', this.lyricSources)
      return true
    }
    setEnabled = async (id: string, enabled: boolean) => {
      calls.push(`lyricSources:setEnabled:${id}:${enabled}`)
      const found = this.lyricSources.find((s) => s.id === id)
      if (found) found.enabled = enabled
      this.ctx.emit('lyric-sources/changed', this.lyricSources)
    }
    reorder = async (ids: string[]) => {
      calls.push(`lyricSources:reorder:${ids.join(',')}`)
    }
    testSource = async (id: string) => {
      calls.push(`lyricSources:test:${id}`)
      return { ok: true, durationMs: 42 }
    }
    updateSourceConfig = async (id: string, config: Record<string, unknown>) => {
      calls.push(`lyricSources:updateSourceConfig:${id}`)
      const found = this.lyricSources.find((s) => s.id === id)
      if (found) (found as any).config = config
      this.ctx.emit('lyric-sources/changed', this.lyricSources)
    }
  }

  class PluginManagerStub extends Service implements Partial<PluginManagerService> {
    public plugins: PluginInfo[] = [
      {
        id: '@BBeBee/core-audio',
        name: 'core-audio',
        displayName: 'Audio core',
        description: 'Low-level audio playback driver',
        version: '0.1.0',
        author: 'BBeBee Team',
        systemId: 'layer-2',
        moduleId: 'audio',
        enabled: true,
        state: 'ACTIVE',
        waitingFor: [],
        dependencies: [],
        dependents: ['@BBeBee/plugin-theme'],
        configStatus: 'none',
      },
      {
        id: '@BBeBee/log-console',
        name: 'log-console',
        displayName: 'Console logs',
        description: 'Standard console output channel',
        version: '0.1.0',
        author: 'BBeBee Team',
        systemId: 'layer-3',
        moduleId: 'logs',
        enabled: true,
        state: 'ACTIVE',
        waitingFor: [],
        dependencies: [],
        dependents: [],
        configStatus: 'none',
      },
      {
        id: '@BBeBee/plugin-theme',
        name: 'plugin-theme',
        displayName: 'Theme manager',
        description: 'Theme service and color management',
        version: '0.1.0',
        author: 'BBeBee Team',
        systemId: 'layer-4',
        moduleId: 'theme',
        enabled: true,
        state: 'ACTIVE',
        waitingFor: [],
        dependencies: ['@BBeBee/core-audio'],
        dependents: ['@BBeBee/plugin-settings', '@BBeBee/ui-player'],
        configStatus: 'default',
      },
      {
        id: '@BBeBee/plugin-settings',
        name: 'plugin-settings',
        displayName: 'Settings center',
        description: 'User preferences and settings',
        version: '0.1.0',
        author: 'BBeBee Team',
        systemId: 'layer-4',
        moduleId: 'settings',
        enabled: true,
        state: 'ACTIVE',
        waitingFor: [],
        dependencies: ['@BBeBee/plugin-theme'],
        dependents: [],
        configStatus: 'none',
      },
      {
        id: '@BBeBee/ui-player',
        name: 'ui-player',
        displayName: 'Player UI',
        description: 'Player views and controllers',
        version: '0.1.0',
        author: 'BBeBee Team',
        systemId: 'layer-5',
        moduleId: 'player',
        enabled: true,
        state: 'ACTIVE',
        waitingFor: [],
        dependencies: ['@BBeBee/plugin-theme'],
        dependents: [],
        configStatus: 'none',
      },
    ]

    constructor(ctx: Context) {
      super(ctx, 'plugin-manager')
    }

    list = (): readonly PluginInfo[] => {
      calls.push('pluginManager:list')
      return this.plugins
    }

    setEnabled = async (id: string, enabled: boolean): Promise<void> => {
      calls.push(`pluginManager:setEnabled:${id}:${enabled}`)
      const target = this.plugins.find((p) => p.id === id)
      if (target) {
        target.enabled = enabled
        target.state = enabled ? 'ACTIVE' : 'UNLOADED'
      }
      this.ctx.emit('plugin-manager/enabled-changed', { id, enabled })
    }
  }

  const root = new Context()
  await root.plugin(SettingsStub)
  await root.plugin(DeviceStub)
  // The real i18n service: the pilot components read it through useI18n, so
  // the harness boots the genuine plugin rather than stubbing the interface.
  await applyI18n(root)
/*I18N-DBG*/
  await root.plugin(CacheStub)
  await root.plugin(UiStub)
  await root.plugin(DspStub)
  await root.plugin(LogBufferStub)
  await root.plugin(ThemeStub)
  await root.plugin(NowPlayingStub)
  await root.plugin(SourcesStub)
  await root.plugin(LyricSourcesStub)
  await root.plugin(PluginManagerStub)

  let scoped: Context | undefined
  root.inject(['ui', 'settings', 'dsp', 'plugin-manager'], (s) => void (scoped = s))
  await new Promise((r) => setTimeout(r, 0))
  if (!scoped) throw new Error('Failed to create scoped context in harness')

  const ui = scoped.get('ui') as unknown as UiStub
  const dsp = scoped.get('dsp') as unknown as DspStub
  const settingsSvc = scoped.get('settings') as unknown as SettingsStub

  const MockDspCard = () => {
    return h(
      'section',
      null,
      h('h3', null, 'Audio effects & equalizer (DSP)'),
      h('div', null, '10-Band graphic equalizer (10-Band EQ)'),
      h('div', null, 'Equalizer preset styles'),
      h('button', { onClick: () => void dsp.applyPreset('eq10', 'Flat') }, 'Flat'),
      h('div', null, 'Loudness normalization (Normalization)'),
      h('div', null, 'Normalization target loudness presets'),
      h('button', { onClick: () => void dsp.applyPreset('normalize', 'Streaming (-14 LUFS)') }, 'Streaming (-14)'),
      h('div', null, 'Dynamic range compressor (Compressor)'),
      h('div', null, 'Compression preset styles'),
      h('button', { onClick: () => void dsp.applyPreset('compressor', 'Night Mode') }, '🌙 Night Mode'),
      h('div', null, 'Spatial reverb (Reverb)'),
      h('div', null, 'Reverb space type'),
      h('button', { onClick: () => void dsp.applyPreset('reverb', 'Concert Hall') }, 'Concert Hall'),
      h('button', { onClick: () => ui.navigate('dsp.view') }, 'Open audio effects panel →'),
    )
  }

  ui.registerView('settings.dsp', MockDspCard)
  settingsSvc.contribute({
    id: 'settings.dsp',
    section: 'playback',
    title: 'Audio effects & equalizer (DSP)',
    display: 'card',
  })

  return { ctx: scoped, calls, getCurrentSettings: () => currentSettings }
}

describe('SettingsScreen', () => {
  it('aggregates general-section contributions from other plugins', async () => {
    const { ctx, calls } = await harness()
    const ui = ctx.get('ui') as unknown as { registerView(id: string, c: unknown): void }
    const settingsSvc = ctx.get('settings') as unknown as {
      contribute(c: SettingsContribution): void
    }

    // A plugin's schema-driven contribution and another plugin's card — the
    // screen renders whatever is contributed, owning none of it.
    settingsSvc.contribute({
      id: 'mock.general.fields',
      section: 'general',
      title: 'Mock appearance',
      order: 5,
      fields: [{ key: 'language', type: 'select', label: 'Mock language', options: [
        { value: 'zh', label: 'Simplified Chinese' },
        { value: 'en', label: 'English' },
      ] }],
    })
    const MockCard = () => h('div', { 'data-testid': 'mock-general-card' }, 'mock card body')
    ui.registerView('mock.general.card', MockCard)
    settingsSvc.contribute({
      id: 'mock.general.card',
      section: 'general',
      title: 'Mock card',
      display: 'card',
      order: 6,
    })

    const { getByTestId, container, findByText } = render(h(SettingsScreen, { ctx }))
    await findByText('Mock appearance')
    expect(getByTestId('mock-general-card')).toBeTruthy()

    // The schema field writes through the settings document by dot path.
    const select = container.querySelector('select[aria-label="Mock language"]') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'en' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"language":"en"'))).toBe(true)
    })
  })

  it('shows the unavailable state for a card whose view is missing on this target', async () => {
    const { ctx } = await harness()
    const settingsSvc = ctx.get('settings') as unknown as {
      contribute(c: SettingsContribution): void
    }
    settingsSvc.contribute({
      id: 'mock.general.noview',
      section: 'general',
      title: 'Card without a view',
      display: 'card',
    })

    const { findByText } = render(h(SettingsScreen, { ctx }))
    expect(await findByText('Not available on this platform')).toBeTruthy()
  })

  it('renders tabs and general settings by default', async () => {
    const { ctx } = await harness()
    const { getByText, getAllByText } = render(h(SettingsScreen, { ctx }))

    expect(getAllByText('General & language').length).toBeGreaterThanOrEqual(2)
    expect(getByText('Playback & Audio')).toBeTruthy()
    expect(getByText('Library & sources')).toBeTruthy()
    expect(getByText('Storage & cache')).toBeTruthy()
    expect(getByText('About')).toBeTruthy()

    expect(getByText('Interface language')).toBeTruthy()
    expect(getByText('Minimize to system tray when closing the main window')).toBeTruthy()
  })

  it('switches to playback tab, toggles exclusive mode, and renders the transition schema fields', async () => {
    const { ctx, calls } = await harness({ crossfadeEnabled: false })
    // The shape `plugin-player` contributes — the settings screen renders it
    // through the generic schema form without knowing the plugin.
    ;(ctx.get('settings') as unknown as { contribute(c: SettingsContribution): void }).contribute({
      id: 'player.transition',
      section: 'playback',
      title: 'Transition & crossfade',
      fields: [
        { key: 'gaplessPlayback', type: 'switch', label: 'Gapless playback' },
        { key: 'crossfadeEnabled', type: 'switch', label: 'Crossfade' },
        { key: 'crossfadeDurationSeconds', type: 'slider', label: 'Fade duration', min: 1, max: 10, unit: 's', when: () => true },
        { key: 'pauseOnUnplug', type: 'switch', label: 'Pause when the audio device is unplugged' },
      ],
    })
    const { getByText, findByText, container } = render(h(SettingsScreen, { ctx }))

    const playbackTab = await findByText('Playback & Audio')
    fireEvent.click(playbackTab)

    expect(await findByText('Gapless playback')).toBeTruthy()
    expect(getByText('Crossfade')).toBeTruthy()
    expect(getByText('Exclusive mode')).toBeTruthy()

    // Find and click the toggle switch for exclusive mode
    const exclusiveSwitch = document.querySelector('button[aria-label="Exclusive mode"]') as HTMLButtonElement
    expect(exclusiveSwitch).toBeTruthy()
    fireEvent.click(exclusiveSwitch)

    await waitFor(() => {
      expect(calls.some((c) => c.startsWith('update:') && c.includes('audioExclusive'))).toBe(true)
    })

    // Transition switches write their dot paths through the settings document
    const crossfadeSwitch = container.querySelector(
      'button[aria-label="Crossfade"]',
    ) as HTMLButtonElement
    expect(crossfadeSwitch).toBeTruthy()
    fireEvent.click(crossfadeSwitch)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('"crossfadeEnabled":true'))).toBe(true)
    })
  })

  it('switches to storage tab and clears cache', async () => {
    const { ctx, calls } = await harness()
    const { findByText } = render(h(SettingsScreen, { ctx }))

    const storageTab = await findByText('Storage & cache')
    fireEvent.click(storageTab)

    const clearButton = await findByText('Clear all cache')
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(calls.includes('clearCache')).toBe(true)
    })
  })

  it('reveals danger zone on advanced settings toggle and resets settings', async () => {
    const { ctx, calls } = await harness()
    const { findByText, getByText, queryByText } = render(h(SettingsScreen, { ctx }))

    // Switch to about tab where reset button is located
    const aboutTab = await findByText('About')
    fireEvent.click(aboutTab)

    // Initially danger zone is hidden
    expect(queryByText('Danger zone')).toBeNull()

    // Check "Advanced settings"
    const advCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(advCheckbox).toBeTruthy()
    fireEvent.click(advCheckbox)

    // Now danger zone is visible
    expect(await findByText('Danger zone')).toBeTruthy()
    expect(getByText('Debug & diagnostics center (Debug)')).toBeTruthy()

    // Click "Open Debug"
    const debugBtn = getByText(/Open Debug/)
    fireEvent.click(debugBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)

    // Test Reset
    const resetButton = await findByText('Restore defaults')
    fireEvent.click(resetButton)

    const confirmButton = await findByText('Confirm reset')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(calls.includes('reset')).toBe(true)
    })
  })

  it('switches to about tab', async () => {
    const { ctx } = await harness()
    const { findByText, getByText } = render(h(SettingsScreen, { ctx }))

    const aboutTab = await findByText('About')
    fireEvent.click(aboutTab)

    expect(await findByText('Cross-platform plugin-based music player · Version 0.1.0')).toBeTruthy()
    expect(getByText('Microkernel architecture')).toBeTruthy()
  })

  it('displays and modifies EQ, normalize, compressor, reverb in playback tab and navigates to dsp.view', async () => {
    const { ctx, calls } = await harness()
    const { findByText, getByText } = render(h(SettingsScreen, { ctx }))

    // Switch to playback tab
    const playbackTab = await findByText('Playback & Audio')
    fireEvent.click(playbackTab)

    expect(await findByText('Audio effects & equalizer (DSP)')).toBeTruthy()

    // 1. Check EQ
    expect(getByText('10-Band graphic equalizer (10-Band EQ)')).toBeTruthy()
    expect(getByText('Equalizer preset styles')).toBeTruthy()
    const flatButton = getByText('Flat')
    fireEvent.click(flatButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:eq10:Flat'))).toBe(true)

    // 2. Check Normalize
    expect(getByText('Loudness normalization (Normalization)')).toBeTruthy()
    expect(getByText('Normalization target loudness presets')).toBeTruthy()
    const lufsButton = getByText('Streaming (-14)')
    fireEvent.click(lufsButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:normalize:Streaming (-14 LUFS)'))).toBe(true)

    // 3. Check Compressor
    expect(getByText('Dynamic range compressor (Compressor)')).toBeTruthy()
    expect(getByText('Compression preset styles')).toBeTruthy()
    const nightButton = getByText('🌙 Night Mode')
    fireEvent.click(nightButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:compressor:Night Mode'))).toBe(true)

    // 4. Check Reverb
    expect(getByText('Spatial reverb (Reverb)')).toBeTruthy()
    expect(getByText('Reverb space type')).toBeTruthy()
    const hallButton = getByText('Concert Hall')
    fireEvent.click(hallButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:reverb:Concert Hall'))).toBe(true)

    // 5. Click "Open audio effects panel →" to navigate to dsp.view
    const dspBtn = getByText('Open audio effects panel →')
    fireEvent.click(dspBtn)
    expect(calls.includes('navigate:dsp.view')).toBe(true)
  })

  it('renders active section exclusively with no icons in tabs', async () => {
    const { ctx } = await harness()
    const { container, getByText } = render(h(SettingsScreen, { ctx }))

    // Only general section anchor is mounted initially
    expect(container.querySelector('#section-general')).toBeTruthy()
    expect(container.querySelector('#section-playback')).toBeNull()
    expect(container.querySelector('#section-about')).toBeNull()

    // Tab buttons have no emoji / icons and length is 9 (including plugins)
    const tabButtons = container.querySelectorAll('aside button[role="tab"]')
    expect(tabButtons.length).toBe(9)
    for (const btn of Array.from(tabButtons)) {
      expect(btn.querySelector('svg')).toBeNull()
      expect(btn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u)
    }

    // Default volume is removed completely from the UI
    expect(container.textContent).not.toContain('Default volume')

    // Clicking playback tab replaces active section
    fireEvent.click(getByText('Playback & Audio'))
    expect(container.querySelector('#section-playback')).toBeTruthy()
    expect(container.querySelector('#section-general')).toBeNull()
  })

  it('renders visualizer settings when visualizer.settings view is registered', async () => {
    const { ctx } = await harness()
    ctx.ui.registerView('visualizer.settings', () =>
      h('div', { 'data-testid': 'mock-visualizer-settings' }, 'Audio visualization Mock Visualizer Settings'),
    )
    ;(ctx.get('settings') as unknown as { contribute(c: SettingsContribution): void }).contribute({
      id: 'visualizer.settings',
      section: 'playback',
      title: 'Audio visualization',
      display: 'card',
    })
    const { container, findByText } = render(h(SettingsScreen, { ctx }))
    const playbackTab = await findByText('Playback & Audio')
    fireEvent.click(playbackTab)
    expect(container.querySelector('[data-testid="mock-visualizer-settings"]')).toBeTruthy()
    expect(container.textContent).toContain('Audio visualization')
  })

  it('updates language via Select dropdown', async () => {
    const { ctx, calls } = await harness({ language: 'zh' })
    const { container } = render(h(SettingsScreen, { ctx }))

    // Language select
    const langSelect = container.querySelector('select[aria-label="Interface language"]') as HTMLSelectElement
    expect(langSelect).toBeTruthy()
    expect(langSelect.value).toBe('zh')
    fireEvent.change(langSelect, { target: { value: 'en' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"language":"en"'))).toBe(true)
    })
  })

  it('switches partition when clicking tab without scrollIntoView', async () => {
    const { ctx } = await harness()
    const { container, findByText } = render(h(SettingsScreen, { ctx }))

    expect(container.querySelector('#section-general')).toBeTruthy()
    expect(container.querySelector('#section-playback')).toBeNull()

    const playbackTab = await findByText('Playback & Audio')
    fireEvent.click(playbackTab)

    expect(container.querySelector('#section-playback')).toBeTruthy()
    expect(container.querySelector('#section-general')).toBeNull()
  })


  it('renders download and cache directories with change and open buttons', async () => {
    const { ctx } = await harness({ downloadDir: '/custom/downloads', cacheDir: '/custom/cache' })
    const { getByText, container, findByText } = render(h(SettingsScreen, { ctx }))

    const storageTab = await findByText('Storage & cache')
    fireEvent.click(storageTab)

    expect(getByText('Downloads directory')).toBeTruthy()
    expect(container.textContent).toContain('/custom/downloads')
    expect(getByText('Song cache directory')).toBeTruthy()
    expect(container.textContent).toContain('/custom/cache')

    const changeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Change directory',
    )
    expect(changeButtons.length).toBe(2)

    const openButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Open folder',
    )
    expect(changeButtons.length).toBe(2)
    expect(openButtons.length).toBe(2)
  })

  
  
  
  it('renders global shortcuts settings with master switch and actions', async () => {
    const { ctx } = await harness()
    ctx.ui.registerView('settings.shortcuts', () =>
      h('div', { 'data-testid': 'mock-shortcuts-card' }, 'shortcuts card stub'),
    )
    ;(ctx.get('settings') as unknown as { contribute(c: SettingsContribution): void }).contribute({
      id: 'settings.shortcuts',
      section: 'shortcuts',
      title: 'Global shortcuts',
      display: 'card',
    })
    const { getByTestId, findByText } = render(h(SettingsScreen, { ctx }))

    const shortcutsTab = await findByText('Global shortcuts')
    fireEvent.click(shortcutsTab)
    expect(getByTestId('mock-shortcuts-card')).toBeTruthy()
  })

  it('renders the shortcuts card with bindings through its own view', async () => {
    const { ctx, calls } = await harness()
    ctx.ui.registerView('settings.shortcuts', ShortcutsCard)
    ;(ctx.get('settings') as unknown as { contribute(c: SettingsContribution): void }).contribute({
      id: 'settings.shortcuts',
      section: 'shortcuts',
      title: 'Global shortcuts',
      display: 'card',
    })
    const { container, getByText, getAllByText, findByText } = render(h(SettingsScreen, { ctx }))

    const shortcutsTab = await findByText('Global shortcuts')
    fireEvent.click(shortcutsTab)

    expect(getAllByText('Global shortcuts').length).toBeGreaterThanOrEqual(1)
    expect(getByText('Enable global shortcuts')).toBeTruthy()
    expect(getByText('Play / Pause')).toBeTruthy()
    expect(getByText('Volume up (+5%)')).toBeTruthy()
    expect(getByText('Show / hide desktop lyrics')).toBeTruthy()
    expect(getByText('Show / hide music UI')).toBeTruthy()

    // Toggle master shortcuts switch
    const switchBtn = container.querySelector('button[aria-label="Enable global shortcuts"]') as HTMLButtonElement
    expect(switchBtn).toBeTruthy()
    fireEvent.click(switchBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('"enabled":false'))).toBe(true)
    })

    // Click reset default shortcuts
    const resetBtn = getByText('Restore default shortcuts')
    fireEvent.click(resetBtn)
    await waitFor(() => {
      expect(calls.some((c) => c.includes('CommandOrControl+Alt+Space'))).toBe(true)
    })
  })

  it('renders network proxy settings and handles connection test', async () => {
    const { ctx } = await harness({ proxy: { enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890, sourceRules: {} } })
    const { getByText, findByText } = render(h(SettingsScreen, { ctx }))
    // (the shortcuts block above uses container/getByText/getAllByText)

    const networkTab = await findByText('Network & proxy')
    fireEvent.click(networkTab)

    expect(getByText('Network proxy settings')).toBeTruthy()
    expect(getByText('Enable network proxy')).toBeTruthy()
    expect(getByText('Proxy protocol')).toBeTruthy()
    expect(getByText('Server host & port')).toBeTruthy()
    expect(getByText('Per-source proxy routing for third-party music sources')).toBeTruthy()

    const testBtn = getByText('Test Google connection')
    expect(testBtn).toBeTruthy()
    fireEvent.click(testBtn)

    expect(await findByText(/Google probe reachable|Proxy connection failed/)).toBeTruthy()
  })

  it('persists the download region selection from the network tab', async () => {
    const { ctx, calls } = await harness({ downloadRegion: 'global' })
    const { container, findByText } = render(h(SettingsScreen, { ctx }))

    fireEvent.click(await findByText('Network & proxy'))

    const regionSelect = container.querySelector('select[aria-label="Download region"]') as HTMLSelectElement
    expect(regionSelect).toBeTruthy()
    expect(regionSelect.value).toBe('global')

    fireEvent.change(regionSelect, { target: { value: 'mainland-china' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"downloadRegion":"mainland-china"'))).toBe(true)
    })
  })

  it('expands the GitHub acceleration editor and normalizes, adds and deletes prefixes', async () => {
    const { ctx, calls } = await harness({ githubAccelerationPrefixes: ['https://a.example.com'] })
    const { getByText, getByTestId, queryByTestId, findByText } = render(h(SettingsScreen, { ctx }))

    fireEvent.click(await findByText('Network & proxy'))

    // Collapsed until Customize is clicked
    expect(queryByTestId('settings-github-acceleration')).toBeNull()
    fireEvent.click(getByText('Customize'))

    // The system jsDelivr row is present and carries no controls of its own
    const systemRow = getByTestId('settings-github-prefix-system')
    expect(systemRow).toBeTruthy()
    expect(systemRow.textContent).toContain('jsDelivr')
    expect(systemRow.querySelector('button')).toBeNull()

    // The stored prefix renders into its row
    const row0 = getByTestId('settings-github-prefix-row-0')
    const input0 = row0.querySelector('input') as HTMLInputElement
    expect(input0.value).toBe('https://a.example.com')

    // Add a row, type an unnormalized prefix, blur → trailing slash appended
    fireEvent.click(getByTestId('settings-github-prefix-add'))
    const row1 = getByTestId('settings-github-prefix-row-1')
    const input1 = row1.querySelector('input') as HTMLInputElement
    fireEvent.change(input1, { target: { value: 'https://b.example.com' } })
    fireEvent.blur(input1)

    await waitFor(() => {
      expect(
        calls.some((c) =>
          c.includes(
            '"githubAccelerationPrefixes":["https://a.example.com","https://b.example.com/"]',
          ),
        ),
      ).toBe(true)
    })

    // Delete the first row → the remaining array is reported
    const deleteBtn = getByTestId('settings-github-prefix-row-0').querySelector(
      'button[aria-label="Delete acceleration endpoint 1"]',
    ) as HTMLButtonElement
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(
        calls.some((c) => c.includes('"githubAccelerationPrefixes":["https://b.example.com/"]')),
      ).toBe(true)
    })
  })

  it('keeps an invalid prefix visible (marked invalid) instead of silently dropping it', async () => {
    const { ctx, calls } = await harness({ githubAccelerationPrefixes: [] })
    const { getByText, getByTestId, findByText } = render(h(SettingsScreen, { ctx }))

    fireEvent.click(await findByText('Network & proxy'))
    fireEvent.click(getByText('Customize'))

    fireEvent.click(getByTestId('settings-github-prefix-add'))
    const input = getByTestId('settings-github-prefix-row-0').querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ftp://not-https.example.com' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(
        calls.some((c) => c.includes('"githubAccelerationPrefixes":["ftp://not-https.example.com"]')),
      ).toBe(true)
    })
    expect((input as HTMLInputElement).style.border).toContain('var(--state-error')
  })

  it('reorders acceleration prefixes via drag and drop', async () => {
    const { ctx, calls } = await harness({
      githubAccelerationPrefixes: ['https://a.example.com/', 'https://b.example.com/', 'https://c.example.com/'],
    })
    const { getByText, getByTestId, findByText } = render(h(SettingsScreen, { ctx }))

    fireEvent.click(await findByText('Network & proxy'))
    fireEvent.click(getByText('Customize'))

    const row0 = getByTestId('settings-github-prefix-row-0')
    const row1 = getByTestId('settings-github-prefix-row-1')

    // jsdom rects are all zero, so dragOver lands after the hovered row:
    // dropping row 0 onto row 1 inserts it before row 2.
    fireEvent.dragStart(row0)
    fireEvent.dragOver(row1)
    fireEvent.drop(row1)

    await waitFor(() => {
      expect(
        calls.some((c) =>
          c.includes(
            '"githubAccelerationPrefixes":["https://b.example.com/","https://a.example.com/","https://c.example.com/"]',
          ),
        ),
      ).toBe(true)
    })
  })

  it('renders DebugScreen and navigates to discover and http logs', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(DebugScreen, { ctx }))

    expect(await findByText('Debug & diagnostics (Debug)')).toBeTruthy()
    expect(getByText('Current debug status')).toBeTruthy()
    expect(getByText('Current runtime environment')).toBeTruthy()
    expect(getByText('System logs (Discover)')).toBeTruthy()
    expect(getByText('Third-party source network logs (HTTP Logs)')).toBeTruthy()
    expect(getByText('Test sources (Test Sources)')).toBeTruthy()
    expect(getByText('System architecture & plugin topology (Inspector)')).toBeTruthy()

    // Test navigation to Discover logs
    const discoverBtn = getByText('Open Discover logs →')
    fireEvent.click(discoverBtn)
    expect(calls.includes('navigate:debug.logs')).toBe(true)

    // Test navigation to HTTP logs
    const httpLogsBtn = getByText('Open HTTP logs page →')
    fireEvent.click(httpLogsBtn)
    expect(calls.includes('navigate:debug.http-logs')).toBe(true)

    // Test navigation to Theme Palette
    const themePaletteBtn = getByText('Open theme palette →')
    fireEvent.click(themePaletteBtn)
    expect(calls.includes('navigate:debug.theme-palette')).toBe(true)

    // Test navigation to Test Sources
    const testSourcesBtn = getByText('Open source tests →')
    fireEvent.click(testSourcesBtn)
    expect(calls.includes('navigate:sources.test')).toBe(true)

    // Test navigation to Inspector
    const inspectorBtn = getByText('Open architecture topology (Inspector) →')
    fireEvent.click(inspectorBtn)
    expect(calls.includes('navigate:inspector.panel')).toBe(true)

    // Test back button
    const backBtn = getByText('← Back to settings')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:settings.view')).toBe(true)
  })

  it('renders ThemePaletteScreen, toggles scheme, and filters variables', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText, getByTestId } = render(h(ThemePaletteScreen, { ctx }))

    expect(await findByText('Theme variable palette (Theme Palette)')).toBeTruthy()
    expect(getByTestId('theme-palette-screen')).toBeTruthy()
    expect(getByTestId('palette-swatch---bg-app')).toBeTruthy()

    // Test scheme toggle
    const schemeBtn = getByTestId('palette-scheme-toggle')
    fireEvent.click(schemeBtn)
    expect(getByText(/Light mode \(Light\)|Dark mode \(Dark\)/)).toBeTruthy()

    // Test back button
    const backBtn = getByText('← Back to debug')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)
  })

  it('renders SettingsScreen and navigates to import sources, history, and debug', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText, queryByText } = render(h(SettingsScreen, { ctx }))

    expect(await findByText('General & interface language')).toBeTruthy()

    // Test navigation to Import Sources (in sources tab)
    const sourcesTab = await findByText('Library & sources')
    fireEvent.click(sourcesTab)
    const importSourcesBtn = getByText('Import sources')
    fireEvent.click(importSourcesBtn)
    expect(calls.includes('navigate:sources.import')).toBe(true)

    // Playback history was moved out of settings into more-menu
    expect(queryByText('View play history')).toBeNull()

    // Test navigation to Debug center (revealed via Advanced Settings in About tab)
    const aboutTab = await findByText('About')
    fireEvent.click(aboutTab)
    const advCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    if (advCheckbox) fireEvent.click(advCheckbox)
    const debugBtn = getByText('Open Debug center →')
    fireEvent.click(debugBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)
  })

  it('renders DebugScreen safely when process is undefined in browser sandbox', async () => {
    const { ctx } = await harness()
    const originalProcess = globalThis.process
    try {
      // @ts-expect-error test without process
      delete globalThis.process
      const { findByText, getByText } = render(h(DebugScreen, { ctx }))
      expect(await findByText('Debug & diagnostics (Debug)')).toBeTruthy()
      expect(getByText('Production environment (Production)')).toBeTruthy()
    } finally {
      globalThis.process = originalProcess
    }
  })

  it('renders LogsScreen and handles actions', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(LogsScreen, { ctx }))

    expect(await findByText('System logs (Discover Logs)')).toBeTruthy()
    expect(await findByText('kernel: cordis booted successfully')).toBeTruthy()

    // Test clear logs
    const clearBtn = getByText('Clear logs')
    fireEvent.click(clearBtn)
    expect(calls.includes('clearLogBuffer')).toBe(true)

    // Test back button
    const backBtn = getByText('← Back to debug')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)
  })

  it('renders HttpLogsScreen and displays HTTP requests', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(HttpLogsScreen, { ctx }))

    expect(await findByText('Third-party source HTTP logs (HTTP Logs)')).toBeTruthy()
    expect(await findByText('https://api.example.com/search?q=test')).toBeTruthy()
    expect(getByText('GET')).toBeTruthy()
    expect(getByText('200')).toBeTruthy()

    // Test back button
    const backBtn = getByText('← Back to debug')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)
  })


  
  it('renders plugins partition, filters by query, expands card details, and toggles enablement', async () => {
    const { ctx, calls } = await harness()
    const { container, findByText, getByText, getAllByText, getByPlaceholderText, queryByText } = render(h(SettingsScreen, { ctx }))

    const pluginsTab = await findByText('Plugins')
    fireEvent.click(pluginsTab)

    expect(await findByText('Core')).toBeTruthy()
    expect(getByText('— Desktop low-level infrastructure')).toBeTruthy()
    expect(getByText('Logs')).toBeTruthy()
    expect(getByText('Features')).toBeTruthy()
    expect(getByText('UI')).toBeTruthy()

    // Test search filter
    const searchInput = getByPlaceholderText('Search plugins…')
    fireEvent.change(searchInput, { target: { value: 'theme' } })

    expect(getByText('Theme manager')).toBeTruthy()
    expect(queryByText('Audio core')).toBeNull()

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(await findByText('Audio core')).toBeTruthy()

    // Expand plugin card for details
    const themeCardChevron = container.querySelector('[role="button"][aria-label^="Expand Theme manager"]') as HTMLElement
    expect(themeCardChevron).toBeTruthy()
    fireEvent.click(themeCardChevron)

    // Key-value details
    expect(getByText('Full name')).toBeTruthy()
    expect(getAllByText(/@BBeBee\/plugin-theme/).length).toBeGreaterThanOrEqual(2)
    expect(getByText('Dependencies (1)')).toBeTruthy()
    expect(getByText('Dependents (2)')).toBeTruthy()

    // 1. Initially without advanced settings: enable/disable switch is hidden and hint is shown
    expect(container.querySelector('button[role="switch"]')).toBeNull()
    expect(getByText('(Plugin enable/disable is hidden; enable advanced settings on the "About" page)')).toBeTruthy()

    // 2. Open About tab and enable "Advanced settings"
    const aboutTab = getByText('About')
    fireEvent.click(aboutTab)
    const advancedCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(advancedCheckbox).toBeTruthy()
    fireEvent.click(advancedCheckbox)

    // 3. Switch back to Plugins tab
    fireEvent.click(getByText('Plugins'))
    const themeCardChevron2 = container.querySelector('[role="button"][aria-label^="Expand Theme manager"]') as HTMLElement
    expect(themeCardChevron2).toBeTruthy()
    fireEvent.click(themeCardChevron2)

    // Switch enablement toggle: now visible! Trying to disable theme management with active dependents triggers confirmation
    const themeSwitch = container.querySelector('button[role="switch"]') as HTMLButtonElement
    expect(themeSwitch).toBeTruthy()
    fireEvent.click(themeSwitch)

    // Confirmation sheet opens
    expect(await findByText('Confirm disabling plugin')).toBeTruthy()
    expect(getAllByText(/Settings center/).length).toBeGreaterThanOrEqual(2)

    // Confirm disable
    const confirmBtn = container.querySelector('[data-testid="confirm-disable-plugin-btn"]') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(calls.includes('pluginManager:setEnabled:@BBeBee/plugin-theme:false')).toBe(true)
    })
  })

  it('renders playback tab safely under scoped context with missing optional services and schema field when predicates', async () => {
    let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, crossfadeEnabled: false }

    class SettingsStub extends Service implements Partial<SettingsService> {
      private appCtx: Context
      private contributions: SettingsContribution[] = []

      constructor(ctx: Context) {
        super(ctx, 'settings')
        this.appCtx = ctx
      }

      get = async (): Promise<AppSettings> => currentSettings
      getSync = (): AppSettings => currentSettings
      update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
        currentSettings = { ...currentSettings, ...patch }
        this.appCtx.emit('settings/changed', currentSettings)
        return currentSettings
      }
      reset = async (): Promise<AppSettings> => {
        currentSettings = { ...DEFAULT_APP_SETTINGS }
        this.appCtx.emit('settings/changed', currentSettings)
        return currentSettings
      }
      onSettingsChange = (callback: (settings: AppSettings) => void) => {
        return this.appCtx.on('settings/changed', callback)
      }
      contribute = (c: SettingsContribution) => {
        this.contributions.push(c)
        this.appCtx.emit('settings/contributions-changed', this.contributions)
        return () => {
          this.contributions = this.contributions.filter((item) => item.id !== c.id)
          this.appCtx.emit('settings/contributions-changed', this.contributions)
        }
      }
      getContributions = (): readonly SettingsContribution[] => this.contributions
    }

    class UiStub extends Service {
      public views = new Map<string, unknown>()
      public settings: SettingsContribution[] = []
      constructor(ctx: Context) {
        super(ctx, 'ui')
      }
      navigate = () => {}
      viewFor = (id: string) => this.views.get(id)
      registerView = (id: string, component: unknown) => {
        this.views.set(id, component)
        return () => {
          this.views.delete(id)
        }
      }
    }

    class DummyAudioStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'audio')
      }
    }

    const root = new Context()
    await root.plugin(SettingsStub)
    await root.plugin(UiStub)
    await root.plugin(DummyAudioStub)

    let settingsScoped: Context | undefined
    root.inject(['ui', 'settings'], (s) => void (settingsScoped = s))

    let playerScoped: Context | undefined
    root.inject(['audio'], (s) => void (playerScoped = s))

    await new Promise((r) => setTimeout(r, 0))
    if (!settingsScoped || !playerScoped) {
      throw new Error('Failed to create scoped contexts')
    }

    // 1. Assert Cordis invariant: accessing ctx.settings directly on playerScoped throws
    expect(() => (playerScoped as unknown as { settings: unknown }).settings).toThrow(
      /cannot get property "settings" without inject/,
    )

    // 2. Assert that serviceOf(playerScoped, 'settings') safely accesses the service
    const settingsSvc = serviceOf<SettingsService>(playerScoped, 'settings')
    expect(settingsSvc).toBeDefined()

    // 3. Register real-world player.transition contribution with when predicate using serviceOf
    settingsSvc!.contribute({
      id: 'player.transition',
      section: 'playback',
      title: 'Transition & crossfade',
      fields: [
        { key: 'gaplessPlayback', type: 'switch', label: 'Gapless playback' },
        { key: 'crossfadeEnabled', type: 'switch', label: 'Crossfade' },
        {
          key: 'crossfadeDurationSeconds',
          type: 'slider',
          label: 'Fade duration',
          min: 1,
          max: 10,
          unit: 's',
          when: () => {
            return (
              serviceOf<{ getSync(): AppSettings }>(playerScoped!, 'settings')?.getSync()
                ?.crossfadeEnabled ?? false
            )
          },
        },
      ],
    })

    // 4. Register a card whose view is missing (tests graceful degradation)
    settingsSvc!.contribute({
      id: 'settings.missing-card',
      section: 'playback',
      title: 'Extension card without a view',
      display: 'card',
    })

    // 5. Render SettingsScreen with scoped context (only has ui and settings, no audio output devices, no dsp)
    const { findByText, getByText, queryByText } = render(h(SettingsScreen, { ctx: settingsScoped }))

    // 6. Switch to Playback tab
    const playbackTab = await findByText('Playback & Audio')
    fireEvent.click(playbackTab)

    // 7. Verify Playback tab rendered safely without throwing
    expect(await findByText('Audio output engine & devices')).toBeTruthy()

    // Degradation 1: Audio device falls back to placeholder when audio service is not providing devices
    expect(getByText('Current output destination: Audio output device')).toBeTruthy()

    // Degradation 2: Missing card view renders fallback badge
    expect(getByText('Extension card without a view')).toBeTruthy()
    expect(getByText('Not available on this platform')).toBeTruthy()

    // Schema form fields render safely
    expect(getByText('Transition & crossfade')).toBeTruthy()
    expect(getByText('Gapless playback')).toBeTruthy()
    expect(getByText('Crossfade')).toBeTruthy()

    // Since crossfadeEnabled is false, slider is not rendered
    expect(queryByText('Fade duration')).toBeNull()

    // 8. Dynamically update crossfadeEnabled to true -> when predicate re-evaluates via serviceOf
    await act(async () => {
      await settingsSvc!.update({ crossfadeEnabled: true })
    })

    // Slider now renders!
    expect(await findByText('Fade duration')).toBeTruthy()
  })

  it('renders LyricSourcesSection, opens configure modal, edits JSON config and saves', async () => {
    const { ctx } = await harness()
    const { getByTestId, queryByTestId } = render(h(LyricSourcesSection, { ctx }))
    await act(async () => {
      await waitFor(() => expect(getByTestId('lyric-source-configure-builtin-lrclib')).toBeTruthy())
    })

    // Click configure button on builtin source
    await act(async () => {
      getByTestId('lyric-source-configure-builtin-lrclib').click()
    })

    expect(getByTestId('lyric-source-configure-modal')).toBeTruthy()

    // Edit config JSON
    await act(async () => {
      fireEvent.change(getByTestId('lyric-source-configure-json'), {
        target: { value: '{"apiKey": "test-key-123", "endpoint": "https://api.lrclib.net"}' },
      })
    })

    // Click save
    await act(async () => {
      getByTestId('lyric-source-configure-save-btn').click()
    })

    expect(queryByTestId('lyric-source-configure-modal')).toBeNull()
  })
})

/*
 * The i18n pilot, end to end: the real plugin-i18n service is on the harness
 * context, so flipping `settings.language` must re-render the screen's
 * translated strings without a remount — the acceptance the feature layer
 * owes every future migrated component.
 */
describe('SettingsScreen i18n pilot', () => {
  it('switches the GitHub acceleration editor live when settings.language changes', async () => {
    const { ctx } = await harness()
    const settingsSvc = ctx.get('settings') as unknown as {
      update(patch: Partial<AppSettings>): Promise<AppSettings>
    }
    const { getByText, findByText, queryByText } = render(h(SettingsScreen, { ctx }))

    fireEvent.click(await findByText('Network & proxy'))
    expect(getByText('Customize')).toBeTruthy()

    await act(async () => {
      await settingsSvc.update({ language: 'zh' })
    })
    expect(await findByText('自定义')).toBeTruthy()
    expect(queryByText('Customize')).toBeNull()

    await act(async () => {
      await settingsSvc.update({ language: 'en' })
    })
    expect(await findByText('Customize')).toBeTruthy()
    expect(queryByText('自定义')).toBeNull()
  })
})
