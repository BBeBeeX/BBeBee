import { createElement as h, useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { useTrackDetails } from '@BBeBee/plugin-now-playing/hooks'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface TrackInfoModalProps {
  ctx: Context
  track: Track | null
  open: boolean
  onClose: () => void
}

export function TrackInfoModal({
  ctx,
  track,
  open,
  onClose,
}: TrackInfoModalProps): ReactElement | null {
  // The aggregation — db bindings, fs stat, codec metadata, stream and output
  // specs — lives in the headless feature (`resolveTrackDetails`); this modal
  // only renders the rows it returns.
  const { details, loading } = useTrackDetails(ctx, track, open)
  const [copiedPath, setCopiedPath] = useState(false)

  const handleCopyPath = useCallback(async () => {
    if (!details?.filePath) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(details.filePath)
        setCopiedPath(true)
        setTimeout(() => setCopiedPath(false), 2000)
      }
    } catch {
      // Ignore clipboard write errors (e.g. unfocused window or permissions)
    }
  }, [details?.filePath])

  if (!open || !track) return null

  const renderRow = (label: string, value?: string, onCopy?: () => void, isCopied = false) => {
    return h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          padding: '6px 0',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: 13,
          lineHeight: '1.5',
        },
      },
      h(
        'span',
        {
          style: {
            width: 110,
            flexShrink: 0,
            color: 'var(--text-muted, #8B95B0)',
            userSelect: 'none',
          },
        },
        label,
      ),
      h(
        'span',
        {
          style: {
            flex: 1,
            color: 'var(--text-primary, #FFFFFF)',
            wordBreak: 'break-all',
            userSelect: 'text',
          },
        },
        value ?? 'Unknown',
      ),
      onCopy && value
        ? h(
            'button',
            {
              type: 'button',
              onClick: onCopy,
              title: isCopied ? 'Copied' : 'Copy',
              style: {
                background: 'transparent',
                border: 'none',
                color: isCopied ? 'var(--color-primary, #5F87FF)' : 'var(--text-muted, #8B95B0)',
                cursor: 'pointer',
                padding: '0 4px',
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
                outline: 'none',
              },
            },
            tablerIcon(isCopied ? 'check' : 'copy', { size: 14 }),
          )
        : null,
    )
  }

  return h(
    Sheet,
    { open, onClose },
    h(
      'div',
      {
        style: {
          width: 480,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxSizing: 'border-box',
        },
      },
      // Header
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            paddingBottom: 12,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          tablerIcon('info-circle', { size: 22, color: 'var(--color-primary, #5F87FF)' }),
          h(
            'span',
            { style: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #FFFFFF)' } },
            'Track details',
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: onClose,
            'aria-label': 'Close',
            style: {
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #8B95B0)',
              cursor: 'pointer',
              display: 'flex',
              padding: 4,
            },
          },
          tablerIcon('x', { size: 18 }),
        ),
      ),
      loading
        ? h(
            'div',
            {
              style: {
                padding: '36px 0',
                textAlign: 'center',
                color: 'var(--text-secondary, #8B95B0)',
                fontSize: 14,
              },
            },
            'Reading track technical details…',
          )
        : details
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  maxHeight: '65vh',
                  overflowY: 'auto',
                  paddingRight: 4,
                },
              },
              // Section 1: Source & File
              h(
                'div',
                null,
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    },
                  },
                  details.isLocal ? 'Local music properties' : 'Song source properties',
                ),
                renderRow('Title', details.title),
                renderRow('Artist', details.artist),
                details.album ? renderRow('Album', details.album) : null,
                renderRow('Storage', details.isLocal ? 'Local music file' : 'Third-party online music source'),
                details.isLocal
                  ? h(
                      'div',
                      null,
                      renderRow('File name', details.fileName),
                      renderRow('File path', details.filePath, handleCopyPath, copiedPath),
                      renderRow('File size', details.fileSize),
                      renderRow('Last modified', details.modifiedTime),
                    )
                  : h(
                      'div',
                      null,
                      renderRow('Third-party source ID', details.sourceId),
                      renderRow('Current source track ID', details.sourceTrackId),
                    ),
              ),
              // Section 2: Audio Technical Specs
              h(
                'div',
                null,
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    },
                  },
                  'Audio specs & metadata',
                ),
                renderRow('Duration', details.duration),
                renderRow('Sample rate', details.sampleRate),
                renderRow('Channels', details.channels),
                renderRow('Bitrate', details.bitrate),
                renderRow('Codec', details.codec),
                renderRow('Tag type', details.tagType),
              ),
              // Section 3: Audio Output & WASAPI Specs
              h(
                'div',
                null,
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    },
                  },
                  'Audio output endpoint',
                ),
                renderRow('Output device', details.outputDevice),
                renderRow('Output engine', details.outputEngine),
                renderRow('DAC sample rate', details.outputSampleRate),
                renderRow('Hardware output channels', details.outputChannels),
                renderRow('Bit depth & format', details.outputBitDepth),
                renderRow('PCM output bandwidth', details.outputBandwidth),
              ),
            )
          : null,
    ),
  )
}
