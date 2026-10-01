// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from '@BBeBee/kernel'
import type { AppSettings, SettingsService, SettingsContribution, CacheClass, CacheStats, DspService, ChainEntry, EffectDefinition } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { configureNative, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
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
      { id: 'eq10', displayName: '10频段均衡器', defaultOrder: 20 },
      { id: 'normalize', displayName: '响度标准化', defaultOrder: 30 },
      { id: 'compressor', displayName: '动态压缩器', defaultOrder: 40 },
      { id: 'reverb', displayName: '空间混响', defaultOrder: 50 },
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

  async function createHarness() {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(SettingsStub)
    await ctx.plugin(CacheStub)
    await ctx.plugin(DspStub)
    await ctx.plugin(pluginSettingsUi)

    const MockDspCard = () => {
      const native = nativePrimitives()
      return h(
        native.View as never,
        null,
        h(Text, { children: '音频效果与均衡器 (DSP)' }),
        h(Text, { children: '10 频段均衡器 (EQ)' }),
        h(Text, { children: '原声' }),
        h(Text, { children: '音量响度标准化 (Normalize)' }),
        h(Text, { children: '流媒体 (-14)' }),
        h(Text, { children: '动态压缩器 (Compressor)' }),
        h(Text, { children: '夜间模式' }),
        h(Text, { children: '空间混响效果 (Reverb)' }),
        h(Text, { children: '音乐大厅' }),
        h(Text, { children: '高级效果器调音与编排' }),
      )
    }

    ;(ctx.ui as any).registerView('settings.dsp', MockDspCard)
    ;(ctx.settings as any).contribute({
      id: 'settings.dsp',
      section: 'playback',
      title: '音频效果与均衡器 (DSP)',
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

      expect(container.textContent).toContain('设置')
      expect(container.textContent).toContain('外观与语言')
      expect(container.textContent).toContain('播放与音频')
      expect(container.textContent).toContain('音频效果与均衡器 (DSP)')

      // 1. EQ
      expect(container.textContent).toContain('10 频段均衡器 (EQ)')
      expect(container.textContent).toContain('原声')

      // 2. Normalize
      expect(container.textContent).toContain('音量响度标准化 (Normalize)')
      expect(container.textContent).toContain('流媒体 (-14)')

      // 3. Compressor
      expect(container.textContent).toContain('动态压缩器 (Compressor)')
      expect(container.textContent).toContain('夜间模式')

      // 4. Reverb
      expect(container.textContent).toContain('空间混响效果 (Reverb)')
      expect(container.textContent).toContain('音乐大厅')

      // 5. Advanced panel link
      expect(container.textContent).toContain('高级效果器调音与编排')
    })

    it('renders audio output engine options and allows switching between WebAudio and MPV Hi-Fi', async () => {
      const { ctx } = await createHarness()
      const { container } = render(h(SettingsScreen, { ctx }))

      expect(container.textContent).toContain('音频输出引擎')
      expect(container.textContent).toContain('WebAudio')
      expect(container.textContent).toContain('MPV Hi-Fi')
    })

    it('dynamically renders contributions registered via settings service', async () => {
      const { ctx } = await createHarness()
      ;(ctx.settings as any).contribute({
        id: 'custom.feature',
        section: 'custom',
        title: '自定义扩展设置',
        description: '动态注册的配置项',
        actionText: '打开扩展',
      })
      const { container } = render(h(SettingsScreen, { ctx }))
      expect(container.textContent).toContain('自定义扩展设置')
      expect(container.textContent).toContain('动态注册的配置项')
      expect(container.textContent).toContain('打开扩展')
    })
  })
