import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef, Track } from '@BBeBee/protocol'
import { nativePrimitives, tablerIcon } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from './CachedArtwork.js'

export interface QuadArtworkCollageProps {
  ctx: Context
  tracks: readonly (Track | undefined)[]
  customArtwork?: ArtworkRef
  size?: number
  radius?: number
}

export function QuadArtworkCollage({
  ctx,
  tracks,
  customArtwork,
  size = 100,
  radius = tokens.radius.md,
}: QuadArtworkCollageProps): ReactElement {
  const native = nativePrimitives()

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
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          width: size,
          height: size,
          overflow: 'hidden',
        },
      },
      uniqueArtworks.slice(0, 4).map((art, i) =>
        h(
          native.View as never,
          { key: i, style: { width: half, height: half, overflow: 'hidden' } },
          h(CachedArtwork, { ctx, artwork: art, size: half, radius: 0 }),
        ),
      ),
    )
  } else if (uniqueArtworks.length > 0) {
    content = h(CachedArtwork, { ctx, artwork: uniqueArtworks[0], size, radius: 0 })
  } else {
    content = h(
      native.View as never,
      {
        style: {
          width: size,
          height: size,
          backgroundColor: '#282828',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      tablerIcon('music', { size: Math.floor(size / 3), color: '#7f7f7f' }),
    )
  }

  return h(
    native.View as never,
    {
      style: {
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        elevation: 4,
      },
    },
    content,
  )
}
