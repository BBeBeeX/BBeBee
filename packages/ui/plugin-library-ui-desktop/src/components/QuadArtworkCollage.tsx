import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef, Track } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { CachedArtwork } from './CachedArtwork.js'

export function QuadArtworkCollage({
  ctx,
  tracks,
  customArtwork,
  size = 232,
  radius = 6,
  onEdit,
}: {
  ctx: Context
  tracks: readonly (Track | undefined)[]
  customArtwork?: ArtworkRef
  size?: number
  radius?: number
  onEdit?: () => void
}): ReactElement {
  const [hovered, setHovered] = useState(false)

  const artworksWithTracks = tracks.filter((t): t is Track => Boolean(t?.artwork))
  const uniqueArtworks: ArtworkRef[] = []
  const seenSources = new Set<string>()
  for (const t of artworksWithTracks) {
    const src = t.artwork?.sourceUrl || t.artwork?.id || t.urn
    if (src && !seenSources.has(src)) {
      seenSources.add(src)
      if (t.artwork) uniqueArtworks.push(t.artwork)
    }
    if (uniqueArtworks.length >= 4) break
  }

  let content: ReactElement
  if (customArtwork?.sourceUrl) {
    content = h(CachedArtwork, { ctx, artwork: customArtwork, size, radius: 0 })
  } else if (uniqueArtworks.length >= 4) {
    const half = Math.floor(size / 2)
    content = h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: `${half}px ${half}px`,
          gridTemplateRows: `${half}px ${half}px`,
          width: size,
          height: size,
          overflow: 'hidden',
        },
      },
      uniqueArtworks.slice(0, 4).map((art, i) =>
        h(
          'div',
          { key: i, style: { width: half, height: half, overflow: 'hidden' } },
          h(CachedArtwork, { ctx, artwork: art, size: half, radius: 0 }),
        ),
      ),
    )
  } else if (uniqueArtworks.length > 0) {
    content = h(CachedArtwork, { ctx, artwork: uniqueArtworks[0], size, radius: 0 })
  } else {
    content = h(
      'div',
      {
        style: {
          width: size,
          height: size,
          backgroundColor: '#282828',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#7f7f7f',
        },
      },
      tablerIcon('music', { size: Math.floor(size / 3), color: '#7f7f7f' }),
    )
  }

  return h(
    'div',
    {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onEdit,
      style: {
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
        cursor: onEdit ? 'pointer' : 'default',
        flexShrink: 0,
      },
    },
    content,
    onEdit && hovered
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: '#FFFFFF',
              zIndex: 2,
            },
          },
          tablerIcon('pencil', { size: 40, color: 'currentColor' }),
          h('span', { style: { fontSize: 14, fontWeight: 600 } }, '选择照片'),
        )
      : null,
  )
}
