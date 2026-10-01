import type { Track } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'

export interface ResourceUrlTarget {
  urn?: string
  track?: Track
  kind?: 'track' | 'album' | 'playlist'
  sourceUrl?: string
  payload?: Record<string, unknown>
}

/**
 * Resolves the original web/browser URL for a track, album, or playlist from a third-party source.
 * Returns undefined if it is a local resource or cannot be mapped to a web URL.
 */
export function resolveOriginalResourceUrl(target: ResourceUrlTarget | string): string | undefined {
  let urn: string | undefined
  let track: Track | undefined
  let kind: string | undefined
  let directSourceUrl: string | undefined
  let directPayload: Record<string, unknown> | undefined

  if (typeof target === 'string') {
    urn = target
  } else {
    urn = target.urn ?? target.track?.urn
    track = target.track
    kind = target.kind
    directSourceUrl = target.sourceUrl
    directPayload = target.payload
  }

  // 1. Direct explicit sourceUrl or payload on track / target
  if (directSourceUrl && typeof directSourceUrl === 'string' && directSourceUrl.startsWith('http')) {
    return directSourceUrl
  }

  if (track) {
    const tAny = track as unknown as Record<string, unknown>
    if (typeof tAny.sourceUrl === 'string' && tAny.sourceUrl.startsWith('http')) {
      return tAny.sourceUrl
    }
    const payload = (tAny.payload ?? directPayload) as Record<string, unknown> | undefined
    if (payload) {
      if (typeof payload.webUrl === 'string' && payload.webUrl.startsWith('http')) {
        return payload.webUrl
      }
      if (typeof payload.url === 'string' && payload.url.startsWith('http')) {
        return payload.url
      }
    }
  } else if (directPayload) {
    if (typeof directPayload.webUrl === 'string' && directPayload.webUrl.startsWith('http')) {
      return directPayload.webUrl
    }
    if (typeof directPayload.url === 'string' && directPayload.url.startsWith('http')) {
      return directPayload.url
    }
  }

  if (!urn) return undefined

  if (urn.startsWith('http://') || urn.startsWith('https://')) {
    return urn
  }

  const parsed = tryParseUrn(urn)
  if (!parsed || parsed.sourceId === 'local') {
    return undefined
  }

  const effectiveKind = kind || parsed.kind
  const id = parsed.id
  const sourceId = parsed.sourceId.toLowerCase()

  if (id.startsWith('http://') || id.startsWith('https://')) {
    return id
  }

  // Bilibili
  if (sourceId.includes('bili')) {
    if (effectiveKind === 'track') {
      const match = id.replace(/^bili_video_/, '').match(/^([a-zA-Z0-9]+)(?:_p(\d+))?/)
      if (match) {
        const bvid = match[1]
        const p = match[2]
        if (bvid && (bvid.startsWith('BV') || bvid.startsWith('bv') || bvid.startsWith('av'))) {
          return p && p !== '1'
            ? `https://www.bilibili.com/video/${bvid}?p=${p}`
            : `https://www.bilibili.com/video/${bvid}`
        }
      }
    } else {
      // Album or Playlist or Collection
      const seasonMatch = id.match(/^bili_season_(\d+)_(\d+)$/)
      if (seasonMatch) {
        return `https://space.bilibili.com/${seasonMatch[1]}/channel/collectiondetail?sid=${seasonMatch[2]}`
      }
      const seriesMatch = id.match(/^bili_series_(\d+)_(\d+)$/)
      if (seriesMatch) {
        return `https://space.bilibili.com/${seriesMatch[1]}/channel/seriesdetail?sid=${seriesMatch[2]}`
      }
      const collectMatch = id.match(/^bili_(?:collect|favlist)_(\d+)$/)
      if (collectMatch) {
        return `https://www.bilibili.com/medialist/play/ml${collectMatch[1]}`
      }
      const match = id.replace(/^bili_video_/, '').match(/^([a-zA-Z0-9]+)(?:_p(\d+))?/)
      if (match) {
        const bvid = match[1]
        const p = match[2]
        if (bvid && (bvid.startsWith('BV') || bvid.startsWith('bv') || bvid.startsWith('av'))) {
          return p && p !== '1'
            ? `https://www.bilibili.com/video/${bvid}?p=${p}`
            : `https://www.bilibili.com/video/${bvid}`
        }
      }
    }
  }

  // YouTube
  if (sourceId.includes('youtube')) {
    if (effectiveKind === 'track') {
      return `https://www.youtube.com/watch?v=${id}`
    } else {
      return `https://www.youtube.com/playlist?list=${id}`
    }
  }

  // NetEase
  if (sourceId.includes('netease') || sourceId.includes('163')) {
    if (effectiveKind === 'track') {
      return `https://music.163.com/#/song?id=${id}`
    } else if (effectiveKind === 'album') {
      return `https://music.163.com/#/album?id=${id}`
    } else if (effectiveKind === 'playlist') {
      return `https://music.163.com/#/playlist?id=${id}`
    }
  }

  // QQ Music
  if (sourceId.includes('qq')) {
    if (effectiveKind === 'track') {
      return `https://y.qq.com/n/ryqq/songDetail/${id}`
    } else if (effectiveKind === 'album') {
      return `https://y.qq.com/n/ryqq/albumDetail/${id}`
    } else if (effectiveKind === 'playlist') {
      return `https://y.qq.com/n/ryqq/playlist/${id}`
    }
  }

  return undefined
}

/**
 * Opens an external web URL in the system's default browser or external handler.
 */
export function openExternalUrl(url: string): void {
  if (!url) return
  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined
  const bbebee = win?.BBeBee as { shell?: { openExternal?: (u: string) => Promise<void> } } | undefined
  if (bbebee?.shell?.openExternal) {
    void bbebee.shell.openExternal(url)
  } else if (typeof window !== 'undefined' && window.open) {
    window.open(url, '_blank')
  }
}
