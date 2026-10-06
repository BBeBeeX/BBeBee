/**
 * The view ids `plugin-library` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const LIBRARY_VIEWS = {
  /**
   * The library itself: playlists, albums and collections side by side.
   *
   * It was `sources.library` — a catalogue browse with All/Local/Favorites
   * scopes — until the curation model became the front door. Albums are still
   * the catalogue's, read through `ctx.sources`; playlists and collections are
   * this plugin's.
   */
  home: 'library.home',
  /** One playlist's tracks. */
  playlist: 'library.playlist',
  /** One collection's members — a folder of tracks, albums and playlists. */
  collection: 'library.collection',
  /** Saved tracks, albums, artists and playlists. */
  favorites: 'library.favorites',
  /** Local files on this device. */
  local: 'library.local',
  /** The local user profile card in the settings screen. */
  profileSettings: 'library.profile',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const LIBRARY_ROUTES = LIBRARY_VIEWS
