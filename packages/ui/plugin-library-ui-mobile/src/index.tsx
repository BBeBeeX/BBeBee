/**
 * React Native views for `@BBeBee/plugin-library`.
 *
 * The same four screens as the desktop twin: the library (playlists, albums
 * and collections), one playlist, one collection, and favorites. Layout and
 * event wiring only — the reads, the reload rules and every derived value come
 * from `@BBeBee/plugin-library/hooks` (docs/08 §1).
 *
 * The three library sections share one `List`, because a phone scrolls one
 * surface at a time and nesting a scroller inside a scroller is the classic
 * way to make neither work.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, Collection, Playlist, QueueSourceContext } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import {
  summariseLibrary,
  useCollectionDetail,
  useCollections,
  usePlaylist,
  usePlaylists,
  useSaved,
  type CollectionMember,
} from '@BBeBee/plugin-library/hooks'
import { useAlbums } from '@BBeBee/plugin-sources/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { Artwork, Button, ContextMenu, EmptyState, IconButton, List, Text, TextField, TrackRow, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useAddToCollection, useCollectionMenu, usePlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import type { MenuAnchor } from '@BBeBee/ui-core'

const p = () => palettes.dark

/** One row of the library: three sections in a single scroller. */
type LibraryRow =
  | { kind: 'playlist'; playlist: Playlist }
  | { kind: 'albums-heading' }
  | { kind: 'album'; album: Album }
  | { kind: 'collections-heading' }
  | { kind: 'collection'; collection: Collection }

/* ── the library ───────────────────────────────────────────────────────── */

/** `<Artwork>`, with the cover resolved through `ctx.cache` first. */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

export function LibraryScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const albums = useAlbums(ctx, { sort: 'title' })
  const [draft, setDraft] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const summary = summariseLibrary(playlists.data ?? [], collections.data ?? [], [])
  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)
  const albumMenu = useAddToCollection(ctx)

  const fail = (what: string) => (cause: unknown) =>
    setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)

  const createPlaylist = () => {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    setError(undefined)
    void ctx.library.createPlaylist(name).catch(fail('could not create the playlist'))
  }

  const createCollection = () => {
    const name = collectionDraft.trim()
    if (!name) return
    setCollectionDraft('')
    setError(undefined)
    void ctx.library.createCollection(name).catch(fail('could not create the collection'))
  }

  // List actions need the tracks, which a row does not carry — resolve them
  // before opening, so the menu never offers an action against an empty list.
  const openPlaylistMenu = (playlist: Playlist, anchor?: MenuAnchor) => {
    void ctx.library
      .getPlaylist(playlist.urn)
      .then((detail) =>
        playlistMenu.open(playlist, detail?.items.map((item) => item.trackUrn) ?? [], anchor),
      )
      .catch(() => playlistMenu.open(playlist, [], anchor))
  }

  const openCollectionMenu = (collection: Collection, anchor?: MenuAnchor) => {
    void ctx.library
      .listCollectionItems(collection.id)
      .then((page) =>
        collectionMenu.open(
          collection.name,
          page.items
            .map((item) => item.urn)
            .filter((entryUrn) => tryParseUrn(entryUrn)?.kind === 'track'),
          anchor,
        ),
      )
      .catch(() => collectionMenu.open(collection.name, [], anchor))
  }

  const rows: LibraryRow[] = [
    ...(playlists.data ?? []).map((playlist): LibraryRow => ({ kind: 'playlist', playlist })),
    { kind: 'albums-heading' },
    ...albums.items.map((album): LibraryRow => ({ kind: 'album', album })),
    { kind: 'collections-heading' },
    ...(collections.data ?? []).map((collection): LibraryRow => ({ kind: 'collection', collection })),
  ]

  return h(
    native.View as never,
    {
      style: { flex: 1, backgroundColor: p().bg.base, padding: tokens.space[4], gap: tokens.space[3] },
      accessibilityLabel: 'Library',
    },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space[2], flexWrap: 'wrap' } },
      h(Text, { variant: 'xl' }, 'Library'),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        `${summary.playlists} playlists · ${albums.items.length} albums · ${summary.collections} collections`,
      ),
      h(Button, {
        variant: 'secondary',
        onPress: () => ctx.ui.navigate(LIBRARY_VIEWS.favorites),
        children: 'Favorites',
      }),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(TextField, {
          value: draft,
          onChange: setDraft,
          placeholder: 'New playlist name',
          testID: 'playlists-new-name',
        }),
      ),
      h(Button, {
        onPress: createPlaylist,
        disabled: draft.trim().length === 0,
        testID: 'playlists-create',
        children: 'Create',
      }),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(TextField, {
          value: collectionDraft,
          onChange: setCollectionDraft,
          placeholder: 'New collection name',
          testID: 'collections-new-name',
        }),
      ),
      h(Button, {
        variant: 'secondary',
        onPress: createCollection,
        disabled: collectionDraft.trim().length === 0,
        testID: 'collections-create',
        children: 'Create',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error) : null,
    playlists.status === 'error'
      ? h(Text, { tone: 'error' }, `Could not read playlists: ${playlists.error?.message}`)
      : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<LibraryRow>, {
        testID: 'library-list',
        items: rows,
        keyExtractor: (row) =>
          row.kind === 'playlist'
            ? row.playlist.urn
            : row.kind === 'album'
              ? row.album.urn
              : row.kind === 'collection'
                ? row.collection.id
                : `${row.kind}-heading`,
        empty: h(EmptyState, {
          icon: '♪',
          title: 'Nothing here yet',
          description: 'Create a playlist or a collection, or import a source to fill the album list.',
        }),
        renderItem: (row) => {
          if (row.kind === 'albums-heading') {
            return h(
              native.View as never,
              { style: { paddingVertical: tokens.space[3] } },
              h(Text, { variant: 'lg' }, 'Albums'),
              h(
                Text,
                { variant: 'sm', tone: 'muted' },
                'Everything the catalogue knows, in the order the sources reported it.',
              ),
            )
          }
          if (row.kind === 'album') {
            return h(AlbumRow, {
              ctx,
              album: row.album,
              onOpen: () => ctx.ui.navigate(ALBUM_VIEWS.album, { urn: row.album.urn }),
              onMore: (anchor) => albumMenu.open(row.album.title, [row.album.urn], anchor),
            })
          }
          if (row.kind === 'collections-heading') {
            return h(
              native.View as never,
              { style: { paddingVertical: tokens.space[3] } },
              h(Text, { variant: 'lg' }, 'Collections'),
              h(
                Text,
                { variant: 'sm', tone: 'muted' },
                'A folder of your own: albums and playlists in one place. Collections can nest.',
              ),
            )
          }
          if (row.kind === 'playlist') {
            return h(PlaylistRow, {
              playlist: row.playlist,
              onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: row.playlist.urn }),
              onDelete: () =>
                void ctx.library
                  .deletePlaylist(row.playlist.urn)
                  .catch(fail('could not delete the playlist')),
              onMore: (anchor) => openPlaylistMenu(row.playlist, anchor),
            })
          }
          return h(CollectionRow, {
            collection: row.collection,
            onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.collection, { id: row.collection.id }),
            onDelete: () =>
              void ctx.library
                .deleteCollection(row.collection.id)
                .catch(fail('could not delete the collection')),
            onMore: (anchor) => openCollectionMenu(row.collection, anchor),
          })
        },
      }),
    ),
    h(ContextMenu, playlistMenu.menuProps),
    h(ContextMenu, collectionMenu.menuProps),
    h(ContextMenu, albumMenu.menuProps),
  )
}

function PlaylistRow({
  playlist,
  onOpen,
  onDelete,
  onMore,
}: {
  playlist: Playlist
  onOpen: () => void
  onDelete: () => void
  onMore: (anchor?: MenuAnchor) => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      onLongPress: () => onMore(),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[2],
        minHeight: tokens.size.touchTarget,
      },
    },
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, playlist.name),
      h(
        Text,
        { variant: 'sm', tone: 'muted', numberOfLines: 1 },
        playlist.isSmart ? 'Smart playlist' : `${playlist.trackCount ?? 0} tracks`,
      ),
    ),
    h(Button, { variant: 'ghost', onPress: onOpen, children: 'Open' }),
    h(IconButton, {
      icon: '⋯',
      accessibilityLabel: `More actions for ${playlist.name}`,
      variant: 'ghost',
      onPress: () => onMore(),
    }),
    h(IconButton, {
      icon: '🗑',
      accessibilityLabel: `Delete ${playlist.name}`,
      variant: 'ghost',
      onPress: onDelete,
    }),
  )
}

function CollectionRow({
  collection,
  onOpen,
  onDelete,
  onMore,
}: {
  collection: Collection
  onOpen: () => void
  onDelete: () => void
  onMore: (anchor?: MenuAnchor) => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      onLongPress: () => onMore(),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[2],
        minHeight: tokens.size.touchTarget,
      },
    },
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, collection.name),
      h(Text, { variant: 'sm', tone: 'muted' }, `${collection.itemCount ?? 0} items`),
    ),
    h(Button, { variant: 'ghost', onPress: onOpen, children: 'Open' }),
    h(IconButton, {
      icon: '⋯',
      accessibilityLabel: `More actions for ${collection.name}`,
      variant: 'ghost',
      onPress: () => onMore(),
    }),
    h(IconButton, {
      icon: '🗑',
      accessibilityLabel: `Delete ${collection.name}`,
      variant: 'ghost',
      onPress: onDelete,
    }),
  )
}

/* ── one playlist ──────────────────────────────────────────────────────── */

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const native = nativePrimitives()
  const state = usePlaylist(ctx, urn)
  const detail = state.data
  const urns = detail?.items.map((item) => item.trackUrn) ?? []
  const tracks = useTracksByUrn(ctx, urns)
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })

  const play = (trackUrn: string) => {
    if (!detail) return
    void ctx.player.playFromContext(trackUrn, urns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  if (!urn) return h(EmptyState, { title: 'No playlist chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the playlist', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.name),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          detail.isSmart
            ? 'Smart playlist — tracks come from its rules'
            : `${detail.trackCount ?? urns.length} tracks`,
        ),
      ),
      h(Button, {
        onPress: () => urns[0] && play(urns[0]),
        disabled: urns.length === 0,
        testID: 'playlist-play',
        children: 'Play',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'playlist-tracks',
        items: urns,
        keyExtractor: (trackUrn, index) => `${trackUrn}:${index}`,
        empty: h(EmptyState, {
          icon: '♪',
          title: 'Nothing here yet',
          description: detail.isSmart
            ? 'No track in the catalogue matches these rules right now.'
            : 'Add tracks from the library to fill this playlist.',
        }),
        renderItem: (trackUrn, index) => {
          const track = tracks.get(trackUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          return h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center' } },
            h(
              native.View as never,
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () => play(trackUrn),
                onMore: (anchor) =>
                  menu.open({ track, playlistItemId: detail.items[index]?.id }, anchor),
              }),
            ),
            detail.isSmart
              ? null
              : h(IconButton, {
                  icon: '×',
                  // The item's own id, not the track URN: the same track twice
                  // in a playlist is two rows, and removing one must not
                  // remove both.
                  accessibilityLabel: `Remove ${track.title} from ${detail.name}`,
                  variant: 'ghost',
                  onPress: () => {
                    const item = detail.items[index]
                    if (!item) return
                    setError(undefined)
                    void ctx.library.removeItems(detail.urn, [item.id]).catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                  },
                }),
          )
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── favorites ────────────────────────────────────────────────────────── */

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const urns = entries.map((entry) => entry.urn)
  const tracks = useTracksByUrn(ctx, urns)
  const player = serviceOf<{
    playFromContext(urn: string, contextUrns?: readonly string[], opts?: { context?: QueueSourceContext }): Promise<void>
  }>(ctx, 'player')
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx)

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(Text, { variant: 'xl' }, 'Favorites'),
      h(Text, { variant: 'sm', tone: 'muted' }, `${urns.length} saved`),
      h(Button, {
        variant: 'secondary',
        onPress: () =>
          urns[0] &&
          player?.playFromContext(urns[0], urns, {
            context: { kind: 'favorites', label: 'Favorites' },
          }),
        disabled: urns.length === 0,
        children: 'Play all',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    saved.status === 'error'
      ? h(Text, { tone: 'error' }, `Could not read favorites: ${saved.error?.message}`)
      : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'favorites-list',
        items: urns,
        keyExtractor: (entryUrn) => entryUrn,
        empty: h(EmptyState, {
          icon: '♡',
          title: 'Nothing saved yet',
          description: 'Save a track from the library and it lands here.',
        }),
        renderItem: (entryUrn) => {
          const track = tracks.get(entryUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, entryUrn)
          return h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center' } },
            h(
              native.View as never,
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () =>
                  player?.playFromContext(entryUrn, urns, {
                    context: { kind: 'favorites', label: 'Favorites' },
                  }),
                onMore: (anchor) => menu.open({ track }, anchor),
              }),
            ),
            h(IconButton, {
              icon: '♥',
              accessibilityLabel: `Remove ${track.title} from favorites`,
              variant: 'primary',
              onPress: () => {
                setError(undefined)
                void ctx.library
                  .setSaved(entryUrn, false)
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
              },
            }),
          )
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

function AlbumRow({
  ctx,
  album,
  onOpen,
  onMore,
}: {
  ctx: Context
  album: Album
  onOpen: () => void
  onMore: (anchor?: MenuAnchor) => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: album.title,
      onPress: onOpen,
      onLongPress: () => onMore(),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: tokens.size.touchTarget,
      },
    },
    h(CachedArtwork, {
      ctx,
      artwork: album.artwork,
      seed: album.urn,
      size: tokens.size.artworkThumb,
      radius: tokens.radius.sm,
    }),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, album.title),
      album.artists?.length
        ? h(Text, {
            variant: 'sm',
            tone: 'muted',
            numberOfLines: 1,
            children: album.artists.map((artist) => artist.name).join(', '),
          })
        : null,
    ),
    h(IconButton, {
      icon: '⋯',
      accessibilityLabel: `More actions for ${album.title}`,
      variant: 'ghost',
      onPress: () => onMore(),
    }),
  )
}

/* ── one collection ────────────────────────────────────────────────────── */

/**
 * A collection is a folder: tracks play, albums open the album page,
 * playlists open the playlist page. A member no service can answer for still
 * shows, titled by its URN — hiding it would lose something the user put
 * there.
 */
export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const native = nativePrimitives()
  const state = useCollectionDetail(ctx, id)
  const detail = state.data
  const members = detail?.members ?? []
  const trackUrns = members
    .filter((member) => member.kind === 'track' && member.track)
    .map((member) => member.urn)
  const menu = useTrackMenu(ctx)
  const player = serviceOf<{ playNow(urns: string[], opts?: { context?: QueueSourceContext }): Promise<void> }>(ctx, 'player')

  if (!id) return h(EmptyState, { title: 'No collection chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the collection', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.collection?.name ?? 'Collection'),
        h(Text, { variant: 'sm', tone: 'muted' }, `${members.length} items`),
      ),
      h(Button, {
        onPress: () =>
          trackUrns[0] &&
          void player?.playNow(trackUrns, {
            context: { kind: 'playlist', label: detail.collection?.name ?? 'Collection' },
          }),
        disabled: trackUrns.length === 0,
        testID: 'collection-play',
        children: 'Play',
      }),
    ),
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: [...members],
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: '🗂',
          title: 'Nothing in this collection yet',
          description: 'Add albums or playlists from the library.',
        }),
        renderItem: (member) => {
          if (member.kind === 'track' && member.track) {
            return h(
              native.View as never,
              { style: { flexDirection: 'row', alignItems: 'center' } },
              h(
                native.View as never,
                { style: { flex: 1, minWidth: 0 } },
                h(TrackRow, {
                  track: member.track,
                  onPress: () =>
                    void player?.playNow(trackUrns, {
                      context: { kind: 'playlist', label: detail.collection?.name ?? 'Collection' },
                    }),
                  onMore: (anchor) => menu.open({ track: member.track! }, anchor),
                }),
              ),
            )
          }
          return h(MemberRow, {
            member,
            onOpen: () => {
              if (member.kind === 'album') ctx.ui.navigate(ALBUM_VIEWS.album, { urn: member.urn })
              else if (member.kind === 'playlist') ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: member.urn })
            },
          })
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/** An album/playlist/unknown member: a labelled row that opens where it can. */
function MemberRow({ member, onOpen }: { member: CollectionMember; onOpen: () => void }): ReactElement {
  const native = nativePrimitives()
  const openable = member.kind === 'album' || member.kind === 'playlist'
  return h(
    native.Pressable as never,
    {
      accessibilityRole: openable ? 'button' : undefined,
      accessibilityLabel: member.title,
      disabled: !openable,
      onPress: openable ? onOpen : undefined,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: tokens.size.touchTarget,
      },
    },
    h(Text, { variant: 'md' }, member.kind === 'album' ? '💿' : member.kind === 'playlist' ? '≡' : '•'),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, member.title),
      member.subtitle ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, member.subtitle) : null,
    ),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

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
  }, 'library-ui-mobile')
}

export default { name, inject, apply }
