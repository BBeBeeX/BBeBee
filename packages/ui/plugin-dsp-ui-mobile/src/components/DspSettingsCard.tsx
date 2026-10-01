import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import { Button, Slider, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

const p = () => palettes.dark

export function DspSettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { chain, latencyMs, setEnabled, applyPreset, getParams, setParam } = useDsp(ctx)

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const normEntry = chain.find((c) => c.effectId === 'normalize')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')
  const reverbParams = getParams('reverb')

  const renderSectionHeader = (title: string, subtitle?: string) =>
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2], marginTop: tokens.space[4] } },
      h(Text, { variant: 'sm', tone: 'accent', children: title }),
      subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
    )

  const renderCard = (children: ReactNode[]) =>
    h(
      native.View as never,
      {
        style: {
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          borderRadius: tokens.radius.md,
          padding: tokens.space[3],
          gap: tokens.space[3],
        },
      },
      ...children,
    )

  const renderRow = (title: string, description: string | undefined, control: ReactNode) =>
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[3],
        },
      },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'md', children: title }),
        description ? h(Text, { variant: 'xs', tone: 'muted', children: description }) : null,
      ),
      control,
    )

  const renderToggle = (checked: boolean, onToggle: () => void) =>
    h(
      native.Pressable as never,
      {
        onPress: onToggle,
        style: {
          width: 48,
          height: 26,
          borderRadius: 13,
          backgroundColor: checked ? p().accent.base : 'rgba(255, 255, 255, 0.15)',
          justifyContent: 'center',
          padding: 2,
        },
      },
      h(native.View as never, {
        style: {
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#ffffff',
          transform: [{ translateX: checked ? 22 : 0 }],
        },
      }),
    )

  return h(
    native.View as never,
    null,
    renderSectionHeader('音频效果与均衡器 (DSP)', '图示均衡器、响度标准化、动态压缩与空间混响'),
    renderCard([
      // 1. EQ
      renderRow(
        '10 频段均衡器 (EQ)',
        '调节各频段增益，塑造适宜听感',
        renderToggle(eqEntry?.enabled ?? false, () =>
          void setEnabled('eq10', !(eqEntry?.enabled ?? false)),
        ),
      ),
      eqEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: '原声 (Flat)', label: '原声' },
              { id: '低音增强 (Bass Boost)', label: '低音' },
              { id: '清晰人声 (Vocal)', label: '人声' },
              { id: '清亮高音 (Treble)', label: '高音' },
            ].map((preset) =>
              h(Button, {
                key: preset.id,
                variant: 'secondary',
                onPress: () => void applyPreset('eq10', preset.id),
                children: preset.label,
              }),
            ),
          )
        : null,

      // 2. Normalize
      renderRow(
        '音量响度标准化 (Normalize)',
        '消除不同曲目之间的音量落差',
        renderToggle(normEntry?.enabled ?? false, () =>
          void setEnabled('normalize', !(normEntry?.enabled ?? false)),
        ),
      ),
      normEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: '流媒体标准 (-14 LUFS)', label: '流媒体 (-14)' },
              { id: '古典安静 (-18 LUFS)', label: '古典 (-18)' },
              { id: '高响度 (-11 LUFS)', label: '高响度 (-11)' },
            ].map((preset) =>
              h(Button, {
                key: preset.id,
                variant: 'secondary',
                onPress: () => void applyPreset('normalize', preset.id),
                children: preset.label,
              }),
            ),
          )
        : null,

      // 3. Compressor
      renderRow(
        '动态压缩器 (Compressor)',
        '抑制大爆发音量，提升微弱细节',
        renderToggle(compEntry?.enabled ?? false, () =>
          void setEnabled('compressor', !(compEntry?.enabled ?? false)),
        ),
      ),
      compEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: '夜间模式 (Night Mode)', label: '夜间模式' },
              { id: '温和顺滑 (Subtle)', label: '温和顺滑' },
              { id: '强劲动态 (Heavy)', label: '强劲动态' },
            ].map((preset) =>
              h(Button, {
                key: preset.id,
                variant: 'secondary',
                onPress: () => void applyPreset('compressor', preset.id),
                children: preset.label,
              }),
            ),
          )
        : null,

      // 4. Reverb
      renderRow(
        '空间混响效果 (Reverb)',
        '合成自然空间反射与混响尾音',
        renderToggle(reverbEntry?.enabled ?? false, () =>
          void setEnabled('reverb', !(reverbEntry?.enabled ?? false)),
        ),
      ),
      reverbEntry?.enabled
        ? h(
            native.View as never,
            { style: { gap: tokens.space[1] } },
            h(
              native.View as never,
              { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
              [
                { id: '小型房间 (Small Room)', label: '小型房间' },
                { id: '音乐大厅 (Concert Hall)', label: '音乐大厅' },
                { id: '板式混响 (Plate)', label: '板式混响' },
              ].map((preset) =>
                h(Button, {
                  key: preset.id,
                  variant: 'secondary',
                  onPress: () => void applyPreset('reverb', preset.id),
                  children: preset.label,
                }),
              ),
            ),
            h(Text, {
              variant: 'xs',
              tone: 'muted',
              children: `混响比例: ${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
            }),
            h(Slider, {
              value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
              max: 100,
              accessibilityLabel: '混响比例',
              onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
            }),
          )
        : null,

      // 5. Advanced Panel Link
      renderRow(
        '高级效果器调音与编排',
        `处理节点: ${chain.length} · 延迟: ${latencyMs}ms`,
        h(Button, {
          children: '效果器面板',
          onPress: () => {
            ctx.ui?.navigate?.('dsp.view')
          },
        }),
      ),
    ]),
  )
}
