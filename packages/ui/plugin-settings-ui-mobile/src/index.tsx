/**
 * React Native views for `@BBeBee/plugin-settings`.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@BBeBee/plugin-settings/views'
import { useAppSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'
import { Button, Slider, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function SettingsScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { settings, update, reset } = useAppSettings(ctx)
  const { usage, clear } = useCacheStats(ctx)
  const { chain, latencyMs, setEnabled, applyPreset, getParams, setParam } = useDsp(ctx)
  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const normEntry = chain.find((c) => c.effectId === 'normalize')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')
  const reverbParams = getParams('reverb')
  const [clearingCache, setClearingCache] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      await clear()
    } finally {
      setClearingCache(false)
    }
  }

  const handleReset = async () => {
    try {
      await reset()
    } finally {
      setConfirmingReset(false)
    }
  }

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
    {
      style: {
        flex: 1,
        backgroundColor: p().bg.base,
        padding: tokens.space[4],
      },
      accessibilityLabel: '设置',
    },
    // Screen Title
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2] } },
      h(Text, { variant: 'xl', children: '设置' }),
      h(Text, { variant: 'sm', tone: 'muted', children: '全局应用偏好与播放配置' }),
    ),

    // 1. General Section
    renderSectionHeader('外观与语言', '主题视觉模式及多语言配置'),
    renderCard([
      renderRow(
        '主题模式',
        settings.theme === 'dark' ? '深色模式' : settings.theme === 'light' ? '浅色模式' : '跟随系统',
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
          h(Button, {
            variant: settings.theme === 'dark' ? 'primary' : 'secondary',
            onPress: () => void update({ theme: 'dark' }),
            children: '深色',
          }),
          h(Button, {
            variant: settings.theme === 'light' ? 'primary' : 'secondary',
            onPress: () => void update({ theme: 'light' }),
            children: '浅色',
          }),
          h(Button, {
            variant: settings.theme === 'system' ? 'primary' : 'secondary',
            onPress: () => void update({ theme: 'system' }),
            children: '自动',
          }),
        ),
      ),
      renderRow(
        '界面语言',
        settings.language === 'zh' ? '简体中文' : settings.language === 'en' ? 'English' : '跟随系统',
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
          h(Button, {
            variant: settings.language === 'zh' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'zh' }),
            children: '中文',
          }),
          h(Button, {
            variant: settings.language === 'en' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'en' }),
            children: 'EN',
          }),
          h(Button, {
            variant: settings.language === 'system' ? 'primary' : 'secondary',
            onPress: () => void update({ language: 'system' }),
            children: '自动',
          }),
        ),
      ),
    ]),

    // 2. Playback Section
    renderSectionHeader('播放与音频', '音频流衔接与播放行为'),
    renderCard([
      renderRow(
        '无缝播放 (Gapless)',
        '消除歌曲之间的间隙',
        renderToggle(settings.gaplessPlayback, () =>
          void update({ gaplessPlayback: !settings.gaplessPlayback }),
        ),
      ),
      renderRow(
        '曲目淡入淡出 (Crossfade)',
        '过渡播放时音量平滑交叠',
        renderToggle(settings.crossfadeEnabled, () =>
          void update({ crossfadeEnabled: !settings.crossfadeEnabled }),
        ),
      ),
      settings.crossfadeEnabled
        ? h(
            native.View as never,
            { style: { gap: tokens.space[1] } },
            h(Text, {
              variant: 'xs',
              tone: 'muted',
              children: `淡入淡出持续时间: ${settings.crossfadeDurationSeconds} 秒`,
            }),
            h(Slider, {
              value: settings.crossfadeDurationSeconds,
              max: 10,
              accessibilityLabel: '淡入淡出时间',
              onChange: (sec) => void update({ crossfadeDurationSeconds: Math.max(1, Math.round(sec)) }),
            }),
          )
        : null,
      renderRow(
        '音频输出引擎',
        'WebAudio 系统原生引擎 (iOS CoreAudio / Android Oboe)',
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1] } },
          h(Button, {
            variant: 'primary',
            onPress: () => void update({ audioOutputEngine: 'webaudio' }),
            children: 'WebAudio',
          }),
          h(Button, {
            variant: 'secondary',
            disabled: true,
            onPress: () => {},
            children: 'MPV Hi-Fi (规划中)',
          }),
        ),
      ),
      renderRow(
        '拔出耳机时自动暂停',
        '断开音频设备时自动暂停播放',
        renderToggle(settings.pauseOnUnplug, () =>
          void update({ pauseOnUnplug: !settings.pauseOnUnplug }),
        ),
      ),
    ]),

    // 3. Audio & DSP Section
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
            ].map((p) =>
              h(Button, {
                key: p.id,
                variant: 'secondary',
                onPress: () => void applyPreset('eq10', p.id),
                children: p.label,
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
            ].map((p) =>
              h(Button, {
                key: p.id,
                variant: 'secondary',
                onPress: () => void applyPreset('normalize', p.id),
                children: p.label,
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
            ].map((p) =>
              h(Button, {
                key: p.id,
                variant: 'secondary',
                onPress: () => void applyPreset('compressor', p.id),
                children: p.label,
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
              ].map((p) =>
                h(Button, {
                  key: p.id,
                  variant: 'secondary',
                  onPress: () => void applyPreset('reverb', p.id),
                  children: p.label,
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

    // 4. Storage Section
    renderSectionHeader('存储与缓存', '本地临时文件管理'),
    renderCard([
      renderRow(
        '缓存占用',
        `总计: ${formatBytes(usage.totalBytes)} (封面: ${formatBytes(usage.artworkBytes)})`,
        h(Button, {
          variant: 'secondary',
          disabled: clearingCache || usage.totalBytes === 0,
          loading: clearingCache,
          onPress: handleClearCache,
          children: '清除缓存',
        }),
      ),
    ]),

    // 4. About & Reset Section
    renderSectionHeader('关于应用', '版本及系统重置'),
    renderCard([
      renderRow('版本', 'BBeBee 0.1.0 · Cordis 微内核', null),
      confirmingReset
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', gap: tokens.space[2], justifyContent: 'flex-end' } },
            h(Button, {
              variant: 'primary',
              onPress: handleReset,
              children: '确认重置',
            }),
            h(Button, {
              variant: 'secondary',
              onPress: () => setConfirmingReset(false),
              children: '取消',
            }),
          )
        : h(Button, {
            variant: 'secondary',
            onPress: () => setConfirmingReset(true),
            children: '恢复默认设置',
          }),
    ]),
  )
}

export const name = 'plugin-settings-ui-mobile'
export const inject = ['ui', 'settings']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-settings-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SETTINGS_VIEWS.main, bound(ctx, SettingsScreen))
  }, 'settings-ui-mobile')
}

export default { name, inject, apply }
