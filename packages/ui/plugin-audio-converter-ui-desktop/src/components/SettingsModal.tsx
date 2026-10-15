/**
 * Audio Converter Settings Modal.
 * Configures default format, output directory, concurrency, timeout, and auto-clean.
 */

import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AudioConverterConfig, AudioFormat, CompressionPreset } from '@BBeBee/protocol'
import { Button, Sheet, Switch, Text, TextField, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export interface SettingsModalProps {
  ctx: Context
  open: boolean
  onClose: () => void
  config: AudioConverterConfig
  onSaveConfig: (patch: Partial<AudioConverterConfig>) => void
}

const SUPPORTED_FORMATS: readonly AudioFormat[] = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'm4a',
  'ogg',
  'opus',
  'wma',
  'aiff',
  'alac',
  'webm',
]

export function SettingsModal({
  ctx,
  open,
  onClose,
  config,
  onSaveConfig,
}: SettingsModalProps): ReactElement {
  const { t } = useI18n(ctx)

  const [draft, setDraft] = useState<AudioConverterConfig>(config)

  const timeoutOptions = useMemo(
    () => [
      { label: t('converter:index.timeout1Min'), value: 60_000 },
      { label: t('converter:index.timeout3Min'), value: 180_000 },
      { label: t('converter:index.timeout5Min'), value: 300_000 },
      { label: t('converter:index.timeout10Min'), value: 600_000 },
      { label: t('converter:index.timeout30Min'), value: 1_800_000 },
    ],
    [t],
  )

  useEffect(() => {
    if (open) {
      setDraft(config)
    }
  }, [open, config])

  const handleSave = () => {
    onSaveConfig(draft)
    onClose()
  }

  const selectStyle = {
    padding: `${tokens.space[2]} ${tokens.space[3]}`,
    borderRadius: tokens.radius.sm,
    border: '1px solid var(--border-default, rgba(145, 176, 255, 0.14))',
    background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
    color: 'var(--text-primary, #FFFFFF)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  }

  return h(
    Sheet,
    {
      open,
      onClose,
      title: t('converter:index.settings'),
      accessibilityLabel: t('converter:index.settings'),
    },
    h(
      'div',
      {
        'data-testid': 'converter-settings-modal',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[4],
          minWidth: 380,
          maxWidth: 480,
        },
      },
      // Default Target Format
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, { variant: 'sm' }, t('converter:index.defaultFormat')),
        h(
          'select',
          {
            value: draft.defaultFormat,
            onChange: (e: ChangeEvent<HTMLSelectElement>) =>
              setDraft((prev) => ({ ...prev, defaultFormat: e.target.value as AudioFormat })),
            style: selectStyle,
          },
          SUPPORTED_FORMATS.map((fmt) =>
            h('option', { key: fmt, value: fmt }, fmt.toUpperCase()),
          ),
        ),
      ),

      // Default Preset
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, { variant: 'sm' }, t('converter:index.defaultPreset')),
        h(
          'select',
          {
            value: draft.defaultPreset ?? 'balanced',
            onChange: (e: ChangeEvent<HTMLSelectElement>) =>
              setDraft((prev) => ({
                ...prev,
                defaultPreset: e.target.value as CompressionPreset,
              })),
            style: selectStyle,
          },
          h('option', { value: 'high_quality' }, t('converter:index.presetHighQuality')),
          h('option', { value: 'balanced' }, t('converter:index.presetBalanced')),
          h('option', { value: 'small_size' }, t('converter:index.presetSmallSize')),
          h('option', { value: 'speech' }, t('converter:index.presetSpeech')),
          h('option', { value: 'custom' }, t('converter:index.presetCustom')),
        ),
      ),

      // Default Output Directory
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, { variant: 'sm' }, t('converter:index.defaultOutputDir')),
        h(TextField, {
          value: draft.defaultOutputDir ?? '',
          placeholder: t('converter:index.outputDirPlaceholder'),
          onChange: (val) =>
            setDraft((prev) => ({ ...prev, defaultOutputDir: val ? val : undefined })),
        }),
      ),

      // Concurrency Limit
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h(Text, { variant: 'sm' }, t('converter:index.concurrency')),
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            `${draft.maxConcurrency} ${t('converter:index.tasks')}`,
          ),
        ),
        h('input', {
          type: 'range',
          min: 1,
          max: 8,
          step: 1,
          value: draft.maxConcurrency,
          onChange: (e: ChangeEvent<HTMLInputElement>) =>
            setDraft((prev) => ({ ...prev, maxConcurrency: Number.parseInt(e.target.value, 10) })),
          style: { width: '100%', cursor: 'pointer' },
        }),
      ),

      // Task Timeout
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, { variant: 'sm' }, t('converter:index.timeout')),
        h(
          'select',
          {
            value: draft.taskTimeoutMs,
            onChange: (e: ChangeEvent<HTMLSelectElement>) =>
              setDraft((prev) => ({
                ...prev,
                taskTimeoutMs: Number.parseInt(e.target.value, 10),
              })),
            style: selectStyle,
          },
          timeoutOptions.map((opt) =>
            h('option', { key: opt.value, value: opt.value }, opt.label),
          ),
        ),
      ),

      // Auto-clean temp files switch
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: tokens.space[2],
            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h(Text, { variant: 'sm' }, t('converter:index.autoCleanCompleted')),
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            t('converter:index.autoCleanDescription'),
          ),
        ),
        h(Switch, {
          checked: draft.autoCleanTemp,
          onChange: (checked) =>
            setDraft((prev) => ({ ...prev, autoCleanTemp: checked })),
          accessibilityLabel: t('converter:index.autoCleanCompleted'),
        }),
      ),

      // Footer buttons
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: tokens.space[2],
            marginTop: tokens.space[3],
          },
        },
        h(Button, {
          variant: 'ghost',
          onPress: onClose,
          children: t('converter:index.cancel'),
        }),
        h(Button, {
          variant: 'primary',
          testID: 'save-settings-btn',
          onPress: handleSave,
          children: t('converter:index.save'),
        }),
      ),
    ),
  )
}
