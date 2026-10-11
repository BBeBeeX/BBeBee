import { createElement as h, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareTrackData } from '@BBeBee/protocol'
import { Sheet } from '@BBeBee/ui-kit-desktop'
import {
  generateTrackCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'
import { ShareModalHeader } from './ShareModalHeader.js'
import { BackgroundModeSelector } from './BackgroundModeSelector.js'
import { LocalSourceWarning } from './LocalSourceWarning.js'
import { DisabledReasonToast } from './DisabledReasonToast.js'
import { ShareActionButtons } from './ShareActionButtons.js'
import { useShareModalState } from '../hooks/useShareModalState.js'

export interface ShareTrackModalProps {
  ctx: Context
  track: ShareTrackData
  open: boolean
  onClose: () => void
}

export function ShareTrackModal({
  ctx,
  track,
  open,
  onClose,
}: ShareTrackModalProps): ReactElement | null {
  const isValid = Boolean(track && track.title && track.title.trim().length > 0)
  const {
    backgroundMode,
    setBackgroundMode,
    copied,
    downloading,
    setDownloading,
    disabledReason,
    isLocal,
    httpArtwork,
    resolvedArtwork,
    themeColor,
    canCopy,
    canDownload,
    copyBase64,
    handleDisabledCopyClick,
    handleDisabledDownloadClick,
  } = useShareModalState({
    ctx,
    item: track,
    defaultThemeColor: '#FF6B00',
    isValid,
    missingReason: "Can't copy: missing a valid title or other metadata",
  })

  const handleCopy = useCallback(() => {
    void copyBase64('track', track)
  }, [copyBase64, track])

  const handleDownload = useCallback(async () => {
    if (isLocal) {
      handleDisabledDownloadClick()
      return
    }
    try {
      setDownloading(true)
      const canvas = await generateTrackCardCanvas({
        track: {
          ...track,
          artwork: httpArtwork ?? track.artwork,
        },
        renderArtwork: resolvedArtwork,
        themeColor,
        backgroundMode,
      })
      const filename = `${track.artist} - ${track.title} (BBeBee Share).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, track, httpArtwork, resolvedArtwork, themeColor, backgroundMode, isLocal, handleDisabledDownloadClick, setDownloading])

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
          gap: 16,
          width: 320,
          margin: '0 auto',
        },
      },
      h(ShareModalHeader, { title: 'Share song', onClose }),
      h(LocalSourceWarning, { show: isLocal }),
      h(ShareCardPreview, {
        title: track.title,
        subtitle: track.artist,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        type: 'track',
      }),
      h(BackgroundModeSelector, {
        mode: backgroundMode,
        onChange: setBackgroundMode,
      }),
      h(DisabledReasonToast, { message: disabledReason }),
      h(ShareActionButtons, {
        canCopy,
        copied,
        downloading,
        canDownload,
        onCopy: handleCopy,
        onDownload: handleDownload,
        onDisabledCopyClick: handleDisabledCopyClick,
        onDisabledDownloadClick: handleDisabledDownloadClick,
      }),
    ),
  )
}
