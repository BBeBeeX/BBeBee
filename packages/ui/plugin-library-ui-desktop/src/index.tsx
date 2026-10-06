/**
 * React DOM views for `@BBeBee/plugin-library`.
 *
 * Screens are modularized into dedicated components:
 * - LibraryScreen (home/sidebar with unified playlists, albums, artists, collections)
 * - PlaylistDetailScreen (playlist details, tracklist, sorting, editing)
 * - FavoritesScreen (loved tracks view)
 * - LocalMusicScreen (local audio files & albums)
 * - CollectionScreen (folder collections view)
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { LibraryScreen } from './screens/LibraryScreen.js'
import { PlaylistDetailScreen } from './screens/PlaylistDetailScreen.js'
import { FavoritesScreen } from './screens/FavoritesScreen.js'
import { LocalMusicScreen } from './screens/LocalMusicScreen.js'
import { CollectionScreen } from './screens/CollectionScreen.js'
import { UserProfileCard } from './components/UserProfileCard.js'

export { LibraryScreen, type LibraryScreenProps } from './screens/LibraryScreen.js'
export { PlaylistDetailScreen } from './screens/PlaylistDetailScreen.js'
export { FavoritesScreen } from './screens/FavoritesScreen.js'
export { LocalMusicScreen, type LocalMusicScreenProps } from './screens/LocalMusicScreen.js'
export { CollectionScreen } from './screens/CollectionScreen.js'
export { UserProfileCard } from './components/UserProfileCard.js'

export const name = 'plugin-library-ui-desktop'

export const inject = ['ui', 'library', 'player', 'sources']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
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
  ctx.logger.info('plugin-library-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LIBRARY_VIEWS.home, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.playlist, bound(ctx, PlaylistDetailScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.collection, bound(ctx, CollectionScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.favorites, bound(ctx, FavoritesScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.local, bound(ctx, LocalMusicScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.profileSettings, bound(ctx, UserProfileCard))
  }, 'library-ui-desktop')
}

export default { name, inject, apply }
