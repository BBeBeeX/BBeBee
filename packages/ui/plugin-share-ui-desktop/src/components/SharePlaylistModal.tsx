import { createElement as h, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SharePlaylistData } from '@BBeBee/protocol'
import { Sheet } from '@BBeBee/ui-kit-desktop'
import {
  generatePlaylistCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'
import { ShareModalHeader } from './ShareModalHeader.js'
import { BackgroundModeSelector } from './BackgroundModeSelector.js'
import { LocalSourceWarning } from './LocalSourceWarning.js'
import { DisabledReasonToast } from './DisabledReasonToast.js'
import { ShareActionButtons } from './ShareActionButtons.js'
import { useShareModalState } from '../hooks/useShareModalState.js'

export interface SharePlaylistModalProps {
  ctx: Context
  playlist: SharePlaylistData
  open: boolean
  onClose: () => void
}

export function SharePlaylistModal({
  ctx,
  playlist,
  open,
  onClose,
}: SharePlaylistModalProps): ReactElement | null {
  const isValid = Boolean(playlist && playlist.name && playlist.name.trim().length > 0)
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
    item: playlist,
    defaultThemeColor: '#8C52FF',
    isValid,
    missingReason: "Can't copy: the playlist is missing a valid name or other metadata",
  })

  const subtitle =
    playlist.trackCount > 0 ? `Playlist • ${playlist.trackCount} songs` : 'Playlist'

  const handleCopy = useCallback(() => {
    void copyBase64('playlist', playlist)
  }, [copyBase64, playlist])

  const handleDownload = useCallback(async () => {
    if (isLocal) {
      handleDisabledDownloadClick()
      return
    }
    try {
      setDownloading(true)
      const canvas = await generatePlaylistCardCanvas({
        playlist: {
          ...playlist,
          artwork: httpArtwork ?? playlist.artwork,
        },
        renderArtwork: resolvedArtwork,
        themeColor,
        backgroundMode,
      })
      const filename = `${playlist.name} (BBeBee Playlist Share).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, playlist, httpArtwork, resolvedArtwork, themeColor, backgroundMode, isLocal, handleDisabledDownloadClick, setDownloading])

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
      h(ShareModalHeader, { title: 'Share playlist', onClose }),
      h(LocalSourceWarning, { show: isLocal }),
      h(ShareCardPreview, {
        title: playlist.name,
        subtitle,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        type: 'playlist',
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
