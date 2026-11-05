// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Collection, LibraryEntry, Paged, Playlist, SavedKind } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import {
  filterUnifiedItems,
  sortUnifiedItems,
  useLibraryView,
  type LibraryItemSortable,
} from './library-view.js'

afterEach(cleanup)

class LibraryStub extends Service {
  playlists: Playlist[] = [
    { urn: 'bbebee:local:playlist:1', name: 'Chill Vibes', createdAt: 100 },
    { urn: 'bbebee:local:playlist:2', name: 'Workout', createdAt: 200 },
  ]

  collections: Collection[] = [
    { id: 'col-1', name: 'Folder 1', position: '0', itemCount: 1, createdAt: 150 },
  ]

  saved: LibraryEntry[] = [
    { urn: 'bbebee:local:track:fav1', kind: 'track', sourceId: 'local', addedAt: 100 },
    { urn: 'bbebee:local:playlist:1', kind: 'playlist', sourceId: 'local', addedAt: 100, pinned: true },
  ]

  constructor(ctx: Context) {
    super(ctx, 'library')
  }

  async listPlaylists(): Promise<readonly Playlist[]> {
    return this.playlists
  }

  async listCollections(): Promise<readonly Collection[]> {
    return this.collections
  }

  async listCollectionItems(): Promise<Paged<never>> {
    return { items: [], total: 0, hasMore: false }
  }

  async listSaved(filter?: { kind?: SavedKind }): Promise<readonly LibraryEntry[]> {
    if (filter?.kind) {
      return this.saved.filter((s) => s.kind === filter.kind)
    }
    return this.saved
  }
}

describe('filterUnifiedItems', () => {
  const items: LibraryItemSortable[] = [
    { title: 'My Playlist', kind: 'playlist' },
    { title: 'My Album', kind: 'album' },
    { title: 'My Artist', kind: 'artist' },
    { title: 'Downloaded Song', kind: 'local' },
    { title: 'Offline Album', kind: 'album', isDownloaded: true },
  ]

  it('filters by category', () => {
    expect(filterUnifiedItems(items, 'playlist').map((i) => i.title)).toEqual(['My Playlist'])
    expect(filterUnifiedItems(items, 'album').map((i) => i.title)).toEqual(['My Album', 'Offline Album'])
    expect(filterUnifiedItems(items, 'artist').map((i) => i.title)).toEqual(['My Artist'])
    expect(filterUnifiedItems(items, 'downloaded').map((i) => i.title)).toEqual(['Downloaded Song', 'Offline Album'])
  })

  it('filters by search query matching title or subtitle', () => {
    const list: LibraryItemSortable[] = [
      { title: 'Bohemian Rhapsody', subtitle: 'Queen', kind: 'track' },
      { title: 'Radio Ga Ga', subtitle: 'Queen', kind: 'track' },
      { title: 'Stairway to Heaven', subtitle: 'Led Zeppelin', kind: 'track' },
    ]
    expect(filterUnifiedItems(list, 'all', 'queen').length).toBe(2)
    expect(filterUnifiedItems(list, 'all', 'heaven').length).toBe(1)
  })
})

describe('sortUnifiedItems', () => {
  it('pins prioritized items to the front regardless of sort mode', () => {
    const items: LibraryItemSortable[] = [
      { title: 'Alpha', kind: 'playlist', pinned: false, addedAt: 10 },
      { title: 'Omega', kind: 'playlist', pinned: true, addedAt: 5 },
      { title: 'Beta', kind: 'playlist', pinned: false, addedAt: 20 },
    ]
    const sorted = sortUnifiedItems(items, 'alphabetical')
    expect(sorted[0]!.title).toBe('Omega')
    expect(sorted[1]!.title).toBe('Alpha')
    expect(sorted[2]!.title).toBe('Beta')
  })

  it('sorts by addedAt descending for recent-added', () => {
    const items: LibraryItemSortable[] = [
      { title: 'Old', kind: 'playlist', addedAt: 10 },
      { title: 'Newest', kind: 'playlist', addedAt: 100 },
      { title: 'Middle', kind: 'playlist', addedAt: 50 },
    ]
    const sorted = sortUnifiedItems(items, 'recent-added')
    expect(sorted.map((i) => i.title)).toEqual(['Newest', 'Middle', 'Old'])
  })
})

describe('useLibraryView', () => {
  it('initializes state and provides folder toggle and filterAndSort', async () => {
    const ctx = new Context()
    await ctx.plugin(LibraryStub)
    await tick()

    const { result } = renderHook(() => useLibraryView(ctx))

    expect(result.current.activeFilter).toBe('all')
    expect(result.current.sortMode).toBe('creator')

    // Folder toggle
    expect(result.current.expandedFolderIds.has('col-1')).toBe(false)
    act(() => {
      result.current.toggleFolderExpanded('col-1')
    })
    expect(result.current.expandedFolderIds.has('col-1')).toBe(true)
    act(() => {
      result.current.toggleFolderExpanded('col-1')
    })
    expect(result.current.expandedFolderIds.has('col-1')).toBe(false)

    // Filter and sort integration
    const sampleItems: LibraryItemSortable[] = [
      { title: 'Track B', kind: 'playlist', addedAt: 10 },
      { title: 'Track A', kind: 'playlist', addedAt: 20 },
    ]
    act(() => {
      result.current.setSortMode('alphabetical')
    })
    const sorted = result.current.filterAndSort(sampleItems)
    expect(sorted.map((i) => i.title)).toEqual(['Track A', 'Track B'])
  })
})
