import { useCallback } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, PlayerService, SourcesService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

/**
 * Play a recommendation card's album from the top, in album order.
 *
 * The counterpart of `openCard` (which navigates to `album.view`): the
 * card's play chip calls this, the card body calls that, and the chip
 * stops propagation so the two never both fire. Album tracks come from
 * `ctx.sources.getAlbum` — the same read the recent/favorites album
 * shelves already use to resolve an album URN — and playback starts with
 * `playFromContext` so the queue context is the album itself.
 */
export function usePlayAlbum(ctx: Context): (entry: BrowseEntry) => void {
  return useCallback(
    (entry: BrowseEntry) => {
      if (!entry.urn || entry.kind !== 'album') return
      const player = serviceOf<PlayerService>(ctx, 'player')
      const sources = serviceOf<SourcesService>(ctx, 'sources')
      if (!player || !sources) return
      void sources
        .getAlbum(entry.urn)
        .then((detail) => {
          const urns = detail?.tracks?.map((t) => t.urn) ?? []
          if (urns[0]) {
            void player.playFromContext(urns[0], urns, {
              context: { kind: 'album', urn: entry.urn, label: entry.title },
            })
          }
        })
        .catch(() => {})
    },
    [ctx],
  )
}
