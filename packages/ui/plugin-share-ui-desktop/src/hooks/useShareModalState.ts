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
import { useImageColor } from '@BBeBee/ui-kit-desktop'
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
  missingReason = '无法复制：缺少有效标题等元数据',
}: UseShareModalStateOptions<T>) {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('cover')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [disabledReason, setDisabledReason] = useState<string | null>(null)

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
    setDisabledReason(reason)
    setTimeout(() => setDisabledReason(null), 3500)
  }, [])

  const canCopy = !isLocal && isValid
  const canDownload = !isLocal

  const copyBase64 = useCallback(
    async (
      type: ShareType,
      data: ShareTrackData | SharePlaylistData | ShareAlbumData | ShareLyricsData,
    ) => {
      if (isLocal) {
        showDisabledReason('无法分享本地音乐')
        return
      }
      if (!canCopy) {
        showDisabledReason(missingReason)
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
          setTimeout(() => setCopied(false), 2000)
        } else {
          ctx.logger?.error('Failed to copy base64 via clipboard')
          showDisabledReason('无法复制：剪贴板写入失败，请检查系统权限')
        }
      } catch (err) {
        ctx.logger?.error(`Failed to copy base64: ${String(err)}`)
        showDisabledReason('无法复制：剪贴板写入失败，请检查系统权限')
      }
    },
    [ctx, isLocal, canCopy, missingReason, httpArtwork, showDisabledReason],
  )

  const handleDisabledCopyClick = useCallback(() => {
    if (isLocal) {
      showDisabledReason('无法分享本地音乐')
    } else {
      showDisabledReason(missingReason)
    }
  }, [isLocal, missingReason, showDisabledReason])

  const handleDisabledDownloadClick = useCallback(() => {
    showDisabledReason('无法分享本地音乐')
  }, [showDisabledReason])

  return {
    backgroundMode,
    setBackgroundMode,
    copied,
    setCopied,
    downloading,
    setDownloading,
    disabledReason,
    showDisabledReason,
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
