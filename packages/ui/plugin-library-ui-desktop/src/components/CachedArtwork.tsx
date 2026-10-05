import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { Artwork } from '@BBeBee/ui-kit-desktop'

/** `<Artwork>`, with the cover resolved through `ctx.cache` first. */
export function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}
