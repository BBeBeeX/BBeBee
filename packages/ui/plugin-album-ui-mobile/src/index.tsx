/**
 * React Native views for `@bbebee/plugin-album`.
 *
 * The desktop twin's one screen, transcribed for the phone: a back affordance,
 * a centred cover with the album's title and "Play album", then the track
 * list. Layout and event wiring only — the read and the playback semantics
 * live in `@bbebee/plugin-album/hooks` and `ctx.player` (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadsService, PlayerService, Track } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useAlbum } from '@BBeBee/plugin-album/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { Artwork, Button, ContextMenu, EmptyState, List, Text, TrackRow, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, TrackRowProps } from '@BBeBee/ui-core'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at the call site because the album
 * header is not a list row: the hook suppresses the remote URL while the cache
 * fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

export function AlbumScreen({
  ctx,
  urn,
  onBack,
}: {
  ctx: Context
  urn?: string
  onBack?: () => void
}): ReactElement {
  const native = nativePrimitives()
  const album = useAlbum(ctx, urn)
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const menu = useTrackMenu(ctx)
  const { t } = useI18n(ctx)

  const handleBack = () => {
    // The shell's own back handler when it passed one; otherwise the library,
    // which is where an album is reached from in every shell that exists.
    if (onBack) onBack()
    else serviceOf<{ navigate(id: string): void }>(ctx, 'ui')?.navigate(LIBRARY_VIEWS.home)
  }

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: t('album:index.loadingAlbum') })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: '⚠',
      title: t('album:index.albumUnavailable'),
      description: album.error?.message,
      action: h(Button, { onPress: handleBack, variant: 'secondary', children: t('album:index.backToLibrary') }),
    })
  }

  const detail = album.data
  const urns = detail.tracks.map((track) => track.urn)
  const player = serviceOf<PlayerService>(ctx, 'player')

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[2],
        },
      },
      h(
        native.Pressable as never,
        {
          accessibilityRole: 'button',
          accessibilityLabel: t('album:index.backToLibrary'),
          onPress: handleBack,
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: tokens.space[1],
            paddingHorizontal: tokens.space[2],
          },
        },
        h(Text, { variant: 'sm', tone: 'accent', children: t('album:index.backToLibraryShort') }),
      ),
    ),
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[2], padding: tokens.space[4] } },
      h(CachedArtwork, { ctx, artwork: detail.artwork, seed: detail.urn, size: 200, radius: tokens.radius.md }),
      h(Text, { variant: 'xl', numberOfLines: 2, children: detail.title }),
      h(Text, {
        tone: 'muted',
        children: detail.artists?.map((a) => a.name).join(', ') ?? '',
      }),
      h(Button, {
        // Playback announces itself in the mini-player; no navigation.
        onPress: () =>
          void player?.playNow(urns, {
            context: { kind: 'album', urn: detail.urn, label: detail.title },
          }),
        children: t('album:index.playAlbum'),
        disabled: detail.tracks.length === 0,
      }),
    ),
    h(List<Track>, {
      items: detail.tracks,
      accessibilityLabel: t('album:index.tracksOn', { title: detail.title }),
      estimatedItemSize: tokens.size.row,
      keyExtractor: (track) => track.urn,
      empty: h(EmptyState, { title: t('album:index.thisAlbumHasNoTracks') }),
      renderItem: (track) =>
        h(CachedTrackRow, {
          ctx,
          track,
          showArtwork: false,
          // A tap plays the track in the list it was tapped in: jump if the
          // queue already holds it, otherwise the whole album becomes the
          // queue, starting here.
          onPress: () => {
            void player?.playFromContext(track.urn, urns, {
              context: { kind: 'album', urn: detail.urn, label: detail.title },
            })
          },
          onDownload: downloads ? () => void downloads.enqueue([track]) : undefined,
          onMore: (anchor) => menu.open({ track }, anchor),
        }),
    }),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-album-ui-mobile'

/**
 * `sources` is required (the album read goes through it); `player` and
 * `downloads` are read with `serviceOf`, so a build without either draws the
 * screen without the control that would call it.
 */
export const inject = ['ui', 'sources']

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
  ctx.logger.info('plugin-album-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(ALBUM_VIEWS.album, bound(ctx, AlbumScreen))
  }, 'album-ui-mobile')
}

export default { name, inject, apply }
