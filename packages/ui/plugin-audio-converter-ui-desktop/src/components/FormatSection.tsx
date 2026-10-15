/**
 * Target format selection, encoder capability checks, and format meta display.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AudioFormat, EncoderCapabilities } from '@BBeBee/protocol'
import { Select, Text, useI18n, type SelectOption } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { isLosslessFormat } from '@BBeBee/plugin-audio-converter'

export interface FormatSectionProps {
  ctx: Context
  targetFormat: AudioFormat
  onFormatChange: (fmt: AudioFormat) => void
  capabilities?: EncoderCapabilities
}

const FORMAT_OPTIONS: readonly SelectOption<AudioFormat>[] = [
  { value: 'mp3', label: 'MP3 (.mp3)' },
  { value: 'flac', label: 'FLAC (.flac) - Lossless' },
  { value: 'wav', label: 'WAV (.wav) - Uncompressed' },
  { value: 'aac', label: 'AAC (.aac)' },
  { value: 'm4a', label: 'M4A (.m4a)' },
  { value: 'ogg', label: 'OGG Vorbis (.ogg)' },
  { value: 'opus', label: 'Opus (.opus)' },
  { value: 'alac', label: 'ALAC (.m4a) - Lossless' },
  { value: 'aiff', label: 'AIFF (.aiff) - Uncompressed' },
  { value: 'wma', label: 'WMA (.wma)' },
  { value: 'webm', label: 'WebM Audio (.webm)' },
  { value: 'pcm', label: 'Raw PCM (.pcm)' },
]

export function FormatSection({
  ctx,
  targetFormat,
  onFormatChange,
  capabilities,
}: FormatSectionProps): ReactElement {
  const { t } = useI18n(ctx)

  // Determine which encoder corresponds to selected format
  const encoderKeyMap: Record<AudioFormat, string> = {
    mp3: 'libmp3lame',
    flac: 'flac',
    wav: 'pcm_s16le',
    aac: 'aac',
    m4a: 'aac',
    ogg: 'libvorbis',
    opus: 'libopus',
    alac: 'alac',
    aiff: 'pcm_s16be',
    wma: 'wmav2',
    webm: 'libopus',
    pcm: 'pcm_s16le',
  }

  const encKey = encoderKeyMap[targetFormat] || 'unknown'
  const encoderMeta = capabilities?.encoders[encKey]
  const isAvailable = encoderMeta ? encoderMeta.available : true
  const isLossless = isLosslessFormat(targetFormat)

  return h(
    'section',
    {
      'data-testid': 'converter-format-section',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
        padding: tokens.space[4],
        background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
        borderRadius: tokens.radius.md,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      },
    },
    h(Text, { variant: 'md' }, t('converter:index.targetFormat')),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[4],
          flexWrap: 'wrap',
        },
      },
      // Target format dropdown
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.format')),
        h(Select<AudioFormat>, {
          value: targetFormat,
          options: FORMAT_OPTIONS,
          onChange: onFormatChange,
          accessibilityLabel: t('converter:index.targetFormat'),
        }),
      ),
      // Encoder Status Badge
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.detectedEncoder')),
        h(
          'div',
          {
            'data-testid': 'encoder-status-badge',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              background: isAvailable
                ? 'var(--surface-2, rgba(34, 197, 94, 0.12))'
                : 'var(--surface-2, rgba(239, 68, 68, 0.12))',
              border: isAvailable
                ? '1px solid rgba(34, 197, 94, 0.25)'
                : '1px solid rgba(239, 68, 68, 0.25)',
            },
          },
          h('span', {
            style: {
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isAvailable ? '#22C55E' : '#EF4444',
            },
          }),
          h(
            Text,
            { variant: 'xs', style: { fontWeight: 600 } },
            `${encoderMeta?.name ?? encKey} (${isAvailable ? t('converter:index.available') : t('converter:index.unavailable')})`,
          ),
        ),
      ),
      // Quality Classification Tag
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, 'Audio Type'),
        h(
          'span',
          {
            style: {
              padding: '6px 12px',
              borderRadius: 6,
              background: isLossless
                ? 'var(--surface-2, rgba(59, 130, 246, 0.12))'
                : 'var(--surface-2, rgba(245, 158, 11, 0.12))',
              border: isLossless
                ? '1px solid rgba(59, 130, 246, 0.25)'
                : '1px solid rgba(245, 158, 11, 0.25)',
              color: isLossless ? '#60A5FA' : '#FBBF24',
              fontSize: 12,
              fontWeight: 600,
            },
          },
          isLossless ? 'Lossless Audio' : 'Lossy Compressed',
        ),
      ),
    ),
  )
}
