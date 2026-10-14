import { createElement as h, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareTrackData } from '@BBeBee/protocol'
import { Sheet, useI18n } from '@BBeBee/ui-kit-desktop'
import {
  generateTrackCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'
import { ShareModalHeader } from './ShareModalHeader.js'
import { BackgroundModeSelector } from './BackgroundModeSelector.js'
import { LocalSourceWarning } from './LocalSourceWarning.js'
import { DisabledReasonToast } from './DisabledReasonToast.js'
import { ShareSuccessToast } from './ShareSuccessToast.js'
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
  const { t } = useI18n(ctx)
  const isValid = Boolean(track && track.title && track.title.trim().length > 0)
  const {
    backgroundMode,
    setBackgroundMode,
    copied,
    downloading,
    setDownloading,
    disabledReason,
    successToast,
    showSuccessToast,
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
    missingReason: t('share:shareTrack.canTCopyMissingA'),
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
      const successMsg = t('share:shareActionButtons.downloadSuccessToast')
      showSuccessToast(successMsg)
      ctx.emit('ui/toast', { message: successMsg, tone: 'ok' })
    } catch (err) {
      ctx.logger?.error(`Failed to download share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, t, track, httpArtwork, resolvedArtwork, themeColor, backgroundMode, isLocal, handleDisabledDownloadClick, setDownloading, showSuccessToast])

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
      h(ShareModalHeader, { ctx, title: t('share:shareTrack.shareSong'), onClose }),
      h(LocalSourceWarning, { ctx, show: isLocal }),
      h(ShareCardPreview, {
        title: track.title,
        subtitle: track.artist,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        type: 'track',
      }),
      h(BackgroundModeSelector, { ctx, mode: backgroundMode, onChange: setBackgroundMode }),
      h(DisabledReasonToast, { message: disabledReason }),
      h(ShareSuccessToast, { message: successToast }),
      h(ShareActionButtons, {
        ctx,
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
