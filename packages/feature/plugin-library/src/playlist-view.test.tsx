// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { PlaylistDetail, Track } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { usePlaylistView } from './playlist-view.js'

afterEach(cleanup)

class SourcesStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getTracks(urns: string[]): Promise<Track[]> {
    return urns.map((urn, i) => ({
      urn,
      title: `Song ${urn.split(':').pop()}`,
      artists: [{ urn: `artist:${i}`, name: `Artist ${i}`, role: 'main' as const, ordinal: 0 }],
      albumTitle: `Album ${i}`,
      durationMs: (i + 1) * 1000,
    }))
  }
}

class LibraryStub extends Service {
  playlist: PlaylistDetail = {
    urn: 'bbebee:local:playlist:1',
    name: 'Test Playlist',
    trackCount: 3,
    hasMore: false,
    items: [
      { id: 'item-1', position: '0', trackUrn: 'bbebee:local:track:1', addedAt: 100 },
      { id: 'item-2', position: '1', trackUrn: 'bbebee:local:track:2', addedAt: 200 },
      { id: 'item-dup', position: '2', trackUrn: 'bbebee:local:track:1', addedAt: 300 }, // duplicate
    ],
  }
  removedItemIds: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'library')
  }

  async getPlaylist(urn: string): Promise<PlaylistDetail | undefined> {
    if (urn === this.playlist.urn) return this.playlist
    return undefined
  }

  async removeItems(urn: string, itemIds: readonly string[]): Promise<void> {
    this.removedItemIds.push(...itemIds)
    this.playlist = {
      ...this.playlist,
      items: this.playlist.items?.filter((it) => !itemIds.includes(it.id)) ?? [],
    }
  }
}

describe('usePlaylistView', () => {
  it('deduplicates duplicate tracks and supports sorting, filtering, and batch operations', async () => {
    const ctx = new Context()
    await ctx.plugin(SourcesStub)
    await ctx.plugin(LibraryStub)
    await tick()

    const { result } = renderHook(() => usePlaylistView(ctx, 'bbebee:local:playlist:1'))
    await waitFor(() => {
      expect(result.current.rawItems.length).toBe(2)
    })

    // 1. Deduplication: only 2 unique items out of 3 raw items
    expect(result.current.rows.length).toBe(2)
    expect(result.current.rows[0]!.trackUrn).toBe('bbebee:local:track:1')
    expect(result.current.rows[1]!.trackUrn).toBe('bbebee:local:track:2')

    // 2. Custom sorting desc
    act(() => {
      result.current.setSortOrder('desc')
    })
    expect(result.current.rows[0]!.trackUrn).toBe('bbebee:local:track:2')
    expect(result.current.rows[1]!.trackUrn).toBe('bbebee:local:track:1')

    // 3. Search query
    act(() => {
      result.current.setSearchQuery('Song 1')
    })
    expect(result.current.rows.length).toBe(1)
    expect(result.current.rows[0]!.trackUrn).toBe('bbebee:local:track:1')

    // Clear search
    act(() => {
      result.current.setSearchQuery('')
      result.current.setSortOrder('asc')
    })

    // 4. Batch selection
    act(() => {
      result.current.batch.setBatchMode(true)
      result.current.toggleSelectAll()
    })
    expect(result.current.allSelected).toBe(true)
    expect(result.current.batch.selectedCount).toBe(2)

    // 5. Batch remove
    await act(async () => {
      await result.current.removeSelectedItems()
    })
    expect((ctx.library as unknown as LibraryStub).removedItemIds).toEqual(['item-1', 'item-2'])
    expect(result.current.batch.selectedUrns.size).toBe(0)
  })
})
