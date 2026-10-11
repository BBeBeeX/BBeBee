import { createElement as h, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareAlbumData } from '@BBeBee/protocol'
import { Sheet } from '@BBeBee/ui-kit-desktop'
import {
  generateAlbumCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'
import { ShareModalHeader } from './ShareModalHeader.js'
import { BackgroundModeSelector } from './BackgroundModeSelector.js'
import { LocalSourceWarning } from './LocalSourceWarning.js'
import { DisabledReasonToast } from './DisabledReasonToast.js'
import { ShareActionButtons } from './ShareActionButtons.js'
import { useShareModalState } from '../hooks/useShareModalState.js'

export interface ShareAlbumModalProps {
  ctx: Context
  album: ShareAlbumData
  open: boolean
  onClose: () => void
}

export function ShareAlbumModal({
  ctx,
  album,
  open,
  onClose,
}: ShareAlbumModalProps): ReactElement | null {
  const isValid = Boolean(album && album.title && album.title.trim().length > 0)
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
    item: album,
    defaultThemeColor: '#FF416C',
    isValid,
    missingReason: "Can't copy: the album is missing a valid title or other metadata",
  })

  const subtitleParts = ['Album']
  if (album.artist) subtitleParts.push(album.artist)
  if (album.trackCount > 0) subtitleParts.push(`${album.trackCount} songs`)
  if (album.year) subtitleParts.push(String(album.year))
  const subtitle = subtitleParts.join(' • ')

  const handleCopy = useCallback(() => {
    void copyBase64('album', album)
  }, [copyBase64, album])

  const handleDownload = useCallback(async () => {
    if (isLocal) {
      handleDisabledDownloadClick()
      return
    }
    try {
      setDownloading(true)
      const canvas = await generateAlbumCardCanvas({
        album: {
          ...album,
          artwork: httpArtwork ?? album.artwork,
        },
        renderArtwork: resolvedArtwork,
        themeColor,
        backgroundMode,
      })
      const filename = `${album.artist ? `${album.artist} - ` : ''}${album.title} (BBeBee Album Share).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, album, httpArtwork, resolvedArtwork, themeColor, backgroundMode, isLocal, handleDisabledDownloadClick, setDownloading])

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
      h(ShareModalHeader, { title: 'Share album', onClose }),
      h(LocalSourceWarning, { show: isLocal }),
      h(ShareCardPreview, {
        title: album.title,
        subtitle,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        type: 'album',
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
