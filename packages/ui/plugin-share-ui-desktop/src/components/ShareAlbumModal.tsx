import { createElement as h, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareAlbumData } from '@BBeBee/protocol'
import { Sheet, useI18n } from '@BBeBee/ui-kit-desktop'
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
  const { t } = useI18n(ctx)
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
    missingReason: t('share:shareAlbum.canTCopyTheAlbum'),
  })

  const subtitleParts = [t('share:shareAlbum.albumLabel')]
  if (album.artist) subtitleParts.push(album.artist)
  if (album.trackCount > 0)
    subtitleParts.push(
      t(
        album.trackCount === 1 ? 'share:shareAlbum.trackCountSongs.one' : 'share:shareAlbum.trackCountSongs.other',
        { trackCount: album.trackCount },
      ),
    )
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
      h(ShareModalHeader, { ctx, title: t('share:shareAlbum.shareAlbum'), onClose }),
      h(LocalSourceWarning, { ctx, show: isLocal }),
      h(ShareCardPreview, {
        title: album.title,
        subtitle,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        type: 'album',
      }),
      h(BackgroundModeSelector, { ctx, mode: backgroundMode, onChange: setBackgroundMode }),
      h(DisabledReasonToast, { message: disabledReason }),
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
