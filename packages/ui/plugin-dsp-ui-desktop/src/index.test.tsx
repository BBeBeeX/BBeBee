// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from '@BBeBee/kernel'
import type { ChainEntry, DspService } from '@BBeBee/protocol'
import { DspScreen } from './DspScreen.js'
import pluginDspUi from './index.js'

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
      displayName: '前级增益 (Preamp)',
      defaultOrder: 10,
    },
    {
      id: 'eq10',
      displayName: '10频段均衡器 (10-Band EQ)',
      defaultOrder: 20,
      presets: [{ name: '原声 (Flat)', params: { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }],
    },
    {
      id: 'limiter',
      displayName: '峰值限制器 (Peak Limiter)',
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
    expect(html).toContain('曲目间音量响度标准化')
    expect(html).toContain('启用音量响度标准化')
  })

  it('renders DspScreen with EQ sliders and titles', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(DspScreen, { ctx }))

    expect(html).toContain('音频效果器与均衡器 (DSP)')
    expect(html).toContain('10 频段均衡器 (EQ)')
    expect(html).toContain('效果链编排 (Effect Chain)')
    expect(html).toContain('处理延迟: 0 ms')
    expect(html).toContain('均衡器')
    expect(html).toContain('预设')
    expect(html).toContain('重置')
    expect(html).toContain('保存预设')
    expect(html).toContain('31Hz')
    expect(html).toContain('16KHz')
    expect(html).toContain('+12dB')
    expect(html).toContain('-12dB')
    expect(html).toContain('已启用')
  })
})
