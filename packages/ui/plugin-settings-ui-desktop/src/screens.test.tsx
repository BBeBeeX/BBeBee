// @vitest-environment jsdom
/**
 * Desktop Settings Screen component tests.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { AppSettings, SettingsService, SettingsContribution, CacheClass, CacheStats, ThemeDefinition, NowPlayingStyleMeta, LyricSourceDefinition, SourceRecord, PluginInfo, PluginManagerService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS, NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { midnightPurpleTheme, spotifyTheme } from '@BBeBee/ui-tokens'
import { SettingsScreen } from './SettingsScreen.js'
import { DebugScreen } from './DebugScreen.js'
import { LogsScreen } from './LogsScreen.js'
import { HttpLogsScreen } from './HttpLogsScreen.js'

afterEach(() => {
  cleanup()
})

async function harness(initialSettings: Partial<AppSettings> = {}) {
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...initialSettings }
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
      { id: 'eq10', displayName: '10频段均衡器', defaultOrder: 20 },
      { id: 'normalize', displayName: '响度标准化', defaultOrder: 30 },
      { id: 'compressor', displayName: '动态压缩器', defaultOrder: 40 },
      { id: 'reverb', displayName: '空间混响', defaultOrder: 50 },
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
        name: 'LRCLIB (默认歌词源)',
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
  }

  class PluginManagerStub extends Service implements Partial<PluginManagerService> {
    public plugins: PluginInfo[] = [
      {
        id: '@BBeBee/core-audio',
        name: 'core-audio',
        displayName: '音频核心',
        description: '音频播放底层驱动',
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
        displayName: '控制台日志',
        description: '标准控制台输出通道',
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
        displayName: '主题管理',
        description: '主题服务与色彩管理',
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
        displayName: '设置中心',
        description: '用户偏好与设置',
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
        displayName: '播放器界面',
        description: '播放器视图与控制器',
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
      h('h3', null, '音频效果与均衡器 (DSP)'),
      h('div', null, '10 频段图示均衡器 (10-Band EQ)'),
      h('div', null, '均衡器预设风格'),
      h('button', { onClick: () => void dsp.applyPreset('eq10', '原声 (Flat)') }, '原声'),
      h('div', null, '音量响度标准化 (Normalization)'),
      h('div', null, '标准化目标响度预设'),
      h('button', { onClick: () => void dsp.applyPreset('normalize', '流媒体标准 (-14 LUFS)') }, '流媒体 (-14)'),
      h('div', null, '动态范围压缩器 (Compressor)'),
      h('div', null, '压缩模式风格'),
      h('button', { onClick: () => void dsp.applyPreset('compressor', '夜间模式 (Night Mode)') }, '🌙 夜间模式'),
      h('div', null, '空间混响效果 (Reverb)'),
      h('div', null, '混响空间类型'),
      h('button', { onClick: () => void dsp.applyPreset('reverb', '音乐大厅 (Concert Hall)') }, '音乐大厅'),
      h('button', { onClick: () => ui.navigate('dsp.view') }, '打开音效面板 →'),
    )
  }

  ui.registerView('settings.dsp', MockDspCard)
  settingsSvc.contribute({
    id: 'settings.dsp',
    section: 'playback',
    title: '音频效果与均衡器 (DSP)',
    display: 'card',
  })

  return { ctx: scoped, calls, getCurrentSettings: () => currentSettings }
}

describe('SettingsScreen', () => {
  it('renders tabs and general settings by default', async () => {
    const { ctx } = await harness()
    const { getByText, getAllByText } = render(h(SettingsScreen, { ctx }))

    expect(getAllByText('常规与语言').length).toBeGreaterThanOrEqual(2)
    expect(getByText('播放与音频')).toBeTruthy()
    expect(getByText('曲库与来源')).toBeTruthy()
    expect(getByText('存储与缓存')).toBeTruthy()
    expect(getByText('关于应用')).toBeTruthy()

    expect(getByText('界面语言')).toBeTruthy()
    expect(getByText('关闭主窗口时最小化到系统托盘')).toBeTruthy()
  })

  it('switches to playback tab and toggles settings', async () => {
    const { ctx, calls } = await harness({ crossfadeEnabled: false })
    const { getByText, findByText } = render(h(SettingsScreen, { ctx }))

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(await findByText('曲目交叉淡入淡出 (Crossfade)')).toBeTruthy()
    expect(getByText('无缝播放 (Gapless Playback)')).toBeTruthy()
    expect(getByText('拔出音频设备时自动暂停')).toBeTruthy()
    expect(getByText('独占模式 (Exclusive Mode)')).toBeTruthy()

    // Find and click the toggle switch for exclusive mode
    const exclusiveSwitch = document.querySelector('button[aria-label="独占模式"]') as HTMLButtonElement
    expect(exclusiveSwitch).toBeTruthy()
    fireEvent.click(exclusiveSwitch)

    await waitFor(() => {
      expect(calls.some((c) => c.startsWith('update:') && c.includes('audioExclusive'))).toBe(true)
    })

    // Find and click the toggle switch for crossfade
    const crossfadeSwitch =
      (document.querySelector('button[aria-label="曲目交叉淡入淡出"]') as HTMLButtonElement) ??
      document.querySelectorAll('button[role="switch"]')[2]
    expect(crossfadeSwitch).toBeTruthy()
    fireEvent.click(crossfadeSwitch)

    await waitFor(() => {
      expect(calls.some((c) => c.startsWith('update:') && c.includes('crossfadeEnabled'))).toBe(true)
    })
  })

  it('switches to storage tab and clears cache', async () => {
    const { ctx, calls } = await harness()
    const { findByText } = render(h(SettingsScreen, { ctx }))

    const storageTab = await findByText('存储与缓存')
    fireEvent.click(storageTab)

    const clearButton = await findByText('清除全部缓存')
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(calls.includes('clearCache')).toBe(true)
    })
  })

  it('reveals danger zone on advanced settings toggle and resets settings', async () => {
    const { ctx, calls } = await harness()
    const { findByText, getByText, queryByText } = render(h(SettingsScreen, { ctx }))

    // Switch to about tab where reset button is located
    const aboutTab = await findByText('关于应用')
    fireEvent.click(aboutTab)

    // Initially danger zone is hidden
    expect(queryByText('危险区域')).toBeNull()

    // Check "高级设置"
    const advCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(advCheckbox).toBeTruthy()
    fireEvent.click(advCheckbox)

    // Now danger zone is visible
    expect(await findByText('危险区域')).toBeTruthy()
    expect(getByText('调试与诊断中心 (Debug)')).toBeTruthy()

    // Click "进入 Debug"
    const debugBtn = getByText(/进入 Debug/)
    fireEvent.click(debugBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)

    // Test Reset
    const resetButton = await findByText('恢复默认设置')
    fireEvent.click(resetButton)

    const confirmButton = await findByText('确认重置')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(calls.includes('reset')).toBe(true)
    })
  })

  it('switches to about tab', async () => {
    const { ctx } = await harness()
    const { findByText, getByText } = render(h(SettingsScreen, { ctx }))

    const aboutTab = await findByText('关于应用')
    fireEvent.click(aboutTab)

    expect(await findByText('跨平台插件化音乐播放器 · Version 0.1.0')).toBeTruthy()
    expect(getByText('微内核架构')).toBeTruthy()
  })

  it('displays and modifies EQ, normalize, compressor, reverb in playback tab and navigates to dsp.view', async () => {
    const { ctx, calls } = await harness()
    const { findByText, getByText } = render(h(SettingsScreen, { ctx }))

    // Switch to playback tab
    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(await findByText('音频效果与均衡器 (DSP)')).toBeTruthy()

    // 1. Check EQ
    expect(getByText('10 频段图示均衡器 (10-Band EQ)')).toBeTruthy()
    expect(getByText('均衡器预设风格')).toBeTruthy()
    const flatButton = getByText('原声')
    fireEvent.click(flatButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:eq10:原声 (Flat)'))).toBe(true)

    // 2. Check Normalize
    expect(getByText('音量响度标准化 (Normalization)')).toBeTruthy()
    expect(getByText('标准化目标响度预设')).toBeTruthy()
    const lufsButton = getByText('流媒体 (-14)')
    fireEvent.click(lufsButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:normalize:流媒体标准 (-14 LUFS)'))).toBe(true)

    // 3. Check Compressor
    expect(getByText('动态范围压缩器 (Compressor)')).toBeTruthy()
    expect(getByText('压缩模式风格')).toBeTruthy()
    const nightButton = getByText('🌙 夜间模式')
    fireEvent.click(nightButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:compressor:夜间模式 (Night Mode)'))).toBe(true)

    // 4. Check Reverb
    expect(getByText('空间混响效果 (Reverb)')).toBeTruthy()
    expect(getByText('混响空间类型')).toBeTruthy()
    const hallButton = getByText('音乐大厅')
    fireEvent.click(hallButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:reverb:音乐大厅 (Concert Hall)'))).toBe(true)

    // 5. Click "打开音效面板 →" to navigate to dsp.view
    const dspBtn = getByText('打开音效面板 →')
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
    expect(container.textContent).not.toContain('默认音量')

    // Clicking playback tab replaces active section
    fireEvent.click(getByText('播放与音频'))
    expect(container.querySelector('#section-playback')).toBeTruthy()
    expect(container.querySelector('#section-general')).toBeNull()
  })

  it('renders visualizer settings when visualizer.settings view is registered', async () => {
    const { ctx } = await harness()
    ctx.ui.registerView('visualizer.settings', () =>
      h('div', { 'data-testid': 'mock-visualizer-settings' }, 'Mock Visualizer Settings'),
    )
    const { container, findByText } = render(h(SettingsScreen, { ctx }))
    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)
    expect(container.querySelector('[data-testid="mock-visualizer-settings"]')).toBeTruthy()
    expect(container.textContent).toContain('音频可视化')
  })

  it('updates language via Select dropdown', async () => {
    const { ctx, calls } = await harness({ language: 'zh' })
    const { container } = render(h(SettingsScreen, { ctx }))

    // Language select
    const langSelect = container.querySelector('select[aria-label="界面语言"]') as HTMLSelectElement
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

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(container.querySelector('#section-playback')).toBeTruthy()
    expect(container.querySelector('#section-general')).toBeNull()
  })

  it('toggles expandable row via chevron button', async () => {
    const { ctx } = await harness({ crossfadeEnabled: true })
    const { container, findByText } = render(h(SettingsScreen, { ctx }))

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    // Initially expanded when crossfadeEnabled: true
    expect(container.textContent).toContain('淡入淡出持续时间')

    // Find the chevron toggle button for crossfade
    const chevronBtn = container.querySelector('button[aria-label^="收起 曲目交叉淡入淡出"]') as HTMLButtonElement
    expect(chevronBtn).toBeTruthy()
    fireEvent.click(chevronBtn)

    // Now collapsed
    expect(container.textContent).not.toContain('淡入淡出持续时间')

    // Click again to re-expand
    const expandBtn = container.querySelector('button[aria-label^="展开 曲目交叉淡入淡出"]') as HTMLButtonElement
    expect(expandBtn).toBeTruthy()
    fireEvent.click(expandBtn)
    expect(container.textContent).toContain('淡入淡出持续时间')
  })

  it('renders download and cache directories with change and open buttons', async () => {
    const { ctx } = await harness({ downloadDir: '/custom/downloads', cacheDir: '/custom/cache' })
    const { getByText, container, findByText } = render(h(SettingsScreen, { ctx }))

    const storageTab = await findByText('存储与缓存')
    fireEvent.click(storageTab)

    expect(getByText('下载目录')).toBeTruthy()
    expect(container.textContent).toContain('/custom/downloads')
    expect(getByText('歌曲缓存目录')).toBeTruthy()
    expect(container.textContent).toContain('/custom/cache')

    const changeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === '更改目录',
    )
    expect(changeButtons.length).toBe(2)

    const openButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === '打开文件夹',
    )
    expect(changeButtons.length).toBe(2)
    expect(openButtons.length).toBe(2)
  })

  it('renders theme settings and allows selecting themes', async () => {
    const { ctx, calls } = await harness()
    const { getByText, getByTestId } = render(h(SettingsScreen, { ctx }))

    expect(getByText('主题与色彩管理')).toBeTruthy()
    expect(getByText('Bee Music · Cyber Neon (蓝紫电光)')).toBeTruthy()
    expect(getByText('Spotify 经典绿 (Spotify Classic)')).toBeTruthy()

    const spotifyBtn = getByTestId('theme-option-spotify')
    expect(spotifyBtn).toBeTruthy()
    fireEvent.click(spotifyBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('"themeId":"spotify"'))).toBe(true)
    })
  })

  it('imports and deletes custom color theme in GeneralSection', async () => {
    const { ctx, calls } = await harness()
    const { getByText, getAllByText, getByTestId, queryByTestId } = render(h(SettingsScreen, { ctx }))

    // Open import modal
    const importBtn = getByTestId('import-theme-button')
    fireEvent.click(importBtn)
    expect(getAllByText('导入色彩模式').length).toBeGreaterThanOrEqual(2)

    // Try submitting empty JSON -> error
    const submitBtn = getByTestId('submit-import-theme')
    fireEvent.click(submitBtn)
    expect(getByTestId('import-theme-error').textContent).toContain('请输入或选择色彩模式 JSON')

    // Fill valid JSON
    const textarea = getByTestId('import-theme-textarea')
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          id: 'neon-cyber',
          name: '霓虹赛博 (Neon Cyber)',
          tokens: { brand: { primary: '#00FFFF' } },
        }),
      },
    })

    // Submit import
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(getByTestId('theme-option-neon-cyber')).toBeTruthy()
      expect(getByText('霓虹赛博 (Neon Cyber)')).toBeTruthy()
      expect(calls.some((c) => c.includes('theme:register:neon-cyber'))).toBe(true)
      expect(calls.some((c) => c.includes('"themeId":"neon-cyber"'))).toBe(true)
    })

    // Now delete the custom theme
    const deleteBtn = getByTestId('delete-theme-neon-cyber')
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(queryByTestId('theme-option-neon-cyber')).toBeNull()
      expect(calls.some((c) => c.includes('theme:remove:neon-cyber'))).toBe(true)
    })
  })

  it('renders desktop lyrics settings and live preview box', async () => {
    const { ctx, calls } = await harness()
    const { container, getByText, findByText } = render(h(SettingsScreen, { ctx }))

    const lyricsTab = await findByText('桌面歌词')
    fireEvent.click(lyricsTab)

    expect(getByText('桌面歌词设置')).toBeTruthy()
    expect(getByText('开启桌面歌词')).toBeTruthy()
    expect(getByText('歌词显示行数')).toBeTruthy()
    expect(getByText('文本对齐方式')).toBeTruthy()
    expect(getByText('歌词字体')).toBeTruthy()
    expect(getByText('歌词字号')).toBeTruthy()
    expect(getByText('歌词高亮颜色')).toBeTruthy()
    expect(getByText('文字透明度')).toBeTruthy()

    // Toggle 开启桌面歌词 switch
    const lyricsSwitch = container.querySelector('button[aria-label="开启桌面歌词"]') as HTMLButtonElement
    expect(lyricsSwitch).toBeTruthy()
    fireEvent.click(lyricsSwitch)
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"enabled":true'))).toBe(true)
    })

    // Live preview box is present
    const preview = container.querySelector('[data-testid="desktop-lyrics-preview"]')
    expect(preview).toBeTruthy()
    expect(preview?.textContent).toContain('桌面歌词实时预览效果')
    expect(preview?.textContent).toContain('哪怕生命如尘 也要绚烂如火')

    // Change line mode to single
    const lineModeSelect = container.querySelector('select[aria-label="歌词显示行数"]') as HTMLSelectElement
    expect(lineModeSelect).toBeTruthy()
    fireEvent.change(lineModeSelect, { target: { value: 'single' } })

    await waitFor(() => {
      expect(calls.some((c) => c.includes('"lineMode":"single"'))).toBe(true)
    })
  })

  it('renders global shortcuts settings with master switch and actions', async () => {
    const { ctx, calls } = await harness()
    const { container, getByText, getAllByText, findByText } = render(h(SettingsScreen, { ctx }))

    const shortcutsTab = await findByText('全局快捷键')
    fireEvent.click(shortcutsTab)

    expect(getAllByText('全局快捷键').length).toBeGreaterThanOrEqual(1)
    expect(getByText('启用全局快捷键')).toBeTruthy()
    expect(getByText('播放 / 暂停')).toBeTruthy()
    expect(getByText('增大音量 (+5%)')).toBeTruthy()
    expect(getByText('显示 / 隐藏桌面歌词')).toBeTruthy()
    expect(getByText('显示 / 隐藏音乐界面')).toBeTruthy()

    // Toggle master shortcuts switch
    const switchBtn = container.querySelector('button[aria-label="启用全局快捷键"]') as HTMLButtonElement
    expect(switchBtn).toBeTruthy()
    fireEvent.click(switchBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('"enabled":false'))).toBe(true)
    })

    // Click reset default shortcuts
    const resetBtn = getByText('恢复默认快捷键')
    fireEvent.click(resetBtn)
    await waitFor(() => {
      expect(calls.some((c) => c.includes('CommandOrControl+Alt+Space'))).toBe(true)
    })
  })

  it('renders network proxy settings and handles connection test', async () => {
    const { ctx } = await harness({ proxy: { enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890, sourceRules: {} } })
    const { getByText, findByText } = render(h(SettingsScreen, { ctx }))

    const networkTab = await findByText('网络与代理')
    fireEvent.click(networkTab)

    expect(getByText('网络代理设置')).toBeTruthy()
    expect(getByText('启用网络代理')).toBeTruthy()
    expect(getByText('代理协议类型')).toBeTruthy()
    expect(getByText('服务器主机与端口')).toBeTruthy()
    expect(getByText('第三方音源代理独立分流')).toBeTruthy()

    const testBtn = getByText('测试 Google 连接')
    expect(testBtn).toBeTruthy()
    fireEvent.click(testBtn)

    expect(await findByText(/Google 探测节点连通正常|代理连通/)).toBeTruthy()
  })

  it('renders DebugScreen and navigates to discover and http logs', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(DebugScreen, { ctx }))

    expect(await findByText('调试与诊断 (Debug)')).toBeTruthy()
    expect(getByText('当前调试状态')).toBeTruthy()
    expect(getByText('当前运行环境')).toBeTruthy()
    expect(getByText('系统日志 (Discover)')).toBeTruthy()
    expect(getByText('第三方源网络日志 (HTTP Logs)')).toBeTruthy()
    expect(getByText('测试音源 (Test Sources)')).toBeTruthy()
    expect(getByText('系统架构与插件拓扑 (Inspector)')).toBeTruthy()

    // Test navigation to Discover logs
    const discoverBtn = getByText('进入 Discover 日志页 →')
    fireEvent.click(discoverBtn)
    expect(calls.includes('navigate:debug.logs')).toBe(true)

    // Test navigation to HTTP logs
    const httpLogsBtn = getByText('进入 HTTP Logs 页面 →')
    fireEvent.click(httpLogsBtn)
    expect(calls.includes('navigate:debug.http-logs')).toBe(true)

    // Test navigation to Test Sources
    const testSourcesBtn = getByText('进入音源测试 →')
    fireEvent.click(testSourcesBtn)
    expect(calls.includes('navigate:sources.test')).toBe(true)

    // Test navigation to Inspector
    const inspectorBtn = getByText('打开架构拓扑 (Inspector) →')
    fireEvent.click(inspectorBtn)
    expect(calls.includes('navigate:inspector.panel')).toBe(true)

    // Test back button
    const backBtn = getByText('← 返回设置')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:settings.view')).toBe(true)
  })

  it('renders SettingsScreen and navigates to import sources, history, and debug', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText, queryByText } = render(h(SettingsScreen, { ctx }))

    expect(await findByText('常规与界面语言')).toBeTruthy()

    // Test navigation to Import Sources (in sources tab)
    const sourcesTab = await findByText('曲库与来源')
    fireEvent.click(sourcesTab)
    const importSourcesBtn = getByText('导入音源')
    fireEvent.click(importSourcesBtn)
    expect(calls.includes('navigate:sources.import')).toBe(true)

    // Playback history was moved out of settings into more-menu
    expect(queryByText('查看播放历史')).toBeNull()

    // Test navigation to Debug center (revealed via Advanced Settings in About tab)
    const aboutTab = await findByText('关于应用')
    fireEvent.click(aboutTab)
    const advCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    if (advCheckbox) fireEvent.click(advCheckbox)
    const debugBtn = getByText('进入 Debug 调试中心 →')
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
      expect(await findByText('调试与诊断 (Debug)')).toBeTruthy()
      expect(getByText('生产环境 (Production)')).toBeTruthy()
    } finally {
      globalThis.process = originalProcess
    }
  })

  it('renders LogsScreen and handles actions', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(LogsScreen, { ctx }))

    expect(await findByText('系统日志 (Discover Logs)')).toBeTruthy()
    expect(await findByText('kernel: cordis booted successfully')).toBeTruthy()

    // Test clear logs
    const clearBtn = getByText('清空日志')
    fireEvent.click(clearBtn)
    expect(calls.includes('clearLogBuffer')).toBe(true)

    // Test back button
    const backBtn = getByText('← 返回调试')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)
  })

  it('renders HttpLogsScreen and displays HTTP requests', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(HttpLogsScreen, { ctx }))

    expect(await findByText('第三方源 HTTP 日志 (HTTP Logs)')).toBeTruthy()
    expect(await findByText('https://api.example.com/search?q=test')).toBeTruthy()
    expect(getByText('GET')).toBeTruthy()
    expect(getByText('200')).toBeTruthy()

    // Test back button
    const backBtn = getByText('← 返回调试')
    fireEvent.click(backBtn)
    expect(calls.includes('navigate:debug.view')).toBe(true)
  })

  it('renders Now Playing styles in PlaybackSection and allows switching active style', async () => {
    const { ctx, calls } = await harness()
    const { getByText, getByTestId, findByText } = render(h(SettingsScreen, { ctx }))

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(getByText('播放页样式模板 (Now Playing Layout Styles)')).toBeTruthy()
    expect(getByText('经典')).toBeTruthy()
    expect(getByText('映画歌词')).toBeTruthy()
    expect(getByText('沉浸封面')).toBeTruthy()
    expect(getByText('黑胶唱片')).toBeTruthy()
    expect(getByText('左右分栏')).toBeTruthy()

    // Select cinematic style
    const cinematicCard = getByTestId('now-playing-style-cinematic')
    expect(cinematicCard).toBeTruthy()
    fireEvent.click(cinematicCard)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('"nowPlayingStyle":"cinematic"'))).toBe(true)
      expect(calls.includes('nowPlaying:setStyle:cinematic')).toBe(true)
    })
  })

  it('imports sandboxed player plugin and handles deletion in PlaybackSection', async () => {
    const { ctx, calls } = await harness()
    const { getByText, getByTestId, findByText } = render(h(SettingsScreen, { ctx }))

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    // Open import modal
    const importBtn = getByTestId('import-style-button')
    fireEvent.click(importBtn)
    expect(getByText('导入外部播放页样式插件')).toBeTruthy()
    expect(getByText('沙箱隔离保障：')).toBeTruthy()

    // Try submitting empty JSON -> error
    const submitBtn = getByTestId('submit-import-style')
    fireEvent.click(submitBtn)
    expect(getByTestId('import-style-error')).toBeTruthy()
    expect(getByTestId('import-style-error').textContent).toContain('请输入或选择播放页模板插件 JSON 清单')

    // Click load sample template button
    const loadSampleBtn = getByTestId('load-sample-template-button')
    fireEvent.click(loadSampleBtn)

    const textarea = getByTestId('style-manifest-textarea') as HTMLTextAreaElement
    expect(textarea.value).toContain('sample-neon-player')
    expect(textarea.value).toContain('霓虹沙箱播放器')

    // Submit valid sample template
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('nowPlaying:register:sample-neon-player'))).toBe(true)
      expect(calls.some((c) => c.includes('"nowPlayingStyle":"sample-neon-player"'))).toBe(true)
      expect(calls.includes('nowPlaying:setStyle:sample-neon-player')).toBe(true)
    })

    // Verify imported style card rendered with sandboxed badge
    expect(getByText('霓虹沙箱播放器')).toBeTruthy()
    expect(getByText('沙箱 🛡️')).toBeTruthy()

    // Delete custom style
    const deleteBtn = getByTestId('delete-style-sample-neon-player')
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(calls.includes('nowPlaying:remove:sample-neon-player')).toBe(true)
    })
  })

  it('manages third-party lyric sources and audio source policy in LyricsSection', async () => {
    const { ctx, calls } = await harness()
    const { getByText, findByText } = render(h(SettingsScreen, { ctx }))

    const lyricsTab = await findByText('桌面歌词')
    fireEvent.click(lyricsTab)

    // LyricSourcesSection is mounted in LyricsSection
    expect(await findByText('第三方歌词源管理 (Lyric Sources)')).toBeTruthy()
    expect(getByText('LRCLIB (默认歌词源)')).toBeTruthy()
    expect(getByText('内置源')).toBeTruthy()

    // Test audio sources policy section
    expect(getByText('音频源歌词策略 (Audio Source Policy)')).toBeTruthy()
    expect(getByText('Bilibili Music')).toBeTruthy()

    // Toggle audio source needsLyricSource
    const audioSwitch = document.querySelector('button[aria-label*="Bilibili Music"]') as HTMLElement
    expect(audioSwitch).toBeTruthy()
    fireEvent.click(audioSwitch)
    expect(calls).toContain('sources:setNeedsLyricSource:mock-bili:true')

    // Open import modal
    const importBtn = getByText('导入歌词源')
    fireEvent.click(importBtn)
    expect(getByText('导入第三方歌词源')).toBeTruthy()
    expect(getByText('严格沙箱隔离保护：')).toBeTruthy()

    // Click load sample template
    const sampleBtn = getByText('载入示例源模板')
    fireEvent.click(sampleBtn)

    // Submit import
    const confirmBtn = getByText('确认导入')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.startsWith('lyricSources:register:sample-netease-lrc'))).toBe(true)
    })
  })

  it('renders plugins partition, filters by query, expands card details, and toggles enablement', async () => {
    const { ctx, calls } = await harness()
    const { container, findByText, getByText, getAllByText, getByPlaceholderText, queryByText } = render(h(SettingsScreen, { ctx }))

    const pluginsTab = await findByText('插件')
    fireEvent.click(pluginsTab)

    expect(await findByText('核心 (core)')).toBeTruthy()
    expect(getByText('日志 (logs)')).toBeTruthy()
    expect(getByText('功能 (feature)')).toBeTruthy()
    expect(getByText('界面 (ui)')).toBeTruthy()

    // Test search filter
    const searchInput = getByPlaceholderText('搜索插件…')
    fireEvent.change(searchInput, { target: { value: 'theme' } })

    expect(getByText('主题管理')).toBeTruthy()
    expect(queryByText('音频核心')).toBeNull()

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(await findByText('音频核心')).toBeTruthy()

    // Expand plugin card for details
    const themeCardChevron = container.querySelector('[role="button"][aria-label^="展开 主题管理"]') as HTMLElement
    expect(themeCardChevron).toBeTruthy()
    fireEvent.click(themeCardChevron)

    // Key-value details
    expect(getByText('完整名称')).toBeTruthy()
    expect(getAllByText(/@BBeBee\/plugin-theme/).length).toBeGreaterThanOrEqual(2)
    expect(getByText('依赖 (1)')).toBeTruthy()
    expect(getByText('被依赖 (2)')).toBeTruthy()

    // Switch enablement toggle: trying to disable theme management which has active dependents triggers confirmation
    const themeSwitch = container.querySelector('button[role="switch"]') as HTMLButtonElement
    expect(themeSwitch).toBeTruthy()
    fireEvent.click(themeSwitch)

    // Confirmation sheet opens
    expect(await findByText('停用插件确认')).toBeTruthy()
    expect(getAllByText(/设置中心/).length).toBeGreaterThanOrEqual(2)

    // Confirm disable
    const confirmBtn = container.querySelector('[data-testid="confirm-disable-plugin-btn"]') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(calls.includes('pluginManager:setEnabled:@BBeBee/plugin-theme:false')).toBe(true)
    })
  })
})
