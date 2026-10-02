// @vitest-environment jsdom
/**
 * The desktop library screens, rendered and pressed.
 *
 * What matters here is the wiring the headless service cannot pin: a create
 * field that writes the trimmed name, a delete that names the right URN, a
 * remove control that passes the **item id** (the same track twice in a
 * playlist is two rows), and a smart playlist that draws no remove control at
 * all.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Collection, Paged, Playlist, PlaylistDetail, SavedKind, Track } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { CollectionScreen, FavoritesScreen, LibraryScreen, LocalMusicScreen, PlaylistDetailScreen, collectAllFolderTracks, fetchAllLocalTracks, inject } from './index.js'

afterEach(cleanup)

const TRACK = 'BBeBee:demo:track:one'
const PLAYLIST_URN = 'BBeBee:local:playlist:one'
const ALBUM_URN = 'BBeBee:demo:album:one'
const COLLECTION_DETAIL_ID = 'col-detail'

const track: Track = {
  urn: TRACK,
  title: 'Alpha',
  artists: [{ urn: 'BBeBee:demo:artist:a', name: 'A', role: 'main', ordinal: 0 }],
}

const storedPlaylist: PlaylistDetail = {
  urn: PLAYLIST_URN,
  name: 'Road trip',
  trackCount: 1,
  items: [
    { id: 'item-1', trackUrn: TRACK, position: 'a' },
    { id: 'item-2', trackUrn: TRACK, position: 'b' },
  ],
  hasMore: false,
}

class LibraryStub extends Service {
  readonly calls: string[] = []
  playlists: Playlist[] = [storedPlaylist]
  collections: Collection[] = []
  saved: string[] = [TRACK]
  pinned: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'library')
  }

  async listPlaylists(): Promise<Paged<Playlist>> {
    return { items: this.playlists, hasMore: false }
  }
  async listCollections(): Promise<readonly Collection[]> {
    return this.collections
  }
  async createPlaylist(name: string): Promise<Playlist> {
    this.calls.push(`create:${name}`)
    return { urn: 'BBeBee:local:playlist:new', name, trackCount: 0 }
  }
  async deletePlaylist(urn: string): Promise<void> {
    this.calls.push(`delete:${urn}`)
  }
  async updatePlaylist(urn: string, patch: { name?: string; description?: string | null; artworkUrl?: string | null }): Promise<void> {
    this.calls.push(`update:${urn}:${JSON.stringify(patch)}`)
  }
  async createCollection(name: string): Promise<Collection> {
    this.calls.push(`collection:${name}`)
    return { id: 'c1', name, position: 'a', createdAt: 0 }
  }
  async deleteCollection(id: string): Promise<void> {
    this.calls.push(`collection-delete:${id}`)
  }
  async renameCollection(id: string, name: string): Promise<void> {
    this.calls.push(`rename-collection:${id}:${name}`)
  }
  async moveCollection(id: string, parentId: string | null): Promise<void> {
    this.calls.push(`move-collection:${id}:${parentId}`)
  }
  collectionItems: Record<string, { urn: string; position: string }[]> = {
    [COLLECTION_DETAIL_ID]: [
      { urn: TRACK, position: 'a' },
      { urn: ALBUM_URN, position: 'b' },
      { urn: PLAYLIST_URN, position: 'c' },
    ],
  }
  async addToCollection(id: string, urns: readonly string[]): Promise<number> {
    this.calls.push(`add-to-collection:${id}:${urns.join(',')}`)
    const existing = this.collectionItems[id] ?? []
    this.collectionItems[id] = [
      ...existing,
      ...urns.map((urn, i) => ({ urn, position: String.fromCharCode(97 + existing.length + i) })),
    ]
    this.ctx.emit('library/collections-changed')
    return urns.length
  }
  async removeFromCollection(id: string, urns: readonly string[]): Promise<void> {
    this.calls.push(`remove-from-collection:${id}:${urns.join(',')}`)
    const existing = this.collectionItems[id] ?? []
    this.collectionItems[id] = existing.filter((item) => !urns.includes(item.urn))
    this.ctx.emit('library/collections-changed')
  }
  async listCollectionItems(id: string): Promise<Paged<{ urn: string; position: string }>> {
    const items = this.collectionItems[id] ?? []
    return { items, hasMore: false }
  }
  async getPlaylist(urn: string): Promise<PlaylistDetail | undefined> {
    const found = this.playlists.find((p) => p.urn === urn) as PlaylistDetail | undefined
    return found ?? (urn === PLAYLIST_URN ? storedPlaylist : undefined)
  }
  async listSaved(kind?: SavedKind): Promise<Paged<{ urn: string; kind: 'track' | 'album'; sourceId: string; addedAt: number; pinned?: boolean }>> {
    const items = this.saved.map((urn, index) => {
      const parsed = tryParseUrn(urn)
      const k = parsed?.kind === 'album' ? ('album' as const) : ('track' as const)
      return { urn, kind: k, sourceId: 'demo', addedAt: index, pinned: this.pinned.includes(urn) }
    })
    return {
      items: kind ? items.filter((it) => it.kind === kind) : items,
      hasMore: false,
    }
  }
  async setSaved(urn: string, saved: boolean): Promise<void> {
    this.calls.push(`save:${urn}:${saved}`)
    if (saved && !this.saved.includes(urn)) this.saved.push(urn)
    if (!saved) this.saved = this.saved.filter((u) => u !== urn)
  }
  async isSaved(urn: string): Promise<boolean> {
    return this.saved.includes(urn)
  }
  async setPinned(urn: string, pinned: boolean): Promise<void> {
    this.calls.push(`pin:${urn}:${pinned}`)
    if (pinned && !this.pinned.includes(urn)) this.pinned.push(urn)
    if (!pinned) this.pinned = this.pinned.filter((u) => u !== urn)
  }
  async removeItems(urn: string, itemIds: readonly string[]): Promise<void> {
    this.calls.push(`remove:${urn}:${itemIds.join(',')}`)
  }
}

class PlayerStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  async playFromContext(urn: string, urns?: readonly string[]): Promise<void> {
    this.calls.push(`${urn} <- ${urns?.length ?? 0}`)
  }
  async playNow(urns: readonly string[]): Promise<void> {
    this.calls.push(`now:${urns.join(',')}`)
  }
  async getHistory(): Promise<any[]> {
    return []
  }
}

class SourcesStub extends Service {
  tracks: Track[] = [track]
  albums: any[] = []
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getTracks(urns: readonly string[]): Promise<Track[]> {
    return this.tracks.filter((t) => urns.includes(t.urn))
  }
  async listTracks() {
    return { items: this.tracks, hasMore: false }
  }
  async listAlbums() {
    return { items: this.albums, hasMore: false }
  }
  async getAlbum(urn: string) {
    return urn === ALBUM_URN
      ? { urn, title: 'Homogenic', artists: [{ urn: 'a', name: 'Björk', role: 'main', ordinal: 0 }] }
      : undefined
  }
  async getArtist() {
    return undefined
  }
  get(id: string) {
    if (id === 'bilibili') return { id: 'bilibili', displayName: '哔哩哔哩' }
    return undefined
  }
  async getPlaylist(urn: string, page?: { cursor?: string; limit?: number }) {
    if (urn === 'BBeBee:bilibili:playlist:bili_season_123_456') {
      const isSecondPage = page?.cursor === '2'
      return {
        urn,
        name: 'Bili Season',
        hasMore: !isSecondPage,
        cursor: isSecondPage ? undefined : '2',
        items: isSecondPage
          ? [{ id: 'item-p2', trackUrn: 'BBeBee:bilibili:track:BV2', position: 'b' }]
          : [{ id: 'item-p1', trackUrn: 'BBeBee:bilibili:track:BV1', position: 'a' }],
      }
    }
    return undefined
  }
}

class UiStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(id: string, params?: Record<string, unknown>): void {
    this.calls.push(`${id}:${JSON.stringify(params ?? {})}`)
  }
}

async function harness() {
  const root = new Context()
  await root.plugin(LibraryStub)
  await root.plugin(PlayerStub)
  await root.plugin(SourcesStub)
  await root.plugin(UiStub)
  let scoped: Context | undefined
  root.inject(inject, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('no scoped context')
  return {
    ctx: scoped,
    library: root.library as unknown as LibraryStub,
    player: root.player as unknown as PlayerStub,
    sources: root.sources as unknown as SourcesStub,
    ui: root.ui as unknown as UiStub,
  }
}

/** React tracks the last value it wrote, so a controlled field needs the native setter. */
function type(field: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('LibraryScreen', () => {
  it('renders the playlists and creates a trimmed one', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { container, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('Road trip')
      await act(async () => {
        type(getByTestId('playlists-new-name'), '  New mix  ')
        await tick()
      })
      await act(async () => {
        ;(getByTestId('playlists-create') as HTMLElement).click()
        await tick()
      })
    })

    expect(library.calls).toContain('create:New mix')
  })

  it('highlights the quick entries only from the route actually on screen', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const view = render(h(LibraryScreen, { ctx, activeViewId: 'album.view' }))
      await act(async () => {
        await tick()
      })

      // The main view is an album detail: neither quick entry may claim to be
      // current, even though the user reached it from the library.
      expect(view.container.querySelector('button[aria-current="page"]')).toBeNull()

      // Once the shell shows the favorites view, its chip lights up — and
      // only that one.
      view.rerender(h(LibraryScreen, { ctx, activeViewId: 'library.favorites' }))
      const current = view.container.querySelector('button[aria-current="page"]')
      expect(current?.textContent).toContain('喜欢')

      view.rerender(h(LibraryScreen, { ctx, activeViewId: 'library.local' }))
      const local = view.container.querySelector('button[aria-current="page"]')
      expect(local?.textContent).toContain('本地和下载')
    })
  })

  it('deletes and opens by the playlist URN', async () => {
    const { ctx, library, ui } = await harness()
    await withListLayout(async () => {
      const { getByLabelText, getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      await act(async () => {
        getByLabelText('Delete Road trip').click()
        getByText('Road trip').click()
        await tick()
      })
    })

    expect(library.calls).toContain(`delete:${PLAYLIST_URN}`)
    expect(ui.calls).toContain(`library.playlist:{"urn":"${PLAYLIST_URN}"}`)
  })

  it('renders unified list with special rows, playlists, albums, and collections', async () => {
    const { ctx, library, ui } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    library.saved = [TRACK, ALBUM_URN]
    await withListLayout(async () => {
      const { container, getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('喜欢')
      expect(container.textContent).toContain('本地和下载')
      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).toContain('Ambient mix')
      expect(container.textContent).toContain('Homogenic')

      await act(async () => {
        getByText('本地和下载').click()
        await tick()
      })
      expect(ui.calls).toContain('library.local:{}')

      await act(async () => {
        getByText('喜欢').click()
        await tick()
      })
      expect(ui.calls).toContain('library.favorites:{}')
    })
  })

  it('filters items by top toggle buttons (歌单, 专辑, 目录, 已下载)', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    library.saved = [TRACK, ALBUM_URN]
    await withListLayout(async () => {
      const { container, getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Click '歌单'
      await act(async () => {
        getByText('歌单').click()
        await tick()
      })
      expect(container.textContent).toContain('Road trip')
      // The 喜欢 / 本地和下载 quick entries live above the toolbar and are
      // independent of the active filter.
      expect(container.textContent).toContain('本地和下载')
      expect(container.textContent).not.toContain('Homogenic')
      expect(container.textContent).not.toContain('Ambient mix')

      // Click '专辑'
      await act(async () => {
        getByText('专辑').click()
        await tick()
      })
      expect(container.textContent).toContain('Homogenic')
      expect(container.textContent).not.toContain('Road trip')
      expect(container.textContent).not.toContain('Ambient mix')

      // Toggle off by clicking '专辑' again
      await act(async () => {
        getByText('专辑').click()
        await tick()
      })
      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).toContain('Homogenic')
    })
  })

  it('searches items via search input', async () => {
    const { ctx, library } = await harness()
    library.saved = [TRACK, ALBUM_URN]
    await withListLayout(async () => {
      const { container, getByLabelText, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Open search input
      await act(async () => {
        getByLabelText('搜索').click()
        await tick()
      })

      // Type query
      await act(async () => {
        type(getByTestId('library-search-input'), 'Road')
        await tick()
      })

      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).not.toContain('Homogenic')
    })
  })

  it('plays playlist content when clicking the cover play overlay', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByText, getByTitle } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const row = getByText('Road trip').closest('[style*="cursor: pointer"]') as HTMLElement
      expect(row).toBeTruthy()

      // Hover row to reveal cover play button
      await act(async () => {
        fireEvent.mouseEnter(row)
        await tick()
      })

      const playOverlay = getByTitle('播放 Road trip')
      expect(playOverlay).toBeTruthy()

      await act(async () => {
        playOverlay.click()
        await tick()
      })
    })

    expect(player.calls).toContain(`${TRACK} <- 2`)
  })

  it('pins a playlist via context menu', async () => {
    const { ctx, library } = await harness()
    library.playlists = [
      storedPlaylist,
      { urn: 'BBeBee:local:playlist:two', name: 'Zebra playlist', trackCount: 0 },
    ]
    library.saved = [TRACK]
    await withListLayout(async () => {
      const { getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const zebraRow = getByText('Zebra playlist').closest('[style*="cursor: pointer"]') as HTMLElement
      expect(zebraRow).toBeTruthy()

      await act(async () => {
        fireEvent.contextMenu(zebraRow)
        await tick()
      })

      const pinItem = getByText('置顶歌单')
      expect(pinItem).toBeTruthy()

      await act(async () => {
        pinItem.click()
        await tick()
      })

      expect(library.calls).toContain('pin:BBeBee:local:playlist:two:true')
    })
  })

  it('toggles folder inline expansion with downward/upward triangle arrow in standard mode', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByLabelText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const expandBtn = getByLabelText('展开文件夹')
      expect(expandBtn).toBeTruthy()

      // Click to expand inline
      await act(async () => {
        expandBtn.click()
        await tick()
      })

      const foldBtn = getByLabelText('折叠文件夹')
      expect(foldBtn).toBeTruthy()

      // Click to fold inline
      await act(async () => {
        foldBtn.click()
        await tick()
      })

      expect(getByLabelText('展开文件夹')).toBeTruthy()
    })
  })

  it('navigates into folder view in sidebar mode and returns with back button', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText, getByTitle, queryByTitle } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Click folder item to open folder view
      await act(async () => {
        getByText('Ambient mix').click()
        await tick()
      })

      // In folder view: back button is rendered
      const backBtn = getByTitle('返回音乐库')
      expect(backBtn).toBeTruthy()

      // Click back button to return to root library
      await act(async () => {
        backBtn.click()
        await tick()
      })

      expect(queryByTitle('返回音乐库')).toBeNull()
      expect(getByText('音乐库')).toBeTruthy()
    })
  })

  it('renders return button in collapsed mode when inside a folder and returns to root collapsed library', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByLabelText, queryByLabelText } = render(
        h(LibraryScreen, { ctx, mode: 'collapsed', folderId: 'col-1' }),
      )
      await act(async () => {
        await tick()
      })

      const backBtn = getByLabelText('返回音乐库')
      expect(backBtn).toBeTruthy()

      await act(async () => {
        backBtn.click()
        await tick()
      })

      expect(queryByLabelText('返回音乐库')).toBeNull()
    })
  })

  it('renders breadcrumb in expanded mode when inside a folder and returns to root expanded library', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText, getByTitle, queryByTitle } = render(
        h(LibraryScreen, { ctx, mode: 'expanded', folderId: 'col-1' }),
      )
      await act(async () => {
        await tick()
      })

      expect(getByText('Ambient mix')).toBeTruthy()
      const backNav = getByTitle('返回音乐库')
      expect(backNav).toBeTruthy()

      await act(async () => {
        backNav.click()
        await tick()
      })

      expect(queryByTitle('返回音乐库')).toBeNull()
      expect(getByText('音乐库')).toBeTruthy()
    })
  })

  it('opens edit details modal and updates playlist', async () => {
    const { ctx, library } = await harness()
    library.playlists = [storedPlaylist]
    await withListLayout(async () => {
      const { getByText, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const row = getByText('Road trip').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(row)
        await tick()
      })

      const editItem = getByText('编辑详情')
      expect(editItem).toBeTruthy()

      await act(async () => {
        editItem.click()
        await tick()
      })

      const nameInput = getByTestId('edit-playlist-name') as HTMLInputElement
      expect(nameInput.value).toBe('Road trip')

      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Road trip 2026' } })
        fireEvent.change(getByTestId('edit-playlist-description'), { target: { value: 'Best songs' } })
        fireEvent.change(getByTestId('edit-playlist-artwork'), { target: { value: 'https://example.com/art.jpg' } })
      })

      await act(async () => {
        ;(getByTestId('edit-playlist-save') as HTMLElement).click()
        await tick()
      })

      expect(library.calls).toContain(
        `update:${PLAYLIST_URN}:${JSON.stringify({
          name: 'Road trip 2026',
          description: 'Best songs',
          artworkUrl: 'https://example.com/art.jpg',
        })}`,
      )
    })
  })

  it('opens rename collection modal and renames collection', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'My Folder', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const row = getByText('My Folder').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(row)
        await tick()
      })

      const renameItem = getByText('重命名')
      expect(renameItem).toBeTruthy()

      await act(async () => {
        renameItem.click()
        await tick()
      })

      const input = getByTestId('rename-collection-name') as HTMLInputElement
      expect(input.value).toBe('My Folder')

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Renamed Folder' } })
        ;(getByTestId('rename-collection-save') as HTMLElement).click()
        await tick()
      })

      expect(library.calls).toContain('rename-collection:col-1:Renamed Folder')
    })
  })

  it('deletes playlist, album, and collection via context menu with confirmation', async () => {
    const { ctx, library } = await harness()
    library.playlists = [storedPlaylist]
    library.collections = [{ id: 'col-1', name: 'My Folder', position: 'a', createdAt: 0 }]
    library.saved = [ALBUM_URN]
    await withListLayout(async () => {
      const { getByText, getByTestId, queryByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Delete playlist: cancel first
      const playlistRow = getByText('Road trip').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(playlistRow)
        await tick()
      })
      const deletePlaylistItem = getByText('删除')
      expect(deletePlaylistItem).toBeTruthy()
      await act(async () => {
        deletePlaylistItem.click()
        await tick()
      })
      // Modal should be shown, not deleted yet
      expect(library.calls).not.toContain(`delete:${PLAYLIST_URN}`)
      expect(getByText('确定要删除歌单“Road trip”吗？此操作无法撤销。')).toBeTruthy()

      // Cancel deletion
      await act(async () => {
        getByTestId('confirm-delete-cancel').click()
        await tick()
      })
      expect(queryByTestId('confirm-delete-button')).toBeNull()
      expect(library.calls).not.toContain(`delete:${PLAYLIST_URN}`)

      // Re-open context menu and confirm delete
      await act(async () => {
        fireEvent.contextMenu(playlistRow)
        await tick()
      })
      await act(async () => {
        getByText('删除').click()
        await tick()
      })
      await act(async () => {
        getByTestId('confirm-delete-button').click()
        await tick()
      })
      expect(library.calls).toContain(`delete:${PLAYLIST_URN}`)

      // Delete album: cancel first then confirm
      const albumRow = getByText('Homogenic').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(albumRow)
        await tick()
      })
      const deleteAlbumItem = getByText('删除')
      expect(deleteAlbumItem).toBeTruthy()
      await act(async () => {
        deleteAlbumItem.click()
        await tick()
      })
      expect(library.calls).not.toContain(`save:${ALBUM_URN}:false`)
      expect(getByText('确定要从音乐库中删除专辑“Homogenic”吗？')).toBeTruthy()

      // Cancel deletion
      await act(async () => {
        getByTestId('confirm-delete-cancel').click()
        await tick()
      })
      expect(queryByTestId('confirm-delete-button')).toBeNull()
      expect(library.calls).not.toContain(`save:${ALBUM_URN}:false`)

      // Re-open context menu and confirm delete
      await act(async () => {
        fireEvent.contextMenu(albumRow)
        await tick()
      })
      await act(async () => {
        getByText('删除').click()
        await tick()
      })
      await act(async () => {
        getByTestId('confirm-delete-button').click()
        await tick()
      })
      expect(library.calls).toContain(`save:${ALBUM_URN}:false`)

      // Delete collection
      const folderRow = getByText('My Folder').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(folderRow)
        await tick()
      })
      const deleteFolderItem = getByText('删除')
      expect(deleteFolderItem).toBeTruthy()
      await act(async () => {
        deleteFolderItem.click()
        await tick()
      })
      expect(library.calls).toContain('collection-delete:col-1')
    })
  })

  it('deletes an album inside a folder via context menu removing it from folder and library', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'My Folder', position: 'a', createdAt: 0 }]
    library.collectionItems = {
      'col-1': [{ urn: ALBUM_URN, position: 'a' }],
    }
    library.saved = [ALBUM_URN]
    await withListLayout(async () => {
      const { getByText, getByTestId } = render(h(LibraryScreen, { ctx, folderId: 'col-1' }))
      await act(async () => {
        await tick()
      })

      const albumRow = getByText('Homogenic').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(albumRow)
        await tick()
      })
      await act(async () => {
        getByText('删除').click()
        await tick()
      })
      await act(async () => {
        getByTestId('confirm-delete-button').click()
        await tick()
      })
      expect(library.calls).toContain(`save:${ALBUM_URN}:false`)
      expect(library.calls).toContain(`remove-from-collection:col-1:${ALBUM_URN}`)
    })
  })

  it('hides playlists from root list when they are inside a folder and restores them when moved to root', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { container } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      // Initially, Road trip is at root
      expect(container.textContent).toContain('Road trip')

      // Move Road trip into folder col-1
      await act(async () => {
        await library.addToCollection('col-1', [PLAYLIST_URN])
        await tick()
      })

      // Playlist must disappear from root!
      expect(container.textContent).not.toContain('Road trip')

      // Move Road trip back to root (remove from folder)
      await act(async () => {
        await library.removeFromCollection('col-1', [PLAYLIST_URN])
        await tick()
      })

      // Playlist must reappear in root!
      expect(container.textContent).toContain('Road trip')
    })
  })
})

describe('collectAllFolderTracks', () => {
  it('recursively gathers tracks from nested folders, playlists, and albums', async () => {
    const { ctx, library } = await harness()
    const colRoot: Collection = { id: 'root', name: 'Root Folder', position: 'a', createdAt: 0 }
    const colChild: Collection = { id: 'child', parentId: 'root', name: 'Child Folder', position: 'b', createdAt: 0 }
    library.collections = [colRoot, colChild]
    library.listCollectionItems = async (id: string) => {
      if (id === 'root') {
        return {
          items: [
            { urn: 'BBeBee:demo:track:root-1', position: 'a' },
            { urn: PLAYLIST_URN, position: 'b' },
          ],
          hasMore: false,
        }
      }
      if (id === 'child') {
        return {
          items: [
            { urn: 'BBeBee:demo:track:child-1', position: 'a' },
            { urn: ALBUM_URN, position: 'b' },
          ],
          hasMore: false,
        }
      }
      return { items: [], hasMore: false }
    }

    const albumsMap = new Map([
      [ALBUM_URN, { urn: ALBUM_URN, title: 'Album', tracks: [{ urn: 'BBeBee:demo:track:album-1', title: 'T' }] } as any],
    ])

    const tracks = await collectAllFolderTracks(ctx, 'root', library.collections, albumsMap)
    expect(tracks).toContain('BBeBee:demo:track:root-1')
    expect(tracks).toContain(TRACK)
    expect(tracks).toContain('BBeBee:demo:track:child-1')
    expect(tracks).toContain('BBeBee:demo:track:album-1')
  })
})

describe('PlaylistDetailScreen', () => {
  it('plays a tapped track with the whole playlist as its context', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })
      const row = container.querySelector('[role="row"]') as HTMLElement | null
      expect(row, 'the track is on screen').toBeTruthy()
      row!.click()
      await tick()
    })

    expect(player.calls[0]).toBe(`${TRACK} <- 1`)
  })

  it('removes the item, not every row that shares its track', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { getAllByLabelText } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })

      // Two rows share one track; the first remove names the first item.
      await act(async () => {
        getAllByLabelText('Remove Alpha from Road trip')[0]!.click()
        await tick()
      })
    })

    expect(library.calls).toEqual([`remove:${PLAYLIST_URN}:item-1`])
  })

  it('supports sorting tracks by clicking headers and via sort menu', async () => {
    const { ctx, player, library, sources } = await harness()
    const TRACK_B = 'BBeBee:demo:track:two'
    const trackB: Track = {
      urn: TRACK_B,
      title: 'Beta',
      artists: [{ urn: 'BBeBee:demo:artist:b', name: 'B', role: 'main', ordinal: 0 }],
      durationMs: 300000,
    }
    sources.tracks = [track, trackB]
    const multiPlaylist: PlaylistDetail = {
      urn: PLAYLIST_URN,
      name: 'Road trip',
      trackCount: 2,
      items: [
        { id: 'item-1', trackUrn: TRACK, position: 'a' },
        { id: 'item-2', trackUrn: TRACK_B, position: 'b' },
      ],
      hasMore: false,
    }
    library.playlists = [multiPlaylist]

    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })

      // Clicking '#' toggles custom sort to desc
      await act(async () => {
        getByTestId('playlist-sort-custom').click()
        await tick()
      })

      // Click play button to play from sortedUrns
      await act(async () => {
        getByTestId('playlist-play').click()
        await tick()
      })

      // Open sort menu
      await act(async () => {
        getByTestId('playlist-sort-trigger').click()
        await tick()
      })

      // Click "升序" in menu
      await act(async () => {
        getByText('升序').click()
        await tick()
      })
    })

    expect(player.calls).toContain(`${TRACK_B} <- 2`)
  })

  it('renders source badge on playlist screen for third-party playlist', async () => {
    const { ctx } = await harness()
    const BILI_PLAYLIST_URN = 'BBeBee:bilibili:playlist:bili_season_123_456'
    await withListLayout(async () => {
      const { getByTestId } = render(h(PlaylistDetailScreen, { ctx, urn: BILI_PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })
      const badge = getByTestId('playlist-source-badge')
      expect(badge).toBeTruthy()
      expect(badge.textContent).toBe('哔哩哔哩')
    })
  })

  it('does not render source badge for local playlist', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const { queryByTestId } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })
      expect(queryByTestId('playlist-source-badge')).toBeNull()
    })
  })

  it('fetches third-party playlist and opens context menu with original resource option', async () => {
    const { ctx } = await harness()
    const BILI_PLAYLIST_URN = 'BBeBee:bilibili:playlist:bili_season_123_456'
    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(PlaylistDetailScreen, { ctx, urn: BILI_PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })

      // Click more options button
      await act(async () => {
        getByTestId('playlist-more-trigger').click()
        await tick()
      })

      expect(getByText('跳转原始资源')).toBeTruthy()
    })
  })

  it('deduplicates tracks, renders source column and supports batch mode', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const { container, getByTestId, queryByTestId, getByText } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })

      // 1. Deduplication: storedPlaylist had item-1 and item-2 with the same TRACK URN, only 1 unique row is rendered
      const rows = container.querySelectorAll('[role="row"]')
      expect(rows.length).toBe(1)

      // 2. Source column is rendered in header
      const header = getByTestId('playlist-table-header')
      expect(header.textContent).toContain('来源')

      // 3. Batch mode initially off
      expect(queryByTestId('batch-action-bar')).toBeNull()

      // Open 3-dots more menu
      const moreBtn = getByTestId('playlist-more-trigger')
      await act(async () => {
        moreBtn.click()
        await tick()
      })

      // Click 批量操作 to open submenu
      const batchOpItem = getByText('批量操作')
      expect(batchOpItem).toBeTruthy()
      await act(async () => {
        batchOpItem.click()
        await tick()
      })

      // Click 开启批量操作
      const enterBatchItem = getByText('开启批量操作')
      expect(enterBatchItem).toBeTruthy()
      await act(async () => {
        enterBatchItem.click()
        await tick()
      })

      // Batch action bar is now visible
      expect(getByTestId('batch-action-bar')).toBeTruthy()
      expect(getByTestId('batch-select-all')).toBeTruthy()

      // Select all
      await act(async () => {
        getByTestId('batch-select-all').click()
        await tick()
      })
      expect(getByTestId('batch-selected-count').textContent).toContain('1 / 1')

      // Exit batch
      await act(async () => {
        getByTestId('batch-exit-btn').click()
        await tick()
      })
      expect(queryByTestId('batch-action-bar')).toBeNull()
    })
  })
})

describe('FavoritesScreen', () => {
  it('opens add to playlist menu from favorite track row', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const { getByLabelText, getByText } = render(h(FavoritesScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const btn = getByLabelText('Add Alpha to playlist')
      expect(btn).toBeTruthy()
      expect(btn.querySelector('[data-icon="heart-filled"]')).toBeTruthy()

      await act(async () => {
        btn.click()
        await tick()
      })

      expect(getByText('添加到歌单')).toBeTruthy()
      expect(getByText('新建歌单')).toBeTruthy()
    })
  })

  it('renders hero header, action bar and table header in LocalMusic consistent style', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { container, getByTestId, getByPlaceholderText } = render(h(FavoritesScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('已点赞的歌曲')
      expect(container.textContent).toContain('已收藏的音乐 • 1 首歌曲')
      expect(container.textContent).toContain('歌单')

      // 滚动折叠后的吸顶栏：吸附在滚动容器顶部，随滚动淡入。
      const sticky = getByTestId('sticky-detail-bar')
      expect(sticky.style.position).toBe('sticky')
      expect(getByTestId('favorites-play-sticky')).toBeTruthy()

      expect(getByTestId('favorites-play')).toBeTruthy()
      expect(getByPlaceholderText('在已点赞歌曲中搜索')).toBeTruthy()
      expect(getByTestId('favorites-sort-default')).toBeTruthy()
      expect(getByTestId('favorites-sort-title')).toBeTruthy()
      expect(getByTestId('favorites-sort-album')).toBeTruthy()
      expect(getByTestId('favorites-sort-duration')).toBeTruthy()

      // Click play all
      await act(async () => {
        getByTestId('favorites-play').click()
        await tick()
      })
      expect(player.calls).toContain(`${TRACK} <- 1`)
    })
  })

  it('supports sorting favorite tracks by clicking headers and via sort menu', async () => {
    const { ctx, library, sources, player } = await harness()
    const TRACK_B = 'BBeBee:demo:track:two'
    const trackB: Track = {
      urn: TRACK_B,
      title: 'Beta Track',
      artists: [{ urn: 'b', name: 'Zeta Artist', role: 'main', ordinal: 0 }],
      durationMs: 300000,
      albumTitle: 'A-Album',
    }
    sources.tracks.push(trackB)
    library.saved.push(TRACK_B)

    await withListLayout(async () => {
      const { getByTestId, container } = render(h(FavoritesScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Default order: Alpha then Beta
      const defaultRows = container.querySelectorAll('[role="row"]')
      expect(defaultRows.length).toBe(2)
      expect(defaultRows[0]?.textContent).toContain('Alpha')
      expect(defaultRows[1]?.textContent).toContain('Beta Track')

      // Click Title header to sort ascending
      await act(async () => {
        getByTestId('favorites-sort-title').click()
        await tick()
      })
      // 'Alpha' < 'Beta Track'
      const ascRows = container.querySelectorAll('[role="row"]')
      expect(ascRows[0]?.textContent).toContain('Alpha')
      expect(ascRows[1]?.textContent).toContain('Beta Track')

      // Click Title header again for descending
      await act(async () => {
        getByTestId('favorites-sort-title').click()
        await tick()
      })
      const descRows = container.querySelectorAll('[role="row"]')
      expect(descRows[0]?.textContent).toContain('Beta Track')
      expect(descRows[1]?.textContent).toContain('Alpha')

      // Click play button to verify sorted context
      await act(async () => {
        getByTestId('favorites-play').click()
        await tick()
      })
      expect(player.calls).toContain(`${TRACK_B} <- 2`)
    })
  })

  it('deduplicates tracks, renders source column and supports batch mode in FavoritesScreen', async () => {
    const { ctx, library } = await harness()
    library.saved = [TRACK, TRACK] // duplicate entry

    await withListLayout(async () => {
      const { container, getByTestId, queryByTestId, getByText } = render(h(FavoritesScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // 1. Deduplication: only 1 unique row rendered despite duplicate in saved
      const rows = container.querySelectorAll('[role="row"]')
      expect(rows.length).toBe(1)

      // 2. Source column is rendered in header
      const header = getByTestId('favorites-table-header')
      expect(header.textContent).toContain('来源')

      // 3. Batch mode
      expect(queryByTestId('batch-action-bar')).toBeNull()

      const moreBtn = getByTestId('favorites-more-trigger')
      await act(async () => {
        moreBtn.click()
        await tick()
      })

      const batchOpItem = getByText('批量操作')
      expect(batchOpItem).toBeTruthy()
      await act(async () => {
        batchOpItem.click()
        await tick()
      })

      const enterBatchItem = getByText('开启批量操作')
      expect(enterBatchItem).toBeTruthy()
      await act(async () => {
        enterBatchItem.click()
        await tick()
      })

      expect(getByTestId('batch-action-bar')).toBeTruthy()
      expect(getByTestId('batch-select-all')).toBeTruthy()

      // Select all
      await act(async () => {
        getByTestId('batch-select-all').click()
        await tick()
      })
      expect(getByTestId('batch-selected-count').textContent).toContain('1 / 1')

      // Exit batch
      await act(async () => {
        getByTestId('batch-exit-btn').click()
        await tick()
      })
      expect(queryByTestId('batch-action-bar')).toBeNull()
    })
  })
})


describe('CollectionScreen', () => {
  it('renders tracks, albums and playlists as folder members', async () => {
    const { ctx, ui } = await harness()
    await withListLayout(async () => {
      const { container, getByText } = render(h(CollectionScreen, { ctx, id: COLLECTION_DETAIL_ID }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('Alpha')
      expect(container.textContent).toContain('Homogenic')
      expect(container.textContent).toContain('Road trip')

      await act(async () => {
        getByText('Homogenic').click()
        await tick()
      })
      expect(ui.calls).toContain(`album.view:{"urn":"${ALBUM_URN}"}`)
    })
  })
})

describe('LocalMusicScreen', () => {
  it('renders local tracks and plays all on button press', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { container, getByTestId } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('本地音乐')
      expect(container.textContent).toContain('Alpha')

      await act(async () => {
        ;(getByTestId('local-music-play') as HTMLElement).click()
        await tick()
      })
    })

    expect(player.calls).toContain(`now:${TRACK}`)
  })

  it('switches between tracks and albums view back and forth', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const { getByTestId, container } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Initially on tracks view
      expect(getByTestId('local-tab-tracks')).toBeTruthy()
      expect(getByTestId('local-tab-albums')).toBeTruthy()
      expect(container.textContent).toContain('本地文件')
      expect(container.textContent).toContain('Alpha')

      // Switch to albums view
      await act(async () => {
        getByTestId('local-tab-albums').click()
        await tick()
      })

      // When in albums view
      expect(container.textContent).toContain('本地专辑')
      expect(getByTestId('local-albums-grid')).toBeTruthy()

      // Switch back to tracks view
      await act(async () => {
        getByTestId('local-tab-tracks').click()
        await tick()
      })

      // Back on tracks view
      expect(container.textContent).toContain('本地文件')
      expect(container.textContent).toContain('Alpha')
    })
  })

  it('supports sorting local tracks by headers and sort menu', async () => {
    const { ctx, player, sources } = await harness()
    const TRACK_B = 'BBeBee:demo:track:two'
    const trackB: Track = {
      urn: TRACK_B,
      title: 'Zeta',
      artists: [{ urn: 'BBeBee:demo:artist:z', name: 'Z', role: 'main', ordinal: 0 }],
      durationMs: 300000,
    }
    sources.tracks = [track, trackB]

    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Click sort menu trigger
      await act(async () => {
        getByTestId('local-music-sort-trigger').click()
        await tick()
      })

      // Choose "降序"
      await act(async () => {
        getByText('降序').click()
        await tick()
      })

      // Click play all
      await act(async () => {
        ;(getByTestId('local-music-play') as HTMLElement).click()
        await tick()
      })
    })

    expect(player.calls).toContain(`now:${TRACK_B},${TRACK}`)
  })

  it('supports sorting local albums via sort menu', async () => {
    const { ctx, sources } = await harness()
    sources.albums = [
      { urn: 'BBeBee:local:album:a', title: 'AAA', trackCount: 2, year: 2020 },
      { urn: 'BBeBee:local:album:z', title: 'ZZZ', trackCount: 1, year: 2024 },
    ]

    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Switch to albums view
      await act(async () => {
        getByTestId('local-tab-albums').click()
        await tick()
      })

      // Click sort menu trigger
      await act(async () => {
        getByTestId('local-music-sort-trigger').click()
        await tick()
      })

      // Select "专辑名称"
      await act(async () => {
        getByText('专辑名称').click()
        await tick()
      })

      expect(getByTestId('local-albums-grid')).toBeTruthy()
    })
  })

  it('renders album table header and row with front play button in list and compact modes', async () => {
    const { ctx, sources, player } = await harness()
    sources.albums = [
      { urn: 'BBeBee:local:album:a', title: 'AAA', trackCount: 2, year: 2020 },
    ]
    sources.tracks = [
      { urn: 'BBeBee:local:track:1', title: 'T1', artists: [], albumUrn: 'BBeBee:local:album:a', albumTitle: 'AAA' },
      { urn: 'BBeBee:local:track:2', title: 'T2', artists: [], albumUrn: 'BBeBee:local:album:a', albumTitle: 'AAA' },
    ]

    await withListLayout(async () => {
      const { getByTestId, getByText, queryByTestId, getByRole } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Switch to albums view
      await act(async () => {
        getByTestId('local-tab-albums').click()
        await tick()
      })

      // In tiled mode, table header should NOT be present
      expect(queryByTestId('local-albums-table-header')).toBeNull()

      // Switch view mode to "列表"
      await act(async () => {
        getByTestId('local-music-sort-trigger').click()
        await tick()
      })
      await act(async () => {
        getByText('列表').click()
        await tick()
      })

      // Now table header should be present
      const header = getByTestId('local-albums-table-header')
      expect(header).toBeTruthy()
      expect(getByTestId('local-album-sort-default')).toBeTruthy()
      expect(getByTestId('local-album-sort-title')).toBeTruthy()
      expect(getByTestId('local-album-sort-year')).toBeTruthy()
      expect(getByTestId('local-album-sort-count')).toBeTruthy()

      // Row exists and Col 1 shows # (1)
      const row = getByRole('row', { name: 'AAA' })
      expect(row).toBeTruthy()
      expect(row.textContent).toContain('1')

      // Hover row to reveal Col 1 play button
      await act(async () => {
        fireEvent.mouseEnter(row)
        await tick()
      })

      const playBtn = getByTestId('local-album-play-BBeBee:local:album:a')
      expect(playBtn).toBeTruthy()
      await act(async () => {
        playBtn.click()
        await tick()
      })
      // PlayerStub.playNow records `now:<urns>` — assert against that contract,
      // the bare URN never appears at the head of a call string.
      expect(player.calls.some((c) => c.startsWith('now:BBeBee:local:track:1'))).toBe(true)

      // Switch to "紧凑" mode
      await act(async () => {
        getByTestId('local-music-sort-trigger').click()
        await tick()
      })
      await act(async () => {
        getByText('紧凑').click()
        await tick()
      })

      // In compact mode, table header should also be present and include artist column
      expect(getByTestId('local-albums-table-header')).toBeTruthy()
      expect(getByTestId('local-album-sort-artist')).toBeTruthy()
    })
  })

  it('shows ＋ button when track is not in library and adds to favorites on click', async () => {
    const { ctx, library } = await harness()
    library.saved = [] // not saved
    await withListLayout(async () => {
      const { getByLabelText } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const addBtn = getByLabelText('Add Alpha to favourites')
      expect(addBtn).toBeTruthy()
      expect(addBtn.querySelector('[data-icon="plus"]')).toBeTruthy()

      await act(async () => {
        addBtn.click()
        await tick()
      })

      expect(library.calls).toContain(`save:${TRACK}:true`)
    })
  })

  it('fetchAllLocalTracks paginates across multiple pages to fetch all tracks', async () => {
    let callCount = 0
    const mockSources = {
      async listTracks(opts: any) {
        callCount++
        if (!opts?.page?.cursor) {
          return {
            items: [{ urn: 'track-1', title: 'Track 1' } as Track],
            cursor: 'c-2',
            hasMore: true,
          }
        }
        return {
          items: [{ urn: 'track-2', title: 'Track 2' } as Track],
          cursor: undefined,
          hasMore: false,
        }
      },
    } as any

    const result = await fetchAllLocalTracks(mockSources)
    expect(callCount).toBe(2)
    expect(result).toHaveLength(2)
    expect(result[0]?.urn).toBe('track-1')
    expect(result[1]?.urn).toBe('track-2')
  })

  it('navigates to album page when clicking album in local track row', async () => {
    const { ctx, ui, sources, player } = await harness()
    const ALBUM_TARGET = 'BBeBee:demo:album:homogenic'
    sources.tracks = [
      {
        urn: TRACK,
        title: 'Alpha',
        artists: [{ urn: 'BBeBee:demo:artist:a', name: 'A', role: 'main', ordinal: 0 }],
        albumTitle: 'Homogenic',
        albumUrn: ALBUM_TARGET,
      },
    ]

    await withListLayout(async () => {
      const { getByTestId } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const albumLink = getByTestId(`track-album-link-${TRACK}`)
      expect(albumLink).toBeTruthy()
      expect(albumLink.textContent).toBe('Homogenic')

      await act(async () => {
        albumLink.click()
        await tick()
      })

      expect(ui.calls).toContain(`album.view:{"urn":"${ALBUM_TARGET}"}`)
      // Clicking album must not play the track (e.stopPropagation was called)
      expect(player.calls.some((c) => c.startsWith(TRACK))).toBe(false)
    })
  })

  it('highlights and prioritizes imported tracks when highlightUrns is provided', async () => {
    const { ctx, sources } = await harness()
    sources.tracks = [
      { urn: 'BBeBee:demo:track:1', title: 'Song 1', artists: [{ urn: 'a', name: 'A', role: 'main', ordinal: 0 }] },
      { urn: 'BBeBee:demo:track:2', title: 'Song 2', artists: [{ urn: 'b', name: 'B', role: 'main', ordinal: 0 }] },
      { urn: 'BBeBee:demo:track:3', title: 'Song 3', artists: [{ urn: 'c', name: 'C', role: 'main', ordinal: 0 }] },
    ]

    await withListLayout(async () => {
      const { container } = render(
        h(LocalMusicScreen, { ctx, highlightUrns: ['BBeBee:demo:track:2'] }),
      )
      await act(async () => {
        await tick()
      })

      const rows = container.querySelectorAll('[role="row"]')
      expect(rows.length).toBeGreaterThanOrEqual(3)
      // The first track row should be Song 2 (the highlighted track)
      expect(rows[0]?.textContent).toContain('Song 2')
      expect(rows[0]?.getAttribute('data-highlighted')).toBe('true')
      // Non-highlighted tracks should not have data-highlighted
      expect(rows[1]?.getAttribute('data-highlighted')).toBeNull()
    })
  })

  it('refreshes track list when library/changed or scan/finished is emitted', async () => {
    const { ctx, sources } = await harness()
    sources.tracks = [
      { urn: 'BBeBee:demo:track:1', title: 'Song 1', artists: [{ urn: 'a', name: 'A', role: 'main', ordinal: 0 }] },
    ]

    await withListLayout(async () => {
      const { container } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('Song 1')
      expect(container.textContent).not.toContain('Song Newly Imported')

      // Add a newly imported track and emit library/changed
      sources.tracks = [
        ...sources.tracks,
        { urn: 'BBeBee:demo:track:new', title: 'Song Newly Imported', artists: [{ urn: 'x', name: 'X', role: 'main', ordinal: 0 }] },
      ]

      await act(async () => {
        ctx.emit('library/changed', 'track', ['BBeBee:demo:track:new'])
        await tick()
      })

      expect(container.textContent).toContain('Song Newly Imported')

      // Now emit scan/finished with another track
      sources.tracks = [
        ...sources.tracks,
        { urn: 'BBeBee:demo:track:scan', title: 'Song From Scan', artists: [{ urn: 'y', name: 'Y', role: 'main', ordinal: 0 }] },
      ]

      await act(async () => {
        ctx.emit('scan/finished', 'dir-1', { added: 1, updated: 0, removed: 0, errors: 0 })
        await tick()
      })

      expect(container.textContent).toContain('Song From Scan')
    })
  })

  it('supports batch mode in LocalMusicScreen, deduplicates tracks and does not show source column', async () => {
    const { ctx, sources } = await harness()
    sources.tracks = [
      { urn: 'BBeBee:demo:track:1', title: 'Song 1', artists: [{ urn: 'a', name: 'A', role: 'main', ordinal: 0 }] },
      { urn: 'BBeBee:demo:track:1', title: 'Song 1 Duplicate', artists: [{ urn: 'a', name: 'A', role: 'main', ordinal: 0 }] },
      { urn: 'BBeBee:demo:track:2', title: 'Song 2', artists: [{ urn: 'b', name: 'B', role: 'main', ordinal: 0 }] },
    ]

    await withListLayout(async () => {
      const { container, getByTestId, queryByTestId, getByText } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // 1. Deduplication: only 2 unique rows rendered
      const rows = container.querySelectorAll('[role="row"]')
      expect(rows.length).toBe(2)

      // 2. LocalMusicScreen does NOT have source column
      const header = getByTestId('local-table-header')
      expect(header.textContent).not.toContain('来源')

      // 3. Batch mode
      expect(queryByTestId('batch-action-bar')).toBeNull()

      const moreBtn = getByTestId('local-music-more-trigger')
      await act(async () => {
        moreBtn.click()
        await tick()
      })

      const batchOpItem = getByText('批量操作')
      expect(batchOpItem).toBeTruthy()
      await act(async () => {
        batchOpItem.click()
        await tick()
      })

      const enterBatchItem = getByText('开启批量操作')
      expect(enterBatchItem).toBeTruthy()
      await act(async () => {
        enterBatchItem.click()
        await tick()
      })

      expect(getByTestId('batch-action-bar')).toBeTruthy()
      expect(getByTestId('batch-select-all')).toBeTruthy()

      // Select all
      await act(async () => {
        getByTestId('batch-select-all').click()
        await tick()
      })
      expect(getByTestId('batch-selected-count').textContent).toContain('2 / 2')

      // Exit batch
      await act(async () => {
        getByTestId('batch-exit-btn').click()
        await tick()
      })
      expect(queryByTestId('batch-action-bar')).toBeNull()
    })
  })
})

