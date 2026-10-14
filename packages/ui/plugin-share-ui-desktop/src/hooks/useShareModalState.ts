import { useState, useMemo, useCallback } from 'react'
import type { Context } from 'cordis'
import type {
  ShareType,
  ShareTrackData,
  SharePlaylistData,
  ShareAlbumData,
  ShareLyricsData,
} from '@BBeBee/protocol'
import { encodeMetadata } from '@BBeBee/plugin-share/metadata'
import { useImageColor, useI18n } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { copyToClipboard } from '../utils/clipboard.js'
import { isLocalSource } from '../utils/sourceHelper.js'
import type { BackgroundMode } from '../utils/canvasRenderer.js'

export function extractHttpArtworkUrl(artwork?: unknown): string | undefined {
  if (!artwork) return undefined
  if (typeof artwork === 'string' && /^https?:\/\//i.test(artwork)) {
    return artwork
  }
  if (typeof artwork === 'object' && artwork !== null) {
    const obj = artwork as { sourceUrl?: unknown; url?: unknown; uri?: unknown }
    if (typeof obj.sourceUrl === 'string' && /^https?:\/\//i.test(obj.sourceUrl)) {
      return obj.sourceUrl
    }
    if (typeof obj.url === 'string' && /^https?:\/\//i.test(obj.url)) {
      return obj.url
    }
  }
  return undefined
}

export interface UseShareModalStateOptions<T> {
  ctx: Context
  item: T
  defaultThemeColor?: string
  isValid?: boolean
  missingReason?: string
}

export function useShareModalState<
  T extends { urn?: string; artwork?: string; source?: string; title?: string; name?: string }
>({
  ctx,
  item,
  defaultThemeColor = '#8C52FF',
  isValid = true,
  missingReason,
}: UseShareModalStateOptions<T>) {
  const { t } = useI18n(ctx)
  const resolvedMissingReason = missingReason ?? t('share:shareTrack.canTCopyMissingA')
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('cover')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [disabledReason, setDisabledReason] = useState<string | null>(null)
  const [successToast, setSuccessToast] = useState<string | null>(null)

  const isLocal = useMemo(() => isLocalSource(item), [item])

  // Extract HTTP artwork URL to embed in steganography / metadata
  const httpArtwork = useMemo(() => extractHttpArtworkUrl(item.artwork), [item.artwork])

  // Resolve artwork via cache for canvas painting
  const artworkRef = useMemo(() => {
    return item.artwork
      ? { id: item.urn || item.title || item.name || 'share_item', sourceUrl: item.artwork }
      : undefined
  }, [item.artwork, item.urn, item.title, item.name])

  const resolvedArtworkRef = useResolvedArtwork(ctx, artworkRef)
  const resolvedArtwork = resolvedArtworkRef?.sourceUrl ?? item.artwork

  const extractedColor = useImageColor(resolvedArtwork)
  const themeColor = extractedColor ?? defaultThemeColor

  const showDisabledReason = useCallback((reason: string) => {
    setSuccessToast(null)
    setDisabledReason(reason)
    setTimeout(() => setDisabledReason(null), 3500)
  }, [])

  const showSuccessToast = useCallback((msg: string) => {
    setDisabledReason(null)
    setSuccessToast(msg)
    setTimeout(() => setSuccessToast(null), 3000)
  }, [])

  const canCopy = !isLocal && isValid
  const canDownload = !isLocal

  const copyBase64 = useCallback(
    async (
      type: ShareType,
      data: ShareTrackData | SharePlaylistData | ShareAlbumData | ShareLyricsData,
    ) => {
      if (isLocal) {
        showDisabledReason(t('share:localSourceWarning.canTShareLocalMusic'))
        return
      }
      if (!canCopy) {
        showDisabledReason(resolvedMissingReason)
        return
      }
      try {
        let b64 = ''
        const effectiveArtwork = httpArtwork ?? data.artwork
        if (type === 'track') {
          b64 = encodeMetadata('track', { ...(data as ShareTrackData), artwork: effectiveArtwork })
        } else if (type === 'playlist') {
          b64 = encodeMetadata('playlist', { ...(data as SharePlaylistData), artwork: effectiveArtwork })
        } else if (type === 'album') {
          b64 = encodeMetadata('album', { ...(data as ShareAlbumData), artwork: effectiveArtwork })
        } else if (type === 'lyrics') {
          b64 = encodeMetadata('lyrics', { ...(data as ShareLyricsData), artwork: effectiveArtwork })
        }

        const ok = await copyToClipboard(b64)
        if (ok) {
          setCopied(true)
          setDisabledReason(null)
          const toastMsg = t('share:shareActionButtons.copySuccessToast')
          setSuccessToast(toastMsg)
          ctx.emit('ui/toast', { message: toastMsg, tone: 'ok' })
          setTimeout(() => {
            setCopied(false)
            setSuccessToast(null)
          }, 3000)
        } else {
          ctx.logger?.error('Failed to copy base64 via clipboard')
          showDisabledReason(t('share:shareLyrics.canTCopyWritingTo'))
        }
      } catch (err) {
        ctx.logger?.error(`Failed to copy base64: ${String(err)}`)
        showDisabledReason(t('share:shareLyrics.canTCopyWritingTo'))
      }
    },
    [ctx, t, isLocal, canCopy, resolvedMissingReason, httpArtwork, showDisabledReason],
  )

  const handleDisabledCopyClick = useCallback(() => {
    if (isLocal) {
      showDisabledReason(t('share:localSourceWarning.canTShareLocalMusic'))
    } else {
      showDisabledReason(resolvedMissingReason)
    }
  }, [isLocal, t, resolvedMissingReason, showDisabledReason])

  const handleDisabledDownloadClick = useCallback(() => {
    showDisabledReason(t('share:localSourceWarning.canTShareLocalMusic'))
  }, [t, showDisabledReason])

  return {
    backgroundMode,
    setBackgroundMode,
    copied,
    setCopied,
    downloading,
    setDownloading,
    disabledReason,
    showDisabledReason,
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
  }
}
