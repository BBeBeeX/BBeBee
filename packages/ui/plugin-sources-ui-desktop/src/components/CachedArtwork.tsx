import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { Artwork, TrackRow } from '@BBeBee/ui-kit-desktop'
import type { ArtworkProps, TrackRowProps } from '@BBeBee/ui-core'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 */
export function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
export function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}
