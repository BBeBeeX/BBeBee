/**
 * Hooks shared by the desktop now-playing surfaces.
 *
 * `useCurrentTrack` resolves the playing track to a full `Track`: the catalog
 * copy when the sources service knows it, a shell built from the transport's
 * now-playing metadata otherwise — so the bar and the play page render (and
 * offer menus for) the same track whether or not it is in the library.
 */

import { useMemo } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { useTracksByUrn, useTransport } from '@BBeBee/toolkit/hooks'

export function useCurrentTrack(ctx: Context): Track | undefined {
  const state = useTransport(ctx)
  const tracksMap = useTracksByUrn(ctx, state.trackUrn ? [state.trackUrn] : [])
  const catalogTrack = state.trackUrn ? tracksMap.get(state.trackUrn) : undefined

  return useMemo(() => {
    if (catalogTrack) return catalogTrack
    if (!state.trackUrn || !state.nowPlaying) return undefined
    return {
      urn: state.trackUrn,
      title: state.nowPlaying.title,
      artists: state.nowPlaying.artist
        ? [{ urn: `${state.trackUrn}#artist`, name: state.nowPlaying.artist, role: 'main', ordinal: 0 }]
        : [],
      albumTitle: state.nowPlaying.album,
      artwork: state.nowPlaying.artwork,
      loved: false,
    }
  }, [catalogTrack, state.trackUrn, state.nowPlaying])
}
