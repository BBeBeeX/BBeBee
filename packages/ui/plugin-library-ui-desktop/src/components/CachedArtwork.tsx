import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { Artwork } from '@BBeBee/ui-kit-desktop'

/** `<Artwork>`, with the cover resolved through `ctx.cache` first. */
export function CachedArtwork({
  ctx,
  priority = 1,
  ...props
}: ArtworkProps & { ctx: Context; priority?: 0 | 1 | 2 }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork, priority)
  return h(Artwork, { ...props, artwork })
}
