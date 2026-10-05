/**
 * View hooks for `ctx.library`.
 *
 * Written once here and consumed by both shells (docs/08 §4). Curation reads
 * are asynchronous *and* change from the outside — the same account on another
 * device, a scan landing, a smart playlist's rules suddenly matching — so every
 * hook re-reads on `library/changed` rather than trusting what it loaded once.
 *
 * A smart playlist's membership is derived and can change with no write at
 * all. That is why `usePlaylist` reloads on `library/changed` too: a scanned
 * track with the right year *is* in the playlist now, and the screen should
 * say so.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  Collection,
  LibraryEntry,
  LibraryService,
  Paged,
  Playlist,
  PlaylistDetail,
  SavedKind,
  SourcesService,
  Track,
  UrnKind,
  UserProfile,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { serviceOf, type AsyncState } from '@BBeBee/toolkit/hooks'

export interface LibraryRead<T> extends AsyncState<T> {
  reload(): void
}

interface LibraryReadFilter {
  onChanged?: (kind: UrnKind, urns: string[]) => boolean
  onCollectionsChanged?: boolean
}

/**
 * Run a curation read, reloading whenever the library changes.
 *
 * `key` is how the caller says the read's *inputs* changed — a playlist URN, a
 * saved kind — because `read` is a fresh closure on every render and effect
 * dependencies cannot reference it without re-running forever.
 */
function useLibraryRead<T>(
  ctx: Context,
  read: () => Promise<T>,
  key: string,
  filter?: LibraryReadFilter,
): LibraryRead<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' })
  const [generation, setGeneration] = useState(0)
  const readRef = useRef(read)
  readRef.current = read
  const filterRef = useRef(filter)
  filterRef.current = filter

  useEffect(() => {
    let cancelled = false
    setState((prev) => (prev.status === 'ready' ? prev : { ...prev, status: 'loading' }))
    readRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      })
    return () => void (cancelled = true)
  }, [ctx, key, generation])

  useEffect(() => {
    const offChanged = ctx.on('library/changed', (kind, urns) => {
      if (filterRef.current) {
        if (!filterRef.current.onChanged || !filterRef.current.onChanged(kind, urns ?? [])) {
          return
        }
      }
      setGeneration((n) => n + 1)
    })
    const offCollections = ctx.on('library/collections-changed', () => {
      if (filterRef.current) {
        if (!filterRef.current.onCollectionsChanged) {
          return
        }
      }
      setGeneration((n) => n + 1)
    })
    return () => {
      offChanged()
      offCollections()
    }
  }, [ctx])

  return { ...state, reload: useCallback(() => setGeneration((n) => n + 1), []) }
}

/** Walk every page of a paged read. Playlists and shelves are small; a shelf fifty screens long is not. */
async function readAll<T>(read: (cursor?: string) => Promise<Paged<T>>): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await read(cursor)
    items.push(...page.items)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return items
}

export function usePlaylists(ctx: Context): LibraryRead<readonly Playlist[]> {
  return useLibraryRead(
    ctx,
    () => readAll((cursor) => ctx.library.listPlaylists(cursor ? { cursor } : undefined)),
    'playlists',
    { onChanged: (kind) => kind === 'playlist' },
  )
}

/** One playlist, or `undefined` when there is no such URN. */
export function usePlaylist(ctx: Context, urn: string | undefined): LibraryRead<PlaylistDetail | undefined> {
  return useLibraryRead(
    ctx,
    () => (urn ? ctx.library.getPlaylist(urn) : Promise.resolve(undefined)),
    `playlist:${urn ?? ''}`,
    { onChanged: (kind, urns) => kind === 'playlist' && (!urn || !urns.length || urns.includes(urn)) },
  )
}

export function useSaved(ctx: Context, kind?: SavedKind): LibraryRead<readonly LibraryEntry[]> {
  return useLibraryRead(
    ctx,
    () => readAll((cursor) => ctx.library.listSaved(kind, cursor ? { cursor } : undefined)),
    `saved:${kind ?? 'all'}`,
    { onChanged: (eventKind) => !kind || eventKind === kind },
  )
}

export function useCollections(ctx: Context): LibraryRead<readonly Collection[]> {
  return useLibraryRead(
    ctx,
    () => ctx.library.listCollections(),
    'collections',
    { onCollectionsChanged: true },
  )
}

/**
 * The local user — the creator name playlists display.
 *
 * Re-read on `library/profile-changed`, so renaming in Settings updates every
 * "creator" label without a restart.
 */
export function useLibraryProfile(ctx: Context): UserProfile | undefined {
  const [profile, setProfile] = useState<UserProfile | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const read = () => {
      // Optional call: a stub without a profile (old harnesses) degrades to
      // `undefined` instead of throwing.
      void Promise.resolve(ctx.library.getProfile?.()).then((p) => {
        if (!cancelled && p) setProfile(p)
      }).catch(() => undefined)
    }
    read()
    const off = ctx.on('library/profile-changed', () => read())
    return () => {
      cancelled = true
      off()
    }
  }, [ctx])
  return profile
}

/**
 * The one control a track row's heart runs.
 *
 * A track has two records of "the user loves this" — `track_stats.loved`,
 * which draws the heart and drives the catalogue's `onlyLoved` query
 * (docs/07 §4.7), and its `library_items` row, which is what the shelf reads.
 * The heart writes **both**, because a user pressing one heart has expressed
 * one intent and the two stores disagreeing is a bug they would see: a
 * hearted track missing from Favourites, or an unsaved one still in the
 * heart's list.
 *
 * Both reads go through `serviceOf`, so a build with no library (or a test
 * with no sources) degrades to whichever half is loaded rather than throwing.
 */
export function useToggleFavorite(ctx: Context): (urn: string, saved: boolean) => Promise<void> {
  return useCallback(
    async (urn: string, saved: boolean) => {
      // The catalogue's flag first: it is what draws the heart, and a failed
      // shelf write must not leave the heart unlit.
      await serviceOf<SourcesService>(ctx, 'sources')?.setLoved(urn, saved)
      await serviceOf<LibraryService>(ctx, 'library')?.setSaved(urn, saved)
    },
    [ctx],
  )
}

/** The header numbers a playlists screen shows without re-deriving them per row. */
export interface LibrarySummary {
  playlists: number
  smart: number
  collections: number
  saved: number
}

export function summariseLibrary(
  playlists: readonly Playlist[],
  collections: readonly Collection[],
  saved: readonly LibraryEntry[],
): LibrarySummary {
  return {
    playlists: playlists.length,
    smart: playlists.filter((playlist) => playlist.isSmart === true).length,
    collections: collections.length,
    saved: saved.length,
  }
}


/* ── one collection, as a folder ────────────────────────────────────────── */

/**
 * One member of a collection.
 *
 * A collection is a folder: its members are URNs of any kind, and what a
 * screen can draw depends on what the row's own service answers — a track has
 * a `Track`, an album a title and artists, a playlist a name. The mapping
 * happens here so both shells render the same shape.
 */
export interface CollectionMember {
  urn: string
  kind: UrnKind
  title: string
  subtitle?: string
  /** Resolved catalogue row, for a member that is a track. */
  track?: Track
}

export interface CollectionDetail {
  collection: Collection | undefined
  members: readonly CollectionMember[]
}

/**
 * A collection and its members, hydrated in the order they were added.
 *
 * A member whose service answers nothing (a removed source, a forgotten
 * playlist) still appears, titled by its URN: the row is the user's, and
 * hiding it would silently lose something they put there.
 */
export function useCollectionDetail(
  ctx: Context,
  id: string | undefined,
): LibraryRead<CollectionDetail> {
  return useLibraryRead(
    ctx,
    async () => {
      if (!id) return { collection: undefined, members: [] }
      const collections = await ctx.library.listCollections()
      const collection = collections.find((candidate) => candidate.id === id)
      const items = await readAll((cursor) =>
        ctx.library.listCollectionItems(id, cursor ? { cursor } : undefined),
      )

      const sources = serviceOf<SourcesService>(ctx, 'sources')
      const byKind = (kind: UrnKind): string[] =>
        items.filter((item) => tryParseUrn(item.urn)?.kind === kind).map((item) => item.urn)

      const trackUrns = byKind('track')
      const tracks = sources ? await sources.getTracks(trackUrns) : []
      const trackByUrn = new Map(tracks.map((track) => [track.urn, track]))

      const members: CollectionMember[] = []
      for (const item of items) {
        const parsed = tryParseUrn(item.urn)
        const kind = parsed?.kind ?? 'track'
        switch (kind) {
          case 'track': {
            const track = trackByUrn.get(item.urn)
            members.push({
              urn: item.urn,
              kind,
              title: track?.title ?? item.urn,
              ...(track ? { track } : {}),
            })
            break
          }
          case 'album': {
            const album = sources ? await sources.getAlbum(item.urn) : undefined
            members.push({
              urn: item.urn,
              kind,
              title: album?.title ?? item.urn,
              ...(album?.artists?.length
                ? { subtitle: album.artists.map((artist) => artist.name).join(', ') }
                : {}),
            })
            break
          }
          case 'playlist': {
            const playlist = await ctx.library.getPlaylist(item.urn).catch(() => undefined)
            members.push({
              urn: item.urn,
              kind,
              title: playlist?.name ?? item.urn,
              ...(playlist?.trackCount !== undefined
                ? { subtitle: `${playlist.trackCount} tracks` }
                : {}),
            })
            break
          }
          default: {
            const artist = sources ? await sources.getArtist(item.urn).catch(() => undefined) : undefined
            members.push({ urn: item.urn, kind, title: artist?.name ?? item.urn })
            break
          }
        }
      }
      return { collection, members }
    },
    `collection:${id ?? ''}`,
    { onCollectionsChanged: true },
  )
}

// Whole-catalogue and folder-tree reads, headless (no React): consumed by the
// library view packages through this public subpath, which keeps a desktop
// view from re-growing its own copy of the same traversal.
export { collectAllFolderTracks } from './folders.js'
export { fetchAllLocalAlbums, fetchAllLocalTracks } from './local-catalog.js'
