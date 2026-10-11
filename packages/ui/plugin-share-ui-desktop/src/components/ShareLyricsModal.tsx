import { createElement as h, useState, useCallback, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareLyricsData } from '@BBeBee/protocol'
import { Sheet, tablerIcon, useImageColor } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { copyToClipboard } from '../utils/clipboard.js'
import {
  type BackgroundMode,
  generateLyricsCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'
import { ShareModalHeader } from './ShareModalHeader.js'
import { BackgroundModeSelector } from './BackgroundModeSelector.js'
import { DisabledReasonToast } from './DisabledReasonToast.js'
import { ShareActionButtons } from './ShareActionButtons.js'
import { extractHttpArtworkUrl } from '../hooks/useShareModalState.js'

export interface ShareLyricsModalProps {
  ctx: Context
  lyrics: ShareLyricsData
  open: boolean
  onClose: () => void
}

export function ShareLyricsModal({
  ctx,
  lyrics,
  open,
  onClose,
}: ShareLyricsModalProps): ReactElement | null {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('cover')
  const [imageScope, setImageScope] = useState<'full' | 'card'>('full')
  const [selectedIndices, setSelectedIndices] = useState<number[]>(() => {
    return lyrics.lines.slice(0, 4).map((_, i) => i)
  })
  const [copiedText, setCopiedText] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [disabledReason, setDisabledReason] = useState<string | null>(null)

  const httpArtwork = useMemo(() => extractHttpArtworkUrl(lyrics.artwork), [lyrics.artwork])

  const artworkRef = useMemo(() => {
    return lyrics.artwork ? { id: lyrics.trackUrn || lyrics.title, sourceUrl: lyrics.artwork } : undefined
  }, [lyrics.artwork, lyrics.trackUrn, lyrics.title])
  const resolvedArtworkRef = useResolvedArtwork(ctx, artworkRef)
  const resolvedArtwork = resolvedArtworkRef?.sourceUrl ?? lyrics.artwork

  const extractedColor = useImageColor(resolvedArtwork)
  const themeColor = extractedColor ?? '#79486D'

  const activeLines = useMemo(() => {
    return selectedIndices
      .sort((a, b) => a - b)
      .map((idx) => lyrics.lines[idx]!)
      .filter(Boolean)
  }, [lyrics.lines, selectedIndices])

  const toggleLine = (index: number) => {
    setSelectedIndices((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index)
      }
      if (prev.length >= 6) return prev
      return [...prev, index]
    })
  }

  const canCopy = activeLines.length > 0

  const showDisabledReason = useCallback((msg: string) => {
    setDisabledReason(msg)
    setTimeout(() => setDisabledReason(null), 3500)
  }, [])

  const handleCopyText = useCallback(async () => {
    if (!canCopy) {
      showDisabledReason("Can't copy lyrics: select at least one lyric line")
      return
    }
    try {
      const textToCopy = `${activeLines.join('\n')}\n\n—— ${lyrics.artist} "${lyrics.title}"`
      const ok = await copyToClipboard(textToCopy)
      if (ok) {
        setCopiedText(true)
        setDisabledReason(null)
        setTimeout(() => setCopiedText(false), 2000)
      } else {
        ctx.logger?.error('Failed to copy lyrics via clipboard')
        showDisabledReason("Can't copy: writing to the clipboard failed, check system permissions")
      }
    } catch (err) {
      ctx.logger?.error(`Failed to copy lyrics: ${String(err)}`)
      showDisabledReason("Can't copy: writing to the clipboard failed, check system permissions")
    }
  }, [ctx, activeLines, lyrics.artist, lyrics.title, canCopy, showDisabledReason])

  const handleDownload = useCallback(async () => {
    try {
      setDownloading(true)
      const lyricsData: ShareLyricsData = {
        ...lyrics,
        artwork: httpArtwork ?? lyrics.artwork,
        lines: activeLines,
      }
      const isCardOnly = imageScope === 'card'
      const canvas = await generateLyricsCardCanvas({
        lyrics: lyricsData,
        renderArtwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        cardOnly: isCardOnly,
      })
      const filename = isCardOnly
        ? `${lyrics.artist} - ${lyrics.title} (Lyrics card).png`
        : `${lyrics.artist} - ${lyrics.title} (Lyrics share).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download lyrics share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, lyrics, httpArtwork, resolvedArtwork, activeLines, themeColor, backgroundMode, imageScope])

  if (!open) return null

  return h(
    Sheet,
    { open, onClose },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          width: 340,
          margin: '0 auto',
        },
      },
      h(ShareModalHeader, { title: 'Share lyrics', onClose }),
      h(ShareCardPreview, {
        title: lyrics.title,
        subtitle: lyrics.artist,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        lyrics: activeLines,
        type: 'lyrics',
        cardOnly: imageScope === 'card',
      }),
      // Line selection chips if more than 1 line exists
      lyrics.lines.length > 1
        ? h(
            'div',
            {
              style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              },
            },
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: 'var(--text-muted, #8B95B0)',
                  display: 'flex',
                  justifyContent: 'space-between',
                },
              },
              h('span', null, 'Tap lyric lines to choose what gets shared (up to 6)'),
              h('span', null, `${activeLines.length} selected`),
            ),
            h(
              'div',
              {
                style: {
                  maxHeight: 110,
                  overflowY: 'auto',
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: 8,
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                },
              },
              lyrics.lines.map((line, idx) => {
                const isSelected = selectedIndices.includes(idx)
                return h(
                  'div',
                  {
                    key: idx,
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => toggleLine(idx),
                    style: {
                      padding: '5px 8px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                      background: isSelected
                        ? 'var(--surface-selected, rgba(95, 135, 255, 0.2))'
                        : 'transparent',
                      color: isSelected
                        ? 'var(--color-text-primary, #FFFFFF)'
                        : 'var(--text-secondary, #8B95B0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    },
                  },
                  tablerIcon(isSelected ? 'check' : 'circle', {
                    size: 14,
                    color: isSelected ? '#4D8BFF' : 'var(--color-text-tertiary, rgba(255, 255, 255, 0.3))',
                  }),
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, line),
                )
              }),
            ),
          )
        : null,
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            width: '100%',
            background: 'rgba(255, 255, 255, 0.05)',
            padding: 3,
            borderRadius: 8,
            boxSizing: 'border-box',
          },
        },
        h(
          'button',
          {
            type: 'button',
            onClick: () => setImageScope('full'),
            style: {
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              background: imageScope === 'full' ? 'var(--color-primary, #5F87FF)' : 'transparent',
              color: imageScope === 'full' ? '#FFFFFF' : 'var(--text-secondary, #8B95B0)',
              transition: 'all 0.15s ease',
            },
          },
          'Full poster (large)',
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: () => setImageScope('card'),
            style: {
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              background: imageScope === 'card' ? 'var(--color-primary, #5F87FF)' : 'transparent',
              color: imageScope === 'card' ? '#FFFFFF' : 'var(--text-secondary, #8B95B0)',
              transition: 'all 0.15s ease',
            },
          },
          'Inner card only (small)',
        ),
      ),
      imageScope === 'full'
        ? h(BackgroundModeSelector, {
            mode: backgroundMode,
            onChange: setBackgroundMode,
            compact: true,
          })
        : null,
      h(DisabledReasonToast, { message: disabledReason }),
      h(ShareActionButtons, {
        canCopy,
        copied: copiedText,
        downloading,
        canDownload: true,
        onCopy: handleCopyText,
        onDownload: handleDownload,
        onDisabledCopyClick: () => showDisabledReason("Can't copy lyrics: select at least one lyric line"),
        onDisabledDownloadClick: () => {},
        copyText: 'Copy lyrics',
        copiedText: 'Copied lyrics',
        downloadText: 'Download image',
        downloadingText: 'Generating…',
      }),
    ),
  )
}
