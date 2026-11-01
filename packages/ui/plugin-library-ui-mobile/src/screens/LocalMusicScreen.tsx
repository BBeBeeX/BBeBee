/**
 * Local & downloads — the mobile transcription of the desktop twin's
 * `LocalMusicScreen`. The desktop triples into songs/albums/artists views;
 * on a phone the song list is the surface that matters, so this screen keeps
 * the desktop's header copy ("Files from this computer • N songs"), its
 * per-track actions and its play-all, and leaves the album and artist
 * groupings to the library's filter chips.
 */

import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { fetchAllLocalTracks } from '@bbebee/plugin-library/hooks'
import { playFromList } from '@bbebee/plugin-sources/hooks'
import { Button, ContextMenu, EmptyState, List, Text, TrackRow, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@bbebee/plugin-cache/hooks'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'

export function LocalMusicScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx)

  useEffect(() => {
    let cancelled = false
    if (!ctx.sources?.listTracks) return
    fetchAllLocalTracks(ctx.sources)
      .then((items) => {
        if (!cancelled) setTracks(items)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      cancelled = true
    }
  }, [ctx])

  const urns = useMemo(() => tracks.map((track) => track.urn), [tracks])
  const playAll = (trackUrn: string) =>
    void playFromList(ctx, trackUrn, {
      urns,
      context: { kind: 'local', label: t('library:library.localAndDownloads') },
    })

  return h(
    native.View as never,
    {
      style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] },
      accessibilityLabel: t('library:library.localAndDownloads'),
    },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, t('library:library.localAndDownloads')),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          t('library:localMusic.filesFromThisComputerSongs', { length: tracks.length }),
        ),
      ),
      h(Button, {
        onPress: () => urns[0] && playAll(urns[0]),
        disabled: urns.length === 0,
        testID: 'local-play-all',
        children: t('library:favorites.playAll'),
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<Track>, {
        testID: 'local-tracks-list',
        items: [...tracks],
        keyExtractor: (track) => track.urn,
        empty: h(EmptyState, {
          icon: '♪',
          title: t('library:localMusic.afterAddingAMusicFolder'),
          description: t('library:library.importAMusicSourceScan'),
        }),
        renderItem: (track) =>
          h(CachedTrackRow, {
            ctx,
            track,
            onPress: () => playAll(track.urn),
            onMore: (anchor) => menu.open({ track }, anchor),
          }),
      }),
    ),
    h(ContextMenu, { ctx, ...menu.menuProps }),
  )
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? ({ ...props.track, artwork } as Track) : props.track,
  })
}
