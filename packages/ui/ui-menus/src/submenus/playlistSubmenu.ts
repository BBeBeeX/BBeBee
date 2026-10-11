import type { SubmenuSpec } from '@BBeBee/ui-core'
import type { LibraryService, Playlist } from '@BBeBee/protocol'

/**
 * "Add to a playlist": filter, create, then the list.
 *
 * The model is precomputed rather than fetched inside the submenu because the
 * kit is dumb by design — it renders what it is handed. The caller resolves
 * `playlists` once, when the menu opens.
 *
 * Smart playlists are disabled: their tracks come from rules, so there is no
 * row an add could write (the service refuses, and a menu item that throws is
 * worse than one that is visibly unavailable).
 */
export function addToPlaylistSubmenu(
  library: LibraryService | undefined,
  trackUrns: readonly string[],
  playlists: readonly Playlist[],
  opts?: { title?: string; searchPlaceholder?: string; excludePlaylistUrn?: string },
): SubmenuSpec | undefined {
  if (!library || trackUrns.length === 0) return undefined
  const filteredPlaylists = opts?.excludePlaylistUrn
    ? playlists.filter((p) => p.urn !== opts.excludePlaylistUrn)
    : playlists
  return {
    title: opts?.title ?? 'Add to playlist',
    searchPlaceholder: opts?.searchPlaceholder ?? 'Find playlist',
    emptyLabel: 'No matching playlists',
    create: {
      label: 'New playlist',
      placeholder: 'Playlist name',
      onSelect: async (name) => {
        const playlist = await library.createPlaylist(name)
        await library.addTracks(playlist.urn, trackUrns)
      },
    },
    items: filteredPlaylists.map((playlist) => ({
      id: playlist.urn,
      label: playlist.name,
      icon: 'playlist-add',
      ...(playlist.isSmart ? { disabled: true } : {}),
      onSelect: async () => {
        await library.addTracks(playlist.urn, trackUrns)
      },
    })),
  }
}
