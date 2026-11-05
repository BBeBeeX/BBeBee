/**
 * Headless data orchestration, debounced event refresh, hydration,
 * multi-dimensional sorting, and search filtering for the Unified Library Screen.
 *
 * Shared between desktop and mobile to ensure identical item sorting and filtering (rules/ui.md §1).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef } from '@BBeBee/protocol'
import {
  useCollections,
  useLibraryHydration,
  useLibraryProfile,
  usePlaylists,
  useSaved,
} from './hooks.js'

export type LibraryFilterKey = 'all' | 'playlist' | 'album' | 'artist' | 'downloaded'

export type LibrarySortMode = 'creator' | 'recent-added' | 'recent-played' | 'alphabetical'

export interface LibraryItemSortable {
  readonly title: string
  readonly subtitle?: string
  readonly kind: string
  readonly pinned?: boolean
  readonly addedAt?: number
  readonly lastPlayedAt?: number
  readonly creator?: string
  readonly isDownloaded?: boolean
}

/**
 * Filter unified library items by active category filter and search query.
 */
export function filterUnifiedItems<T extends LibraryItemSortable>(
  items: readonly T[],
  filter: LibraryFilterKey,
  query?: string,
): T[] {
  let result = items as T[]

  if (filter === 'playlist') {
    result = result.filter((item) => item.kind === 'playlist' || item.kind === 'favorite')
  } else if (filter === 'album') {
    result = result.filter((item) => item.kind === 'album')
  } else if (filter === 'artist') {
    result = result.filter((item) => item.kind === 'artist')
  } else if (filter === 'downloaded') {
    result = result.filter((item) => item.kind === 'local' || Boolean(item.isDownloaded))
  }

  const q = query?.trim().toLowerCase()
  if (q) {
    result = result.filter(
      (item) => item.title.toLowerCase().includes(q) || (item.subtitle && item.subtitle.toLowerCase().includes(q)),
    )
  }

  return result
}

/**
 * Sort unified library items: pinned items always first, then by the selected mode.
 */
export function sortUnifiedItems<T extends LibraryItemSortable>(
  items: readonly T[],
  sortMode: LibrarySortMode,
): T[] {
  return [...items].sort((a, b) => {
    const aPinned = Boolean(a.pinned)
    const bPinned = Boolean(b.pinned)
    if (aPinned !== bPinned) return aPinned ? -1 : 1

    if (sortMode === 'alphabetical') {
      return a.title.localeCompare(b.title, 'zh-Hans-CN')
    }
    if (sortMode === 'recent-played') {
      return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
    }
    if (sortMode === 'creator') {
      return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
    }
    return (b.addedAt ?? 0) - (a.addedAt ?? 0)
  })
}

/**
 * Debounce generation counter for burst events like rapid scan batches.
 */
export function useLibraryDebouncedGeneration(ctx: Context, debounceMs = 750) {
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        setGeneration((n) => n + 1)
      }, debounceMs)
    }
    const offChanged = ctx.on('library/changed', () => bump())
    const offCollections = ctx.on('library/collections-changed', () => bump())
    return () => {
      if (timer) clearTimeout(timer)
      offChanged()
      offCollections()
    }
  }, [ctx, debounceMs])

  return [generation, setGeneration] as const
}

export interface LibraryViewState {
  readonly generation: number
  readonly setGeneration: (fn: (n: number) => number) => void

  // Curation reads
  readonly playlists: ReturnType<typeof usePlaylists>
  readonly collections: ReturnType<typeof useCollections>
  readonly savedAlbumEntries: ReturnType<typeof useSaved>
  readonly savedArtistEntries: ReturnType<typeof useSaved>
  readonly savedTrackEntries: ReturnType<typeof useSaved>
  readonly allSaved: ReturnType<typeof useSaved>

  // Profile & Creator
  readonly profile: ReturnType<typeof useLibraryProfile>
  readonly creatorName: string

  // Hydration maps
  readonly hydration: ReturnType<typeof useLibraryHydration>
  readonly pinnedUrns: Set<string>
  readonly isItemPinned: (item: { id?: string; urn?: string }) => boolean

  // Filter & Search & Sort
  readonly activeFilter: LibraryFilterKey
  readonly setActiveFilter: (filter: LibraryFilterKey) => void
  readonly searchQuery: string
  readonly setSearchQuery: (query: string) => void
  readonly sortMode: LibrarySortMode
  readonly setSortMode: (mode: LibrarySortMode) => void

  // Folder Expansion
  readonly expandedFolderIds: Set<string>
  readonly toggleFolderExpanded: (folderId: string) => void

  // Counts & Quick items
  readonly favoritesCount: number
  readonly localCount: number
  readonly favoriteArtwork: ArtworkRef | undefined

  // Pure filtering/sorting pipeline
  readonly filterAndSort: <T extends LibraryItemSortable>(items: readonly T[]) => T[]
}

export function useLibraryView(
  ctx: Context,
  options?: {
    defaultFilter?: LibraryFilterKey
    defaultSortMode?: LibrarySortMode
  },
): LibraryViewState {
  const [generation, setGeneration] = useLibraryDebouncedGeneration(ctx, 750)

  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const savedAlbumEntries = useSaved(ctx, 'album')
  const savedArtistEntries = useSaved(ctx, 'artist')
  const savedTrackEntries = useSaved(ctx, 'track')
  const allSaved = useSaved(ctx)

  const hydration = useLibraryHydration({
    ctx,
    generation,
    savedAlbumEntries: savedAlbumEntries.data,
    savedTrackEntries: savedTrackEntries.data,
    playlists: playlists.data,
    collections: collections.data,
  })

  const pinnedUrns = useMemo(() => {
    return new Set(allSaved.data?.filter((e) => e.pinned).map((e) => e.urn) ?? [])
  }, [allSaved.data])

  const isItemPinned = useCallback(
    (item: { id?: string; urn?: string }) => {
      if (item.urn) return pinnedUrns.has(item.urn)
      return false
    },
    [pinnedUrns],
  )

  const profile = useLibraryProfile(ctx)
  const creatorName = profile?.name ?? 'Mine'

  const [activeFilter, setActiveFilter] = useState<LibraryFilterKey>(options?.defaultFilter ?? 'all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<LibrarySortMode>(options?.defaultSortMode ?? 'creator')
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const filterAndSort = useCallback(
    <T extends LibraryItemSortable>(items: readonly T[]): T[] => {
      const filtered = filterUnifiedItems(items, activeFilter, searchQuery)
      return sortUnifiedItems(filtered, sortMode)
    },
    [activeFilter, searchQuery, sortMode],
  )

  const favoritesCount = savedTrackEntries.data?.length ?? 0
  const localCount = hydration.localTracks.length

  return {
    generation,
    setGeneration,

    playlists,
    collections,
    savedAlbumEntries,
    savedArtistEntries,
    savedTrackEntries,
    allSaved,

    profile,
    creatorName,

    hydration,
    pinnedUrns,
    isItemPinned,

    activeFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,

    expandedFolderIds,
    toggleFolderExpanded,

    favoritesCount,
    localCount,
    favoriteArtwork: hydration.favoriteArtwork,

    filterAndSort,
  }
}
