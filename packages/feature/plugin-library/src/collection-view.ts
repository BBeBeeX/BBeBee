/**
 * Headless data fetching, sorting, playback, and collection management
 * for the Collection/Folder Detail Screen.
 *
 * Shared between desktop and mobile to ensure unified curation behavior (rules/ui.md §1).
 */

import { useCallback, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { Collection, LibraryService, PlayerService, Track } from '@BBeBee/protocol'
import { serviceOf, useBatchSelection, type BatchSelectionState } from '@BBeBee/toolkit/hooks'
import { useCollectionDetail, type CollectionDetail, type CollectionMember } from './hooks.js'

export type CollectionSortKey = 'default' | 'title' | 'kind'
export type CollectionSortOrder = 'asc' | 'desc'

export interface CollectionViewState {
  readonly id: string | undefined
  readonly collection: Collection | undefined
  readonly detail: CollectionDetail | undefined
  readonly collectionName: string
  readonly members: readonly CollectionMember[]
  readonly sortedMembers: readonly CollectionMember[]
  readonly trackUrns: readonly string[]
  readonly tracks: readonly Track[]
  readonly loading: boolean
  readonly error: string | undefined
  readonly reload: () => void

  // Sorting
  readonly sortKey: CollectionSortKey
  readonly setSortKey: (key: CollectionSortKey) => void
  readonly sortOrder: CollectionSortOrder
  readonly setSortOrder: (
    order: CollectionSortOrder | ((prev: CollectionSortOrder) => CollectionSortOrder),
  ) => void
  readonly toggleSort: (key: CollectionSortKey) => void

  // Search
  readonly searchQuery: string
  readonly setSearchQuery: (query: string) => void

  // Batch
  readonly batch: BatchSelectionState
  readonly allSelected: boolean
  readonly toggleSelectAll: () => void

  // Actions
  readonly renameCollection: (name: string) => Promise<void>
  readonly deleteCollection: () => Promise<void>
  readonly playTrack: (trackUrn: string, contextUrns?: readonly string[]) => Promise<void>
  readonly playAll: (trackUrns?: readonly string[]) => Promise<void>
}

export function useCollectionView(ctx: Context, id?: string): CollectionViewState {
  const state = useCollectionDetail(ctx, id)
  const detail = state.data
  const collection = detail?.collection
  const collectionName = collection?.name ?? ''
  const members = useMemo(() => detail?.members ?? [], [detail?.members])

  const [sortKey, setSortKey] = useState<CollectionSortKey>('default')
  const [sortOrder, setSortOrder] = useState<CollectionSortOrder>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const batch = useBatchSelection()

  const toggleSort = useCallback((key: CollectionSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortOrder('asc')
      return key
    })
  }, [])

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.subtitle && m.subtitle.toLowerCase().includes(q)) ||
        m.urn.toLowerCase().includes(q),
    )
  }, [members, searchQuery])

  const sortedMembers = useMemo(() => {
    const list = [...filteredMembers]
    if (sortKey === 'default') {
      return sortOrder === 'desc' ? list.reverse() : list
    }
    return list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'kind') {
        cmp = a.kind.localeCompare(b.kind)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
  }, [filteredMembers, sortKey, sortOrder])

  const tracks = useMemo<Track[]>(() => {
    return sortedMembers
      .filter((member): member is CollectionMember & { track: Track } => member.kind === 'track' && Boolean(member.track))
      .map((member) => member.track)
  }, [sortedMembers])

  const trackUrns = useMemo(() => tracks.map((t) => t.urn), [tracks])

  const allSelected = trackUrns.length > 0 && batch.selectedUrns.size === trackUrns.length
  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      batch.clearSelection()
    } else {
      batch.selectAll(trackUrns)
    }
  }, [allSelected, batch, trackUrns])

  const renameCollection = useCallback(
    async (name: string) => {
      if (!id || !name.trim()) return
      const lib = serviceOf<LibraryService>(ctx, 'library')
      if (lib?.renameCollection) {
        await lib.renameCollection(id, name.trim())
      }
    },
    [ctx, id],
  )

  const deleteCollection = useCallback(async () => {
    if (!id) return
    const lib = serviceOf<LibraryService>(ctx, 'library')
    if (lib?.deleteCollection) {
      await lib.deleteCollection(id)
    }
  }, [ctx, id])

  const playTrack = useCallback(
    async (trackUrn: string, contextUrns?: readonly string[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const urnsList = contextUrns && contextUrns.length > 0 ? [...contextUrns] : trackUrns
      const context = { kind: 'playlist' as const, label: collectionName || 'Collection' }
      if (player.playFromContext) {
        await player.playFromContext(trackUrn, urnsList, { context })
      } else {
        await player.playNow(urnsList, { context })
      }
    },
    [ctx, collectionName, trackUrns],
  )

  const playAll = useCallback(
    async (contextUrns?: readonly string[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const list = contextUrns && contextUrns.length > 0 ? [...contextUrns] : trackUrns
      if (list.length === 0) return
      const context = { kind: 'playlist' as const, label: collectionName || 'Collection' }
      await player.playNow(list, { context })
    },
    [ctx, collectionName, trackUrns],
  )

  return {
    id,
    collection,
    detail,
    collectionName,
    members,
    sortedMembers,
    trackUrns,
    tracks,
    loading: state.status === 'loading' || !detail,
    error: state.error?.message,
    reload: state.reload,

    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    toggleSort,

    searchQuery,
    setSearchQuery,

    batch,
    allSelected,
    toggleSelectAll,

    renameCollection,
    deleteCollection,
    playTrack,
    playAll,
  }
}
