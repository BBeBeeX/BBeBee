/**
 * React Native views for `@BBeBee/plugin-queue`.
 *
 * The up-next list, moved here from `plugin-player-ui-mobile`. The same hooks
 * and the same behaviour as the desktop twin — only the elements and the
 * *shape* differ. Anything here that would also be true on desktop belongs in
 * `@BBeBee/plugin-player/hooks` (docs/08 §1).
 */

import { createElement as h, Fragment } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { QueueItem } from '@BBeBee/protocol'
import { QUEUE_VIEWS } from '@BBeBee/plugin-queue/views'
import { queueTrackFallback, useQueue, useTracksByUrn, useTransport } from '@BBeBee/plugin-player/hooks'
import { ContextMenu, EmptyState, List, TrackRow, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'


/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

/** The up-next list. */
export function QueueScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const queue = useQueue(ctx)
  const state = useTransport(ctx)
  // Cover, title and artist come from the catalogue read the list does for
  // itself. A row the read has not answered for yet — a write in flight, a
  // removed source — never shows the URN: the playing item borrows the
  // transport's metadata, the rest say they are loading.
  const tracks = useTracksByUrn(ctx, queue.map((item) => item.trackUrn))
  const menu = useTrackMenu(ctx)

  if (queue.length === 0) {
    return h(EmptyState, {
      icon: '🎵',
      title: t('queue:index.nothingQueued'),
      description: t('queue:index.playSomethingFromYourLibrary'),
    })
  }

  return h(
    Fragment,
    null,
    h(List<QueueItem>, {
      items: queue,
      accessibilityLabel: t('queue:index.queue'),
      estimatedItemSize: tokens.size.row,
      keyExtractor: (item) => item.id,
      renderItem: (item) => {
        const track =
          tracks.get(item.trackUrn) ??
          queueTrackFallback(item, state.nowPlaying, item.id === state.currentItemId)
        return h(CachedTrackRow, {
          ctx,
          track,
          active: item.id === state.currentItemId,
          // A row tap means "play that one", and the track is in the queue by
          // definition — so playFromContext jumps to it without touching the
          // queue the user already has.
          onPress: () => void ctx.player.playFromContext(item.trackUrn),
          onMore: (anchor) => menu.open({ track }, anchor),
        })
      },
    }),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-queue-ui-mobile'

/**
 * `sources` is what the row hydration goes through; `player` is the queue
 * model itself. Both are required — a queue row with no catalogue read is
 * exactly the state this screen has `queueTrackFallback` for.
 */
export const inject = ['ui', 'player', 'sources']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the desktop twin, and the reason this closure exists (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-queue-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(QUEUE_VIEWS.queue, bound(ctx, QueueScreen))
  }, 'queue-ui-mobile')
}

export default { name, inject, apply }
