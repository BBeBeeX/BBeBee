import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

function Switch({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': accessibilityLabel,
      disabled,
      onClick: () => {
        if (!disabled) onChange(!checked)
      },
      style: {
        width: 42,
        height: 24,
        borderRadius: 12,
        padding: 2,
        background: checked ? 'var(--accent-base, #5F87FF)' : 'var(--switch-off-bg, rgba(255, 255, 255, 0.15))',
        border: checked ? '1px solid transparent' : '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        transition: 'background 0.2s ease',
        flexShrink: 0,
        outline: 'none',
      },
    },
    h('div', {
      style: {
        width: 20,
        height: 20,
        borderRadius: 10,
        background: '#FFFFFF',
        transform: checked ? 'translateX(18px)' : 'translateX(0)',
        transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
      },
    }),
  )
}

function SectionWrapper({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}): ReactElement {
  return h(
    'section',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 32,
        scrollMarginTop: 24,
      },
    },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        title,
      ),
      description
        ? h(
            'p',
            {
              style: {
                fontSize: 12,
                color: '#8E8E93',
                margin: '3px 0 0',
                lineHeight: 1.4,
              },
            },
            description,
          )
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '2px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
        },
      },
      children,
    ),
  )
}

function RowWrapper({
  title,
  description,
  action,
  isNested = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
  borderBottom = true,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  isNested?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  children?: React.ReactNode
  borderBottom?: boolean
}): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderBottom: borderBottom ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isNested ? '12px 16px 12px 28px' : '14px 4px',
          gap: 16,
          background: isNested ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
          borderLeft: isNested ? '2px solid rgba(255, 255, 255, 0.15)' : 'none',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
          },
        },
        expandable
          ? h(
              'button',
              {
                type: 'button',
                onClick: onToggleExpand,
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: '#8E8E93',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                },
              },
              '▶',
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--bb-text-primary, #FFFFFF)' } }, title),
          description
            ? h('span', { style: { fontSize: 12, color: '#8E8E93', lineHeight: 1.4 } }, description)
            : null,
        ),
      ),
      action ? h('div', { style: { flexShrink: 0 } }, action) : null,
    ),
    expandable && expanded && children ? children : null,
  )
}

export function DspSettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const { chain, latencyMs, setEnabled, applyPreset, getParams, setParam } = useDsp(ctx)
  const [eqExpanded, setEqExpanded] = useState(true)
  const [compExpanded, setCompExpanded] = useState(true)
  const [reverbExpanded, setReverbExpanded] = useState(true)

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')

  const compParams = getParams('compressor')
  const reverbParams = getParams('reverb')

  return h(
    SectionWrapper,
    {
      title: '音频效果与均衡器 (DSP)',
      description: '图示均衡器、动态压缩与空间混响调音面板',
    },
    // 1. EQ
    h(
      RowWrapper,
      {
        title: '10 频段图示均衡器 (10-Band EQ)',
        description: '调整各频段增益，塑造更加适合耳机或音响的声音曲线',
        expandable: eqEntry?.enabled ?? false,
        expanded: eqExpanded,
        onToggleExpand: () => setEqExpanded((prev) => !prev),
        action: h(Switch, {
          checked: eqEntry?.enabled ?? false,
          accessibilityLabel: '启用 10 频段均衡器',
          onChange: (checked) => void setEnabled('eq10', checked),
        }),
      },
      eqEntry?.enabled
        ? h(RowWrapper, {
            isNested: true,
            title: '均衡器预设风格',
            description: '快速切换平直、低音增强、清晰人声等调音风格',
            borderBottom: false,
            action: h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              [
                { id: '原声 (Flat)', label: '原声' },
                { id: '低音增强 (Bass Boost)', label: '低音增强' },
                { id: '清晰人声 (Vocal)', label: '清晰人声' },
                { id: '清亮高音 (Treble)', label: '清亮高音' },
              ].map((p) =>
                h(Button, {
                  key: p.id,
                  variant: 'secondary',
                  onPress: () => void applyPreset('eq10', p.id),
                  children: p.label,
                }),
              ),
            ),
          })
        : null,
    ),
    // 2. Compressor
    h(
      RowWrapper,
      {
        title: '动态范围压缩器 (Compressor)',
        description: '抑制突发的高音量并提升微弱细节，平抑动态范围',
        expandable: compEntry?.enabled ?? false,
        expanded: compExpanded,
        onToggleExpand: () => setCompExpanded((prev) => !prev),
        action: h(Switch, {
          checked: compEntry?.enabled ?? false,
          accessibilityLabel: '启用动态压缩器',
          onChange: (checked) => void setEnabled('compressor', checked),
        }),
      },
      compEntry?.enabled
        ? h(
            'div',
            null,
            h(RowWrapper, {
              isNested: true,
              title: '压缩模式风格',
              description: '选择适合夜间收听或强劲动态的压缩曲线',
              action: h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [
                  { id: '夜间模式 (Night Mode)', label: '🌙 夜间模式' },
                  { id: '温和顺滑 (Subtle)', label: '温和顺滑' },
                  { id: '强劲动态 (Heavy)', label: '强劲动态' },
                ].map((p) =>
                  h(Button, {
                    key: p.id,
                    variant: 'secondary',
                    onPress: () => void applyPreset('compressor', p.id),
                    children: p.label,
                  }),
                ),
              ),
            }),
            h(RowWrapper, {
              isNested: true,
              title: '压缩阈值 (Threshold)',
              description: `触发压缩的信号电平上限: ${compParams.threshold ?? -24} dB`,
              borderBottom: false,
              action: h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Number(compParams.threshold ?? -24) + 60,
                    max: 60,
                    accessibilityLabel: '压缩阈值',
                    onChange: (v) => void setParam('compressor', 'threshold', Math.round(v - 60)),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  `${compParams.threshold ?? -24}dB`,
                ),
              ),
            }),
          )
        : null,
    ),
    // 4. Reverb
    h(
      RowWrapper,
      {
        title: '空间混响效果 (Reverb)',
        description: '合成自然空间声学反射与混响尾音，营造沉浸式空间氛围',
        expandable: reverbEntry?.enabled ?? false,
        expanded: reverbExpanded,
        onToggleExpand: () => setReverbExpanded((prev) => !prev),
        action: h(Switch, {
          checked: reverbEntry?.enabled ?? false,
          accessibilityLabel: '启用空间混响',
          onChange: (checked) => void setEnabled('reverb', checked),
        }),
      },
      reverbEntry?.enabled
        ? h(
            'div',
            null,
            h(RowWrapper, {
              isNested: true,
              title: '混响空间类型',
              description: '切换不同声学空间的脉冲反射模型',
              action: h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [
                  { id: '小型房间 (Small Room)', label: '小型房间' },
                  { id: '音乐大厅 (Concert Hall)', label: '音乐大厅' },
                  { id: '板式混响 (Plate)', label: '板式混响' },
                ].map((p) =>
                  h(Button, {
                    key: p.id,
                    variant: 'secondary',
                    onPress: () => void applyPreset('reverb', p.id),
                    children: p.label,
                  }),
                ),
              ),
            }),
            h(RowWrapper, {
              isNested: true,
              title: '混响干湿比 (Mix)',
              description: `湿声比例: ${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
              borderBottom: false,
              action: h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
                    max: 100,
                    accessibilityLabel: '混响比例',
                    onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  `${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
                ),
              ),
            }),
          )
        : null,
    ),
    // 5. Open full DSP screen button
    h(RowWrapper, {
      title: '高级效果器调音与编排',
      description: `当前效果链包含 ${chain.length} 个处理节点，延迟: ${latencyMs}ms`,
      borderBottom: false,
      action: h(Button, {
        children: '打开音效面板 →',
        onPress: () => {
          serviceOf<UiService>(ctx, 'ui')?.navigate?.('dsp.view')
        },
      }),
    }),
  )
}
