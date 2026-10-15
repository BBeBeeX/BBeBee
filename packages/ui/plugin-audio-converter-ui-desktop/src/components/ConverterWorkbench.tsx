/**
 * ConverterWorkbench: Main desktop view for audio format conversion and compression.
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
import { Button, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import {
  useAudioConverterConfig,
  useAudioConverterTasks,
} from '@BBeBee/plugin-audio-converter/hooks'
import { AudioFileList, type SelectedAudioFile } from './AudioFileList.js'
import { FormatSection } from './FormatSection.js'
import { CompressionSection } from './CompressionSection.js'
import { TaskQueueSection } from './TaskQueueSection.js'
import { OutputSection } from './OutputSection.js'
import { SettingsModal } from './SettingsModal.js'

export type ConverterTab = 'convert' | 'queue' | 'output'

export interface ConverterWorkbenchProps {
  ctx: Context
}

export function ConverterWorkbench({ ctx }: ConverterWorkbenchProps): ReactElement {
  const { t } = useI18n(ctx)
  const tasks = useAudioConverterTasks(ctx)
  const config = useAudioConverterConfig(ctx)

  const [activeTab, setActiveTab] = useState<ConverterTab>('convert')
  const [files, setFiles] = useState<SelectedAudioFile[]>([])
  const [targetFormat, setTargetFormat] = useState<AudioFormat>(config.defaultFormat || 'mp3')
  const [convertOptions, setConvertOptions] = useState<AudioConvertOptions>({
    targetFormat: config.defaultFormat || 'mp3',
    preset: 'balanced',
    bitrateKbps: 192,
    sampleRate: 44100,
    channels: 2,
    vbr: false,
    overwrite: false,
  })
  const [capabilities, setCapabilities] = useState<EncoderCapabilities | undefined>(undefined)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch encoder capabilities on mount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (ctx.audioConverter?.getCapabilities) {
          const caps = await ctx.audioConverter.getCapabilities()
          if (!cancelled) setCapabilities(caps)
        }
      } catch (err) {
        ctx.logger.warn?.('Failed to get encoder capabilities:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ctx])

  // Synchronize targetFormat changes
  const handleFormatChange = (fmt: AudioFormat) => {
    setTargetFormat(fmt)
    setConvertOptions((prev) => ({ ...prev, targetFormat: fmt }))
  }

  // Pre-conversion estimate for the first file
  const estimate: CompressionEstimate | undefined = useMemo(() => {
    if (files.length === 0 || !ctx.audioConverter?.estimateCompression) {
      return undefined
    }
    const sample = files[0]!
    return ctx.audioConverter.estimateCompression({
      durationMs: sample.durationMs ?? 180_000,
      sourceSize: sample.size,
      targetFormat,
      bitrateKbps: convertOptions.bitrateKbps,
      channels: convertOptions.channels,
      sampleRate: convertOptions.sampleRate,
      sourceFormat: sample.format.toLowerCase(),
    })
  }, [files, targetFormat, convertOptions, ctx.audioConverter])

  // Task lists
  const pendingOrProcessingTasks = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'processing',
  )
  const completedTasks = tasks.filter((t) => t.status === 'completed')

  // Start conversion
  const handleStartConversion = async () => {
    if (files.length === 0 || isSubmitting) return
    setIsSubmitting(true)
    try {
      const items = files.map((f) => ({
        uri: f.uri,
        options: {
          ...convertOptions,
          targetFormat,
          outputDir: config.defaultOutputDir,
        },
      }))
      await ctx.audioConverter.enqueue(items)
      // Clear staged files and switch to queue tab
      setFiles([])
      setActiveTab('queue')
    } catch (err) {
      ctx.logger.error?.('Failed to enqueue conversion tasks:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const tabButtonStyle = (isActive: boolean) => ({
    padding: `${tokens.space[2]} ${tokens.space[4]}`,
    borderRadius: tokens.radius.sm,
    fontSize: 13,
    fontWeight: (isActive ? 600 : 500) as 600 | 500,
    background: isActive
      ? 'var(--surface-selected, rgba(255, 255, 255, 0.12))'
      : 'transparent',
    color: isActive ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, #9CA3AF)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[2],
    transition: 'all 0.15s ease',
  })

  return h(
    'section',
    {
      'data-testid': 'audio-converter-workbench',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '100vh',
        boxSizing: 'border-box' as const,
        padding: tokens.space[5],
        gap: tokens.space[4],
        background: 'var(--bg-app, #090B10)',
        color: 'var(--text-primary, #FFFFFF)',
        overflowY: 'auto' as const,
      },
    },
    // Top Bar Header
    h(
      'header',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap' as const,
          gap: tokens.space[3],
          paddingBottom: tokens.space[3],
          borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        },
      },
      // Title
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
        h(
          'div',
          {
            style: {
              width: 32,
              height: 32,
              borderRadius: tokens.radius.sm,
              background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            },
          },
          '🎵',
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          h(Text, { variant: 'lg' }, t('converter:index.title')),
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            t('converter:index.subtitle'),
          ),
        ),
      ),

      // Center Tabs
      h(
        'div',
        {
          role: 'tablist',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[1],
            background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
            padding: 3,
            borderRadius: tokens.radius.md,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          },
        },
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': activeTab === 'convert',
            'data-testid': 'tab-convert',
            style: tabButtonStyle(activeTab === 'convert'),
            onClick: () => setActiveTab('convert'),
          },
          t('converter:index.tabConvert'),
          files.length > 0
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: 'var(--color-primary, #6366F1)',
                    color: '#FFF',
                  },
                },
                files.length,
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': activeTab === 'queue',
            'data-testid': 'tab-queue',
            style: tabButtonStyle(activeTab === 'queue'),
            onClick: () => setActiveTab('queue'),
          },
          t('converter:index.tabQueue'),
          pendingOrProcessingTasks.length > 0
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: '#F59E0B',
                    color: '#000',
                    fontWeight: 700,
                  },
                },
                pendingOrProcessingTasks.length,
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': activeTab === 'output',
            'data-testid': 'tab-output',
            style: tabButtonStyle(activeTab === 'output'),
            onClick: () => setActiveTab('output'),
          },
          t('converter:index.tabOutput'),
          completedTasks.length > 0
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: 'rgba(34, 197, 94, 0.2)',
                    color: '#22C55E',
                    fontWeight: 600,
                  },
                },
                completedTasks.length,
              )
            : null,
        ),
      ),

      // Right: Settings button
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(Button, {
          variant: 'secondary',
          testID: 'converter-open-settings-btn',
          onPress: () => setIsSettingsOpen(true),
          children: t('converter:index.settings'),
        }),
      ),
    ),

    // Tab 1: Convert & Compress
    activeTab === 'convert'
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[4],
            },
          },
          // File management
          h(AudioFileList, {
            ctx,
            files,
            onAddFiles: (newFiles) => setFiles((prev) => [...prev, ...newFiles]),
            onRemoveFile: (id) => setFiles((prev) => prev.filter((f) => f.id !== id)),
            onClearFiles: () => setFiles([]),
          }),

          // Target format configuration
          h(FormatSection, {
            ctx,
            targetFormat,
            onFormatChange: handleFormatChange,
            capabilities,
          }),

          // Compression configuration & Estimation
          h(CompressionSection, {
            ctx,
            targetFormat,
            options: convertOptions,
            onOptionsChange: (newOpts) => setConvertOptions(newOpts),
            estimate,
            sourceSize: files[0]?.size,
          }),

          // Batch Action Execution Bar
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: tokens.space[4],
                background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
                borderRadius: tokens.radius.md,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
              },
            },
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              h(
                Text,
                { variant: 'sm' },
                files.length > 0
                  ? `${files.length} ${t('converter:index.filesReady')}`
                  : t('converter:index.noFilesSelected'),
              ),
              h(
                Text,
                { variant: 'xs', tone: 'muted' },
                t('converter:index.batchExecutionHint'),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: tokens.space[3], alignItems: 'center' } },
              files.length > 0
                ? h(Button, {
                    variant: 'ghost',
                    testID: 'clear-staged-btn',
                    onPress: () => setFiles([]),
                    children: t('converter:index.clearStaged'),
                  })
                : null,
              h(Button, {
                variant: 'primary',
                testID: 'start-conversion-btn',
                disabled: files.length === 0 || isSubmitting,
                onPress: handleStartConversion,
                children: isSubmitting
                  ? t('converter:index.submitting')
                  : `${t('converter:index.startConversion')} (${files.length})`,
              }),
            ),
          ),
        )
      : null,

    // Tab 2: Task Queue
    activeTab === 'queue'
      ? h(TaskQueueSection, {
          ctx,
          tasks,
          onCancelTask: (id) => void ctx.audioConverter?.cancelTask(id),
          onRetryTask: (id) => void ctx.audioConverter?.retryTask(id),
          onRemoveTask: (id) => void ctx.audioConverter?.removeTask(id),
          onClearFinished: () => void ctx.audioConverter?.clearFinished(),
        })
      : null,

    // Tab 3: Completed Outputs
    activeTab === 'output'
      ? h(OutputSection, {
          ctx,
          tasks,
          onRemoveTask: (id) => void ctx.audioConverter?.removeTask(id),
          onClearFinished: () => void ctx.audioConverter?.clearFinished(),
        })
      : null,

    // Settings Modal
    h(SettingsModal, {
      ctx,
      open: isSettingsOpen,
      onClose: () => setIsSettingsOpen(false),
      config,
      onSaveConfig: (patch) => {
        void ctx.audioConverter?.updateConfig(patch)
      },
    }),
  )
}
