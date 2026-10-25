/**
 * ConverterScreen — the mobile audio conversion workbench.
 *
 * The desktop `ConverterWorkbench`'s three tabs (convert / queue / output) on
 * a phone: chips instead of a tablist, chips instead of selects, and the file
 * picker swapped for the optional `fs.pickFiles` capability. Everything else —
 * the option names, the enqueue payload, the task actions — is the desktop
 * behaviour verbatim, because both feed the same headless service.
 */

import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  AudioConvertOptions,
  AudioFormat,
  CompressionEstimate,
  EncoderCapabilities,
} from '@BBeBee/protocol'
import { Button, nativePrimitives, Text, useI18n } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import {
  useAudioConverterConfig,
  useAudioConverterTasks,
} from '@bbebee/plugin-audio-converter/hooks'
import { StagedFileList, type StagedFileListProps } from './components/StagedFileList.js'
import { FormatOptionsCard } from './components/FormatOptionsCard.js'
import { TaskQueueCard } from './components/TaskQueueCard.js'
import { OutputCard } from './components/OutputCard.js'
import { defaultConvertOptions } from './options.js'
import type { StagedFile } from './pick.js'

const p = () => palettes.dark

export type ConverterTab = 'convert' | 'queue' | 'output'

export interface ConverterScreenProps {
  ctx: Context
  /** Handed to every pushed page by the mobile shell; unused, this screen is a root. */
  onBack?: () => void
}

export function ConverterScreen({ ctx }: ConverterScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const tasks = useAudioConverterTasks(ctx)
  const config = useAudioConverterConfig(ctx)

  const [activeTab, setActiveTab] = useState<ConverterTab>('convert')
  const [files, setFiles] = useState<StagedFile[]>([])
  const [targetFormat, setTargetFormat] = useState<AudioFormat>(config.defaultFormat || 'mp3')
  const [convertOptions, setConvertOptions] = useState<AudioConvertOptions>(() =>
    defaultConvertOptions(config.defaultFormat || 'mp3'),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [capabilities, setCapabilities] = useState<EncoderCapabilities | undefined>(undefined)

  // Encoder capabilities on mount — the desktop workbench's probe, guarded the
  // same way: a service answering slowly or never must not throw in render.
  useEffect(() => {
    let cancelled = false
    const converter = ctx.audioConverter
    void (async () => {
      try {
        const caps = await converter?.getCapabilities?.()
        if (!cancelled && caps) setCapabilities(caps)
      } catch (err) {
        ctx.logger.warn('audio-converter-ui-mobile: capability probe failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ctx])

  const handleFormatChange = (fmt: AudioFormat) => {
    setTargetFormat(fmt)
    setConvertOptions((prev) => ({ ...prev, targetFormat: fmt }))
  }

  // Pre-conversion estimate for the first staged file — same call as desktop.
  // The service is resolved inside, never listed as a dependency: a Cordis
  // proxy in a dep array is the classic resubscribe loop (rules/ui.md §3).
  const estimate: CompressionEstimate | undefined = useMemo(() => {
    const converter = ctx.audioConverter
    if (files.length === 0 || !converter?.estimateCompression) return undefined
    const sample = files[0]!
    return converter.estimateCompression({
      durationMs: sample.durationMs ?? 180_000,
      sourceSize: sample.size,
      targetFormat,
      bitrateKbps: convertOptions.bitrateKbps,
      channels: convertOptions.channels,
      sampleRate: convertOptions.sampleRate,
      sourceFormat: sample.format.toLowerCase(),
    })
  }, [ctx, files, targetFormat, convertOptions])

  const pendingOrProcessing = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'processing',
  )
  const completed = tasks.filter((task) => task.status === 'completed')

  const handleStartConversion = async () => {
    if (files.length === 0 || isSubmitting) return
    setIsSubmitting(true)
    try {
      await ctx.audioConverter.enqueue(
        files.map((file) => ({
          uri: file.uri,
          options: {
            ...convertOptions,
            targetFormat,
            outputDir: config.defaultOutputDir,
          },
        })),
      )
      setFiles([])
      setActiveTab('queue')
    } catch (err) {
      ctx.logger.error('audio-converter-ui-mobile: enqueue failed', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const stagedProps: StagedFileListProps = {
    ctx,
    files,
    onAddFiles: (added) => setFiles((prev) => [...prev, ...added]),
    onRemoveFile: (id) => setFiles((prev) => prev.filter((file) => file.id !== id)),
    onClearFiles: () => setFiles([]),
  }

  const tabChip = (id: ConverterTab, label: string, badge?: number, testID?: string) =>
    h(
      native.Pressable as never,
      {
        key: id,
        onPress: () => setActiveTab(id),
        accessibilityRole: 'tab',
        accessibilityState: { selected: activeTab === id },
        accessibilityLabel: label,
        testID: testID ?? `converter-tab-${id}`,
        style: {
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: tokens.radius.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: activeTab === id ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
        },
      },
      h(Text, { variant: 'sm', tone: activeTab === id ? 'accent' : 'muted' }, label),
      badge && badge > 0
        ? h(
            native.View as never,
            {
              style: {
                paddingHorizontal: 6,
                borderRadius: tokens.radius.pill,
                backgroundColor: p().accent.base,
              },
            },
            h(Text, { variant: 'xs' }, String(badge)),
          )
        : null,
    )

  return h(
    native.View as never,
    {
      testID: 'audio-converter-workbench',
      style: {
        flex: 1,
        backgroundColor: p().bg.base,
        padding: tokens.space[4],
        gap: tokens.space[3],
      },
    },
    // Header
    h(
      native.View as never,
      { style: { gap: 2, paddingBottom: tokens.space[2] } },
      h(Text, { variant: 'lg' }, t('converter:index.title')),
      h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.subtitle')),
      capabilities
        ? h(
            Text,
            { variant: 'xs', tone: 'muted' },
            `${t('converter:index.detectedEncoder')}: ${Object.values(capabilities.encoders).filter((e) => e.available).length}`,
          )
        : null,
    ),

    // Tabs
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[1] } },
      tabChip('convert', t('converter:index.tabConvert'), files.length),
      tabChip('queue', t('converter:index.tabQueue'), pendingOrProcessing.length),
      tabChip('output', t('converter:index.tabOutput'), completed.length),
    ),

    // Tab: Convert
    activeTab === 'convert'
      ? h(
          native.View as never,
          { style: { gap: tokens.space[3] } },
          h(StagedFileList, stagedProps),
          h(FormatOptionsCard, {
            ctx,
            targetFormat,
            options: convertOptions,
            onFormatChange: handleFormatChange,
            onOptionsChange: setConvertOptions,
            estimate,
          }),
          h(
            native.View as never,
            {
              style: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: tokens.space[2],
              },
            },
            h(
              Text,
              { variant: 'sm', tone: 'muted' },
              files.length > 0
                ? `${files.length} ${t('converter:index.filesReady')}`
                : t('converter:index.noFilesSelected'),
            ),
            h(Button, {
              variant: 'primary',
              testID: 'converter-start-btn',
              accessibilityLabel: t('converter:index.startConversion'),
              disabled: files.length === 0 || isSubmitting,
              loading: isSubmitting,
              onPress: () => void handleStartConversion(),
              children: isSubmitting
                ? t('converter:index.submitting')
                : `${t('converter:index.startConversion')} (${files.length})`,
            }),
          ),
        )
      : null,

    // Tab: Queue
    activeTab === 'queue'
      ? h(TaskQueueCard, {
          ctx,
          tasks,
          onCancelTask: (id) => void ctx.audioConverter?.cancelTask(id),
          onRetryTask: (id) => void ctx.audioConverter?.retryTask(id),
          onRemoveTask: (id) => void ctx.audioConverter?.removeTask(id),
          onClearFinished: () => void ctx.audioConverter?.clearFinished(),
        })
      : null,

    // Tab: Output
    activeTab === 'output'
      ? h(OutputCard, {
          ctx,
          tasks,
          onRemoveTask: (id) => void ctx.audioConverter?.removeTask(id),
          onClearFinished: () => void ctx.audioConverter?.clearFinished(),
        })
      : null,
  )
}
