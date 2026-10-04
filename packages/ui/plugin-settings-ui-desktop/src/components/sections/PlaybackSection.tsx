import { createElement as h, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, AudioService, EffectParamValue, OutputDevice, SettingsContribution, UiService } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { Select } from '../Select.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'
import { Switch } from '../Switch.js'
import { NowPlayingStylesSection } from './NowPlayingStylesSection.js'

export interface PlaybackSectionProps {
  ctx: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  contributions?: readonly SettingsContribution[]
  onNavigate?: (route: string) => void
  chain?: readonly { effectId: string; enabled: boolean }[]
  latencyMs?: number
  setEnabled?: (effectId: string, enabled: boolean) => Promise<void>
  applyPreset?: (effectId: string, presetId: string) => Promise<void>
  getParams?: (effectId: string) => Record<string, unknown>
  setParam?: (effectId: string, key: string, value: EffectParamValue) => Promise<void>
}

export function PlaybackSection({
  ctx,
  settings,
  update,
  contributions = [],
  onNavigate,
  chain,
  latencyMs = 0,
  setEnabled,
  applyPreset,
  getParams,
  setParam,
}: PlaybackSectionProps): ReactElement {
  const [crossfadeExpanded, setCrossfadeExpanded] = useState(true)
  const [eqExpanded, setEqExpanded] = useState(true)
  const [compExpanded, setCompExpanded] = useState(true)
  const [reverbExpanded, setReverbExpanded] = useState(true)
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([])
  const [engineStatus, setEngineStatus] = useState<{ running: boolean; mpvAvailable: boolean } | undefined>(
    undefined,
  )
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchDevices = useCallback(async (reason = 'mount') => {
    ctx.logger?.info('playback-settings: fetchDevices started (reason: %s)', reason)
    try {
      const audio = serviceOf<AudioService>(ctx, 'audio')
      if (!audio?.listOutputDevices) {
        ctx.logger?.warn('playback-settings: audio service or listOutputDevices is unavailable')
        return
      }
      const list = await audio.listOutputDevices()
      ctx.logger?.info(
        'playback-settings: listOutputDevices returned %d devices: %s',
        list?.length ?? 0,
        JSON.stringify(list?.map((d) => ({ id: d.id, label: d.label, isDefault: d.isDefault, isVirtual: (d as { isVirtual?: boolean }).isVirtual }))),
      )
      if (mountedRef.current && Array.isArray(list) && list.length > 0) {
        setOutputDevices(list)
        return
      }
      if (mountedRef.current) {
        ctx.logger?.warn('playback-settings: listOutputDevices returned empty or non-array list')
      }
    } catch (err) {
      ctx.logger?.error('playback-settings: listOutputDevices failed: %s', String(err))
    }
  }, [ctx])

  const fetchEngineStatus = useCallback(async () => {
    try {
      const audio = serviceOf<AudioService>(ctx, 'audio')
      const status = await audio?.getEngineStatus?.()
      if (mountedRef.current && status) {
        setEngineStatus(status)
      }
    } catch {
      // keep the last known status; a failed probe is not a crash
    }
  }, [ctx])

  useEffect(() => {
    void fetchDevices('mount')
    void fetchEngineStatus()

    let offRouteChange: (() => void) | undefined
    try {
      const audio = serviceOf<AudioService>(ctx, 'audio')
      offRouteChange = audio?.onRouteChange?.((ev) => {
        ctx.logger?.info('playback-settings: audio route-changed event received (reason: %s)', ev.reason)
        void fetchDevices('route-change')
      })
    } catch {
      // ignore
    }

    const media = (globalThis as {
      navigator?: { mediaDevices?: { addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void } }
    }).navigator?.mediaDevices

    const onDeviceChange = () => {
      ctx.logger?.info('playback-settings: navigator.mediaDevices devicechange event received')
      void fetchDevices('devicechange')
    }

    const offEngineChange = ctx.on('audio/engine-changed', () => {
      ctx.logger?.info('playback-settings: audio engine-changed event received')
      void fetchDevices('engine-changed')
      void fetchEngineStatus()
    })

    if (media?.addEventListener && media?.removeEventListener) {
      media.addEventListener('devicechange', onDeviceChange)
      return () => {
        offRouteChange?.()
        offEngineChange()
        media.removeEventListener?.('devicechange', onDeviceChange)
      }
    }
    return () => {
      offRouteChange?.()
      offEngineChange()
    }
  }, [ctx, fetchDevices, fetchEngineStatus])

  const eqEntry = chain?.find((c) => c.effectId === 'eq10')
  const compEntry = chain?.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain?.find((c) => c.effectId === 'reverb')

  const compParams = getParams ? getParams('compressor') : {}
  const reverbParams = getParams ? getParams('reverb') : {}

  const playbackContribs = (contributions ?? []).filter(
    (c) => c.section === 'playback' || c.section === 'audio',
  )
  const hasDspContribution = playbackContribs.some(
    (c) => c.id === 'settings.dsp' || c.id === 'dsp.view',
  )
  const hasVisualizerContribution = playbackContribs.some(
    (c) => c.id === 'visualizer.settings',
  )

  const VisualizerSettingsView = useServiceState(ctx, ['ui/changed'], () => {
    return (ctx.ui?.viewFor?.('visualizer.settings') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

  const currentEngine = settings.audioOutputEngine ?? 'mpv'
  const isMpv = currentEngine === 'mpv' || currentEngine === 'wasapi'
  const currentDeviceId = settings.audioOutputDeviceId ?? 'default'

  useEffect(() => {
    void fetchDevices(`engine-${currentEngine}`)
    void fetchEngineStatus()
  }, [currentEngine, fetchDevices, fetchEngineStatus])

  useEffect(() => {
    if (
      !isMpv &&
      currentDeviceId &&
      currentDeviceId !== 'default' &&
      (currentDeviceId.includes('MMDEVAPI') ||
        currentDeviceId.includes('{0.0.') ||
        currentDeviceId.startsWith('SWD\\') ||
        currentDeviceId.startsWith('hw:'))
    ) {
      ctx.logger?.warn(
        'playback-settings: invalid/native OS deviceId "%s" found in settings, resetting to "default"',
        currentDeviceId,
      )
      void update({ audioOutputDeviceId: 'default' })
      void serviceOf<AudioService>(ctx, 'audio')?.setOutputDevice?.('default').catch((err) => {
        ctx.logger?.error('playback-settings: failed to set output device to default: %s', String(err))
      })
    }
  }, [currentDeviceId, isMpv, update, ctx])

  const isGenericPlaceholder = (text: string): boolean => {
    if (!text) return true
    const t = text.trim()
    return (
      t === '' ||
      t === '音频输出设备' ||
      t.startsWith('音频输出设备 (') ||
      t === '系统默认音频设备 (System Default)' ||
      t === '系统默认音频设备' ||
      t === '系统默认音频终端 (WASAPI Exclusive)' ||
      t === '默认音频终端 (WASAPI Exclusive)' ||
      t === '系统默认音频输出 (System Default)' ||
      t === '默认音频设备' ||
      t === 'Default Audio Device' ||
      t === 'Audio Output Device'
    )
  }

  const formatDeviceLabel = (label: string, id?: string, isVirtual?: boolean): string => {
    let clean = (label || '')
      .replace(/^(默认\s*[-–:：]\s*|Default\s*[-–:：]\s*|系统默认\s*[-–:：]\s*)/i, '')
      .replace(/\s*\((System Default|默认)\)$/i, '')
      .trim()

    if (isGenericPlaceholder(clean)) {
      const realDevice = outputDevices.find((o) => !isGenericPlaceholder(o.label))
      if (realDevice?.label) {
        clean = realDevice.label
          .replace(/^(默认\s*[-–:：]\s*|Default\s*[-–:：]\s*|系统默认\s*[-–:：]\s*)/i, '')
          .replace(/\s*\((System Default|默认)\)$/i, '')
          .trim()
      }
    }

    if (isGenericPlaceholder(clean)) {
      clean = '音频输出设备'
    }

    const virtualDetected =
      isVirtual ||
      /voicemeeter|vb-audio|vbaudio|virtual|虚拟|todesk|steam streaming|sonar|null sink|null-sink|null_sink|loopback|blackhole|soundflower|obs|easyeffects|pulseeffects|scream|discord/i.test(
        `${clean} ${id || ''}`,
      )

    clean = clean.replace(/\s*(\(虚拟\)|\[虚拟\])\s*$/g, '').trim()
    if (virtualDetected && clean !== '音频输出设备') {
      clean = `${clean} (虚拟)`
    }
    return clean
  }

  const rawList = outputDevices.length > 0 ? outputDevices : [{ id: 'default', label: '音频输出设备', isDefault: true }]

  const deviceOptions: Array<{ value: string; label: string }> = []
  const seenLabels = new Set<string>()

  for (const d of rawList) {
    const formatted = formatDeviceLabel(d.label, d.id, (d as { isVirtual?: boolean }).isVirtual)
    if (!seenLabels.has(formatted) || d.id === currentDeviceId) {
      seenLabels.add(formatted)
      deviceOptions.push({
        value: d.id,
        label: formatted,
      })
    }
  }

  // Ensure currentDeviceId is included in options so Select always renders a valid selection
  if (!deviceOptions.some((o) => o.value === currentDeviceId)) {
    const fallbackLabel = deviceOptions[0]?.label || '音频输出设备'
    deviceOptions.unshift({
      value: currentDeviceId,
      label: currentDeviceId === 'default' ? fallbackLabel : `指定设备 (${currentDeviceId})`,
    })
  }

  const selectedDeviceLabel =
    deviceOptions.find((o) => o.value === currentDeviceId)?.label || currentDeviceId

  return h(
    'div',
    { id: 'section-playback' },
    h(NowPlayingStylesSection, { ctx, settings, update }),
    h(
      SettingsSection,
      {
        title: '音频输出引擎与设备',
        description: '选择音频输出驱动与物理输出设备',
      },
      h(SettingsRow, {
        title: '音频输出驱动 (Audio Backend)',
        description:
          isMpv
            ? '当前：MPV（独立原生引擎，WASAPI 直通输出与原生 DSP/EQ）'
            : '当前：WebAudio（标准 Web Audio 共享混音）',
        action: h(
          'div',
          { style: { display: 'flex', gap: 6 } },
          h(Button, {
            variant: isMpv ? 'primary' : 'secondary',
            onPress: () => {
              ctx.logger?.info('playback-settings: user clicked backend switch -> mpv')
              void update({ audioOutputEngine: 'mpv' })
              void fetchDevices('engine-switch')
            },
            children: 'MPV Hi-Fi',
          }),
          h(Button, {
            variant: currentEngine === 'webaudio' ? 'primary' : 'secondary',
            onPress: () => {
              ctx.logger?.info('playback-settings: user clicked backend switch -> webaudio')
              void update({ audioOutputEngine: 'webaudio' })
              void fetchDevices('engine-switch')
            },
            children: 'WebAudio',
          }),
        ),
      }),
      isMpv &&
        h(SettingsRow, {
          title: '独占模式 (Exclusive Mode)',
          description: settings.audioExclusive
            ? '已开启：MPV 独占音频输出设备（WASAPI 独占），提供位完美音频输出，其他应用程序在此期间将无法发声'
            : '已关闭：与其他应用程序共享音频输出设备（WASAPI 共享模式）',
          action: h(Switch, {
            checked: settings.audioExclusive ?? false,
            accessibilityLabel: '独占模式',
            onChange: (checked: boolean) => {
              ctx.logger?.info('playback-settings: user toggled audioExclusive -> %s', checked)
              void update({ audioExclusive: checked })
              void serviceOf<AudioService>(ctx, 'audio')?.setAudioExclusive?.(checked)?.catch((err) => {
                ctx.logger?.error('playback-settings: setAudioExclusive(%s) failed: %s', checked, String(err))
              })
            },
          }),
        }),
      /*
       * The degradation notice: an engine process that never spawned or a
       * libmpv that failed to load silently falls back to Chromium decode —
       * audible, but with no FFT frames and no native device switching.
       * Without this row the MPV Hi-Fi button above reads as if it were in
       * charge while it is not.
       */
      isMpv &&
        engineStatus &&
        (!engineStatus.running || !engineStatus.mpvAvailable)
        ? h(SettingsRow, {
            title: '⚠️ MPV 原生引擎不可用，已回退到 Chromium 解码',
            description: !engineStatus.running
              ? '原生音频引擎进程未运行（未找到 audio-engine 可执行文件或启动失败）。播放仍可进行，但音频可视化与输出设备切换暂不可用。'
              : '未能加载 libmpv（库文件缺失或依赖不全）。播放仍可进行，但音频可视化与输出设备切换暂不可用。请重新部署引擎目录下的 libmpv 及其全部依赖。',
            borderBottom: false,
          })
        : null,
      h(SettingsRow, {
        title: '音频输出设备 (Output Device)',
        description: `当前输出目的地：${selectedDeviceLabel}`,
        action: h(Select, {
          value: currentDeviceId,
          options: deviceOptions,
          accessibilityLabel: '音频输出设备',
          onChange: (newDeviceId: string) => {
            ctx.logger?.info('playback-settings: user selected output device "%s"', newDeviceId)
            void update({ audioOutputDeviceId: newDeviceId })
            void serviceOf<AudioService>(ctx, 'audio')?.setOutputDevice?.(newDeviceId).catch((err) => {
              ctx.logger?.error('playback-settings: setOutputDevice("%s") failed: %s', newDeviceId, String(err))
            })
          },
        }),
      }),
    ),
    h(
      SettingsSection,
      {
        title: '过渡与衔接',
        description: '连续播放歌曲时的淡入淡出与连接体验',
      },
      h(SettingsRow, {
        title: '无缝播放 (Gapless Playback)',
        description: '在两首歌曲之间消除解码停顿，体验连贯的听歌流动感',
        action: h(Switch, {
          checked: settings.gaplessPlayback,
          accessibilityLabel: '无缝播放',
          onChange: (gaplessPlayback) => void update({ gaplessPlayback }),
        }),
      }),
      h(
        SettingsRow,
        {
          title: '曲目交叉淡入淡出 (Crossfade)',
          description: '上一曲即将结束时提前淡入下一曲',
          expandable: settings.crossfadeEnabled,
          expanded: crossfadeExpanded,
          onToggleExpand: () => setCrossfadeExpanded((prev) => !prev),
          action: h(Switch, {
            checked: settings.crossfadeEnabled,
            accessibilityLabel: '曲目交叉淡入淡出',
            onChange: (crossfadeEnabled) => void update({ crossfadeEnabled }),
          }),
        },
        settings.crossfadeEnabled
          ? h(SettingsRow, {
              isNested: true,
              title: '淡入淡出持续时间',
              description: `持续时长: ${settings.crossfadeDurationSeconds} 秒`,
              borderBottom: false,
              action: h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: settings.crossfadeDurationSeconds,
                    max: 10,
                    accessibilityLabel: '淡入淡出持续时间',
                    onChange: (sec) =>
                      void update({ crossfadeDurationSeconds: Math.max(1, Math.round(sec)) }),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  `${settings.crossfadeDurationSeconds}s`,
                ),
              ),
            })
          : null,
      ),
      h(SettingsRow, {
        title: '拔出音频设备时自动暂停',
        description: '断开耳机或蓝牙连接时即刻暂停音乐，防止外放打扰',
        borderBottom: false,
        action: h(Switch, {
          checked: settings.pauseOnUnplug,
          accessibilityLabel: '拔出音频设备时自动暂停',
          onChange: (pauseOnUnplug) => void update({ pauseOnUnplug }),
        }),
      }),
    ),
    // Dynamic contributions for 'playback' and 'audio'
    playbackContribs.map((contrib) => {
      if (contrib.display === 'card') {
        const CardView = ctx.ui?.viewFor?.(contrib.id) as React.ComponentType<{ ctx: Context }> | undefined
        if (CardView) {
          return h('div', { key: contrib.id }, h(CardView, { ctx }))
        }
      }
      return h(
        SettingsSection,
        {
          key: contrib.id,
          title: contrib.title,
          description: contrib.description,
        },
        h(SettingsRow, {
          title: contrib.title,
          description: contrib.description,
          borderBottom: false,
          action: h(Button, {
            children: contrib.actionText ?? '打开',
            onPress: () => {
              if (contrib.action) void contrib.action()
              else if (onNavigate) onNavigate(contrib.id)
              else serviceOf<UiService>(ctx, 'ui')?.navigate?.(contrib.id)
            },
          }),
        }),
      )
    }),

    // Fallback: If DSP was not contributed via settings/ui and legacy chain props were passed (e.g. in test harness)
    !hasDspContribution && chain && setEnabled && applyPreset && getParams && setParam
      ? h(
          SettingsSection,
          {
            title: '音频效果与均衡器 (DSP)',
            description: '图示均衡器、响度标准化、动态压缩与空间混响配置',
          },
          h(
            SettingsRow,
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
              ? h(SettingsRow, {
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
          h(
            SettingsRow,
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
                  h(SettingsRow, {
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
                  h(SettingsRow, {
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
          h(
            SettingsRow,
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
                  h(SettingsRow, {
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
                  h(SettingsRow, {
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
          h(SettingsRow, {
            title: '高级效果器调音与编排',
            description: `当前效果链包含 ${chain?.length ?? 0} 个处理节点，延迟: ${latencyMs}ms`,
            borderBottom: false,
            action: h(Button, {
              children: '打开音效面板 →',
              onPress: () => {
                serviceOf<UiService>(ctx, 'ui')?.navigate?.('dsp.view')
              },
            }),
          }),
        )
      : null,

    // Fallback: visualizer if registered in views but not in contributions
    !hasVisualizerContribution && VisualizerSettingsView
      ? h(
          SettingsSection,
          {
            title: '音频可视化',
            description: '在播放界面呈现音乐频率跳动与声波流动效果，自定义显示样式与色彩',
          },
          h(VisualizerSettingsView, { ctx }),
        )
      : null,
  )
}
