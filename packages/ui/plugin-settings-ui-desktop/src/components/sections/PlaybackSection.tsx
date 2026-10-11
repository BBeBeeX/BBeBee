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
      t === 'Audio output device' ||
      t.startsWith('Audio output device (') ||
      t === 'System default audio device (System Default)' ||
      t === 'System default audio device' ||
      t === 'System default audio endpoint (WASAPI Exclusive)' ||
      t === 'Default audio endpoint (WASAPI Exclusive)' ||
      t === 'System default audio output (System Default)' ||
      t === 'Default audio device' ||
      t === 'Default Audio Device' ||
      t === 'Audio Output Device'
    )
  }

  const formatDeviceLabel = (label: string, id?: string, isVirtual?: boolean): string => {
    // Also strip localized (zh) OS prefixes/suffixes via \u escapes.
    let clean = (label || '')
      .replace(/^(\u9ED8\u8BA4\s*[-–:：]\s*|Default\s*[-–:：]\s*|\u7CFB\u7EDF\u9ED8\u8BA4\s*[-–:：]\s*)/i, '')
      .replace(/\s*\((System Default|\u9ED8\u8BA4)\)$/i, '')
      .trim()

    if (isGenericPlaceholder(clean)) {
      const realDevice = outputDevices.find((o) => !isGenericPlaceholder(o.label))
      if (realDevice?.label) {
        clean = realDevice.label
          .replace(/^(\u9ED8\u8BA4\s*[-–:：]\s*|Default\s*[-–:：]\s*|\u7CFB\u7EDF\u9ED8\u8BA4\s*[-–:：]\s*)/i, '')
          .replace(/\s*\((System Default|\u9ED8\u8BA4)\)$/i, '')
          .trim()
      }
    }

    if (isGenericPlaceholder(clean)) {
      clean = 'Audio output device'
    }

    const virtualDetected =
      isVirtual ||
      /voicemeeter|vb-audio|vbaudio|virtual|\u865A\u62DF|todesk|steam streaming|sonar|null sink|null-sink|null_sink|loopback|blackhole|soundflower|obs|easyeffects|pulseeffects|scream|discord/i.test(
        `${clean} ${id || ''}`,
      )

    clean = clean.replace(/\s*(\(\u865A\u62DF\)|\[\u865A\u62DF\])\s*$/g, '').trim()
    if (virtualDetected && clean !== 'Audio output device') {
      clean = `${clean} (Virtual)`
    }
    return clean
  }

  const rawList = outputDevices.length > 0 ? outputDevices : [{ id: 'default', label: 'Audio output device', isDefault: true }]

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
    const fallbackLabel = deviceOptions[0]?.label || 'Audio output device'
    deviceOptions.unshift({
      value: currentDeviceId,
      label: currentDeviceId === 'default' ? fallbackLabel : `Selected device (${currentDeviceId})`,
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
        title: 'Audio output engine & devices',
        description: 'Choose the audio output driver and physical output device',
      },
      h(SettingsRow, {
        title: 'Audio output driver (Audio Backend)',
        description:
          isMpv
            ? 'Current: MPV (standalone native engine with WASAPI passthrough output and native DSP/EQ)'
            : 'Current: WebAudio (standard Web Audio shared mixing)',
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
          title: 'Exclusive mode',
          description: settings.audioExclusive
            ? 'On: MPV takes exclusive control of the audio output device (WASAPI exclusive) for bit-perfect output; other applications cannot play sound meanwhile'
            : 'Off: shares the audio output device with other applications (WASAPI shared mode)',
          action: h(Switch, {
            checked: settings.audioExclusive ?? false,
            accessibilityLabel: 'Exclusive mode',
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
            title: '⚠️ MPV native engine unavailable, fell back to Chromium decoding',
            description: !engineStatus.running
              ? 'The native audio engine process is not running (audio-engine executable missing or failed to start). Playback still works, but audio visualization and output device switching are unavailable.'
              : 'Failed to load libmpv (library missing or incomplete dependencies). Playback still works, but audio visualization and output device switching are unavailable. Redeploy libmpv and all of its dependencies in the engine directory.',
            borderBottom: false,
          })
        : null,
      h(SettingsRow, {
        title: 'Audio output device (Output Device)',
        description: `Current output destination: ${selectedDeviceLabel}`,
        action: h(Select, {
          value: currentDeviceId,
          options: deviceOptions,
          accessibilityLabel: 'Audio output device',
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
