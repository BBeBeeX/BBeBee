import { Button, Select, Switch } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, AudioService, OutputDevice, SettingsContribution } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { ContributionBlock } from '../ContributionBlock.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface PlaybackSectionProps {
  ctx: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  contributions?: readonly SettingsContribution[]
  onNavigate?: (route: string) => void
}

export function PlaybackSection({
  ctx,
  settings,
  update,
  contributions = [],
  onNavigate,
}: PlaybackSectionProps): ReactElement {
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

  const playbackContribs = (contributions ?? []).filter(
    (c) => c.section === 'playback' || c.section === 'audio',
  )
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
    // Everything else in this tab belongs to the plugin that contributed it
    // (DSP card, visualizer card, transition fields, ...) — the screen renders
    // descriptors and owns none of them.
    playbackContribs.map((contrib) =>
      h(ContributionBlock, { key: contrib.id, ctx, contribution: contrib, onNavigate }),
    ),
  )
}
