/**
 * React Native views for `@bbebee/plugin-library`.
 *
 * The same screens as the desktop twin — the unified library, one playlist,
 * one collection, favorites, and local files — registered as views and kept
 * as the package's barrel. Layout and event wiring only: the reads, the
 * reload rules and every derived value come from
 * `@bbebee/plugin-library/hooks` (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'

export { LibraryScreen } from './screens/LibraryScreen.js'
export { UserProfileCard } from './components/UserProfileCard.js'
export { LocalMusicScreen, type LocalMusicScreenProps } from './screens/LocalMusicScreen.js'
export { PlaylistDetailScreen } from './screens/PlaylistDetailScreen.js'
export { FavoritesScreen } from './screens/FavoritesScreen.js'
export { CollectionScreen } from './screens/CollectionScreen.js'
export { UnifiedRow, type UnifiedItem } from './components/UnifiedRow.js'
export { CachedArtwork } from './components/CachedArtwork.js'
export { LibraryModals } from './components/LibraryModals.js'
export { BatchActionBar, type BatchActionBarProps } from './components/BatchActionBar.js'
export { SaveToPlaylistSheet, type SaveToPlaylistSheetProps } from './components/SaveToPlaylistSheet.js'
export { MobileLibraryTrackRow, type MobileLibraryTrackRowProps } from './components/MobileLibraryTrackRow.js'
export { LocalAlbumCard, type LocalAlbumCardProps } from './components/LocalAlbumCard.js'
export { LocalArtistRow, type LocalArtistRowProps } from './components/LocalArtistRow.js'
export { useLibraryActions, type DeleteConfirmTarget } from './hooks/useLibraryActions.js'
export { useTrackLibraryInfo } from './hooks/useTrackLibraryInfo.js'

import { LibraryScreen } from './screens/LibraryScreen.js'
import { LocalMusicScreen } from './screens/LocalMusicScreen.js'
import { PlaylistDetailScreen } from './screens/PlaylistDetailScreen.js'
import { FavoritesScreen } from './screens/FavoritesScreen.js'
import { CollectionScreen } from './screens/CollectionScreen.js'
import { UserProfileCard } from './components/UserProfileCard.js'

export const name = 'plugin-library-ui-mobile'

export const inject = ['ui', 'library', 'player', 'sources']

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
  ctx.logger.info('plugin-library-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LIBRARY_VIEWS.home, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.playlist, bound(ctx, PlaylistDetailScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.collection, bound(ctx, CollectionScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.favorites, bound(ctx, FavoritesScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.local, bound(ctx, LocalMusicScreen))
    // The local user profile card — the settings screen embeds it wherever
    // the profile contribution lands (the appearance & language page here).
    yield ctx.ui.registerView(LIBRARY_VIEWS.profileSettings, bound(ctx, UserProfileCard))
  }, 'library-ui-mobile')
}

export default { name, inject, apply }
