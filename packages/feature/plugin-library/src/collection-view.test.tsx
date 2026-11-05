// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Collection, CollectionItem, Paged } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { useCollectionView } from './collection-view.js'

afterEach(cleanup)

class LibraryStub extends Service {
  collection: Collection = {
    id: 'col-1',
    name: 'My Collection',
    position: '0',
    itemCount: 2,
    createdAt: 100,
  }

  items: CollectionItem[] = [
    { urn: 'bbebee:local:track:1', position: '0' },
    { urn: 'bbebee:local:playlist:1', position: '1' },
  ]

  renamedTo: string | undefined
  deleted = false

  constructor(ctx: Context) {
    super(ctx, 'library')
  }

  async listCollections(): Promise<readonly Collection[]> {
    return [this.collection]
  }

  async listCollectionItems(id: string): Promise<Paged<CollectionItem>> {
    if (id === this.collection.id) {
      return { items: this.items, total: this.items.length, hasMore: false }
    }
    return { items: [], total: 0, hasMore: false }
  }

  async renameCollection(id: string, name: string): Promise<void> {
    if (id === this.collection.id) {
      this.renamedTo = name
      this.collection = { ...this.collection, name }
    }
  }

  async deleteCollection(id: string): Promise<void> {
    if (id === this.collection.id) {
      this.deleted = true
    }
  }
}

describe('useCollectionView', () => {
  it('loads collection, sorts members, and manages actions', async () => {
    const ctx = new Context()
    await ctx.plugin(LibraryStub)
    await tick()

    const { result } = renderHook(() => useCollectionView(ctx, 'col-1'))
    await waitFor(() => {
      expect(result.current.collectionName).toBe('My Collection')
    })

    expect(result.current.members.length).toBe(2)

    // Sort toggle
    act(() => {
      result.current.toggleSort('title')
    })
    expect(result.current.sortKey).toBe('title')

    // Rename
    await act(async () => {
      await result.current.renameCollection('New Name')
    })
    expect((ctx.library as unknown as LibraryStub).renamedTo).toBe('New Name')

    // Delete
    await act(async () => {
      await result.current.deleteCollection()
    })
    expect((ctx.library as unknown as LibraryStub).deleted).toBe(true)
  })
})
