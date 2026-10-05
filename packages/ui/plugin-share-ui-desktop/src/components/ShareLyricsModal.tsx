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
      showDisabledReason('无法复制歌词：请至少勾选一行歌词')
      return
    }
    try {
      const textToCopy = `${activeLines.join('\n')}\n\n—— ${lyrics.artist}《${lyrics.title}》`
      const ok = await copyToClipboard(textToCopy)
      if (ok) {
        setCopiedText(true)
        setDisabledReason(null)
        setTimeout(() => setCopiedText(false), 2000)
      } else {
        ctx.logger?.error('Failed to copy lyrics via clipboard')
        showDisabledReason('无法复制：剪贴板写入失败，请检查系统权限')
      }
    } catch (err) {
      ctx.logger?.error(`Failed to copy lyrics: ${String(err)}`)
      showDisabledReason('无法复制：剪贴板写入失败，请检查系统权限')
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
        ? `${lyrics.artist} - ${lyrics.title} (歌词卡片).png`
        : `${lyrics.artist} - ${lyrics.title} (歌词分享).png`
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
      h(ShareModalHeader, { title: '分享歌词', onClose }),
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
              h('span', null, '点击歌词选择分享行 (最多6行)'),
              h('span', null, `${activeLines.length} 行已选`),
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
                        ? '#FFFFFF'
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
                    color: isSelected ? '#4D8BFF' : 'rgba(255, 255, 255, 0.3)',
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
          '整张海报 (大图)',
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
          '仅内部卡片 (小图)',
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
        onDisabledCopyClick: () => showDisabledReason('无法复制歌词：请至少勾选一行歌词'),
        onDisabledDownloadClick: () => {},
        copyText: '复制歌词',
        copiedText: '已复制歌词',
        downloadText: '下载图片',
        downloadingText: '生成中…',
      }),
    ),
  )
}
