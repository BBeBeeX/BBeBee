/**
 * The context-menu models: which actions exist for a track, a playlist and a
 * collection, and what each one does.
 *
 * This is the "write the `if` once" half of docs/08 §1. The kits render
 * `MenuItemSpec`s and know nothing about playlists or queues; this package
 * knows every action and no pixels, so both shells offer the same menu in the
 * same order with the same words.
 *
 * It is Layer 5, not Layer 4, deliberately: it composes four features
 * (`ctx.library`, `ctx.player`, `ctx.downloads`, `ctx.ui`) and names another
 * feature's route id, which a Layer 4 plugin may not do to a sibling. Every
 * service is read through `serviceOf`, so a build without downloads simply
 * has no Download item rather than a menu that throws.
 *
 * The plugin/collection submenu is where the user's spec lives: a filter
 * field, a "new playlist" row, then every playlist.
 */

export { type MenuController } from './types.js'

export { addToPlaylistSubmenu } from './submenus/playlistSubmenu.js'
export { addToCollectionSubmenu } from './submenus/collectionSubmenu.js'
export { sleepTimerSubmenu } from './submenus/sleepTimerSubmenu.js'

export {
  type TrackMenuTarget,
  type TrackMenuOptions,
  type TrackMenuController,
  trackMenuItems,
  useTrackMenu,
} from './menus/trackMenu.js'

export {
  type PlaylistMenuOptions,
  type PlaylistMenuController,
  playlistMenuItems,
  usePlaylistMenu,
} from './menus/playlistMenu.js'

export {
  type AddToCollectionOptions,
  type AddToCollectionController,
  type CollectionMenuOptions,
  type CollectionMenuController,
  addToCollectionOnlyItems,
  useAddToCollection,
  collectionMenuItems,
  useCollectionMenu,
} from './menus/collectionMenu.js'

export {
  type SaveToPlaylistTrack,
  type SaveToPlaylistOption,
  type SaveToCollectionOption,
  type SaveToPlaylistMenuController,
  useSaveToPlaylistMenu,
} from './menus/saveToPlaylistMenu.js'

export {
  type SortOption,
  type SortOrder,
  sortMenuItems,
} from './menus/sortMenu.js'

export {
  type ResourceUrlTarget,
  resolveOriginalResourceUrl,
  openExternalUrl,
} from './utils/resourceUrls.js'
