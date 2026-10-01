// @vitest-environment jsdom
/**
 * The menu models, without a renderer where possible.
 *
 * The kits render `MenuItemSpec`s; what is pinned here is which actions an
 * entity gets, what each one calls, and — the part users notice — that an
 * action a build cannot perform is *absent* rather than present and throwing.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import type { LibraryService, Playlist, SleepTimerService, SleepTimerState, Track } from '@BBeBee/protocol'
import {
  addToCollectionOnlyItems,
  addToCollectionSubmenu,
  addToPlaylistSubmenu,
  collectionMenuItems,
  openExternalUrl,
  playlistMenuItems,
  resolveOriginalResourceUrl,
  sleepTimerSubmenu,
  trackMenuItems,
  useSaveToPlaylistMenu,
  useTrackMenu,
} from './index.js'

afterEach(cleanup)

const URN = 'BBeBee:local:track:1'
const ALBUM = 'BBeBee:local:album:1'

const track: Track = {
  urn: URN,
  title: 'Jóga',
  artists: [],
  albumUrn: ALBUM,
  loved: true,
}

const playlists: Playlist[] = [
  { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
  { urn: 'BBeBee:local:playlist:smart', name: 'Loved', isSmart: true },
]

class LibraryStub extends Service {
  readonly calls: string[] = []
  items: readonly Playlist[] = playlists
  readonly collections = [{ id: 'col-1', name: 'Shelf', position: 'a', createdAt: 0 }]
  constructor(ctx: Context) {
    super(ctx, 'library')
  }
  async listPlaylists() {
    return { items: this.items, hasMore: false }
  }
  async listCollections() {
    return this.collections
  }
  async createCollection(name: string) {
    this.calls.push(`collection:${name}`)
    return { id: 'col-new', name, position: 'b', createdAt: 0 }
  }
  async addToCollection(id: string, urns: readonly string[]) {
    this.calls.push(`collect:${id}:${urns.join(',')}`)
    return urns.length
  }
  async removeFromCollection(id: string, urns: readonly string[]) {
    this.calls.push(`uncollect:${id}:${urns.join(',')}`)
  }
  async createPlaylist(name: string) {
    this.calls.push(`create:${name}`)
    return { urn: 'BBeBee:local:playlist:new', name }
  }
  async addTracks(urn: string, urns: readonly string[]) {
    this.calls.push(`add:${urn}:${urns.join(',')}`)
    return urns.length
  }
  async removeItems(urn: string, ids: readonly string[]) {
    this.calls.push(`remove:${urn}:${ids.join(',')}`)
  }
  async setSaved(urn: string, saved: boolean) {
    this.calls.push(`save:${urn}:${saved}`)
  }
}

class SourcesStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async setLoved(urn: string, loved: boolean) {
    this.calls.push(`loved:${urn}:${loved}`)
  }
}

class PlayerStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  enqueueLast(urns: string[]) {
    this.calls.push(`enqueue:${urns.join(',')}`)
  }
  removeItems(ids: string[]) {
    this.calls.push(`removeItems:${ids.join(',')}`)
  }
  async removeHistory(id: string) {
    this.calls.push(`removeHistory:${id}`)
  }
}

class DownloadsStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }
  async enqueue(urns: string[]) {
    this.calls.push(`download:${urns.join(',')}`)
    return []
  }
}

class UiStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(id: string, params?: Record<string, unknown>) {
    this.calls.push(`nav:${id}:${JSON.stringify(params ?? {})}`)
  }
}

class SleepTimerStub extends Service {
  readonly calls: string[] = []
  state: SleepTimerState = {
    active: false,
  }
  constructor(ctx: Context) {
    super(ctx, 'sleepTimer')
  }
  startDuration(ms: number) {
    this.calls.push(`duration:${ms}`)
    this.state = { active: true, mode: 'duration', targetEpochMs: Date.now() + ms, durationMs: ms }
  }
  startAtEpoch(epochMs: number) {
    this.calls.push(`epoch:${epochMs}`)
    this.state = { active: true, mode: 'epoch', targetEpochMs: epochMs, durationMs: Math.max(0, epochMs - Date.now()) }
  }
  startEndOfTrack() {
    this.calls.push('end-of-track')
    this.state = { active: true, mode: 'end-of-track' }
  }
  cancel() {
    this.calls.push('cancel')
    this.state = { active: false }
  }
}

class ShareStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'share')
  }
  shareTrack(t: Track) {
    this.calls.push(`shareTrack:${t.urn}`)
  }
  sharePlaylist(p: { urn: string }, tracks?: readonly any[]) {
    this.calls.push(`sharePlaylist:${p.urn}:${tracks?.length ?? 0}`)
  }
  shareLyrics(t: Track, lines: string[]) {
    this.calls.push(`shareLyrics:${t.urn}:${lines.length}`)
  }
}

async function harness(opts: { downloads?: boolean; player?: boolean; ui?: boolean; sleepTimer?: boolean; share?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(LibraryStub)
  await ctx.plugin(SourcesStub)
  if (opts.player !== false) await ctx.plugin(PlayerStub)
  if (opts.downloads !== false) await ctx.plugin(DownloadsStub)
  if (opts.ui !== false) await ctx.plugin(UiStub)
  if (opts.sleepTimer === true) await ctx.plugin(SleepTimerStub)
  if (opts.share === true) await ctx.plugin(ShareStub)
  return {
    ctx,
    library: ctx.library as unknown as LibraryStub,
    sources: ctx.sources as unknown as SourcesStub,
    player: ctx.player as unknown as PlayerStub,
    downloads: ctx.downloads as unknown as DownloadsStub,
    ui: ctx.ui as unknown as UiStub,
    sleepTimer: ctx.sleepTimer as unknown as SleepTimerStub,
    share: (ctx as any).share as ShareStub,
  }
}

/** Run an item's handler as a press would. */
async function press(items: ReturnType<typeof trackMenuItems>, id: string): Promise<void> {
  const item = items.find((i) => i.id === id)
  expect(item, `item ${id}`).toBeTruthy()
  await item!.onSelect?.()
}

describe('trackMenuItems', () => {
  it('offers every action in the order the menu shows them', async () => {
    const h = await harness()
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    expect(items.map((i) => i.id)).toEqual([
      'add-to-playlist',
      'remove-favourite',
      'enqueue',
      'download',
      'go-to-album',
    ])
  })

  it('omits what the build cannot do rather than offering a failing item', async () => {
    const h = await harness({ downloads: false, player: false, ui: false })
    const items = trackMenuItems(h.ctx, { track: { ...track, loved: false } }, {})
    expect(items.map((i) => i.id)).toEqual(['add-to-playlist', 'add-favourite'])
  })

  it('offers “remove from this playlist” only inside a playlist', async () => {
    const h = await harness()
    const outside = trackMenuItems(h.ctx, { track }, { playlists })
    expect(outside.some((i) => i.id === 'remove-from-playlist')).toBe(false)

    const inside = trackMenuItems(
      h.ctx,
      { track, playlistItemId: 'item-1' },
      { fromPlaylistUrn: 'BBeBee:local:playlist:1', playlists },
    )
    await press(inside, 'remove-from-playlist')
    expect(h.library.calls).toContain('remove:BBeBee:local:playlist:1:item-1')
  })

  it('offers “remove from queue” when queueItemId is present', async () => {
    const h = await harness()
    const items = trackMenuItems(h.ctx, { track, queueItemId: 'queue-entry-1' }, { playlists })
    const removeItem = items.find((i) => i.id === 'remove-from-queue')
    expect(removeItem).toBeTruthy()
    expect(removeItem?.label).toBe('从队列中移除')
    expect(removeItem?.tone).toBe('danger')
    await press(items, 'remove-from-queue')
    expect(h.player.calls).toContain('removeItems:queue-entry-1')
  })

  it('offers “remove from history” when historyRecordId or isHistory is present', async () => {
    const h = await harness()
    const items = trackMenuItems(h.ctx, { track, historyRecordId: 'hist-1' }, { playlists })
    const removeItem = items.find((i) => i.id === 'remove-from-history')
    expect(removeItem).toBeTruthy()
    expect(removeItem?.label).toBe('从最近播放中移除')
    expect(removeItem?.tone).toBe('danger')
    await press(items, 'remove-from-history')
    expect(h.player.calls).toContain('removeHistory:hist-1')
  })

  it('unlikes through both stores, so the heart and the shelf agree', async () => {
    const h = await harness()
    await press(trackMenuItems(h.ctx, { track }, { playlists }), 'remove-favourite')
    expect(h.sources.calls).toEqual([`loved:${URN}:false`])
    expect(h.library.calls).toEqual([`save:${URN}:false`])
  })

  it('likes through both stores, so the heart and the shelf agree', async () => {
    const h = await harness()
    await press(trackMenuItems(h.ctx, { track: { ...track, loved: false } }, { playlists }), 'add-favourite')
    expect(h.sources.calls).toEqual([`loved:${URN}:true`])
    expect(h.library.calls).toEqual([`save:${URN}:true`])
  })

  it('queues, downloads and navigates to the album', async () => {
    const h = await harness()
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    await press(items, 'enqueue')
    await press(items, 'download')
    await press(items, 'go-to-album')

    expect(h.player.calls).toEqual([`enqueue:${URN}`])
    expect(h.downloads.calls).toEqual([`download:${URN}`])
    expect(h.ui.calls).toEqual([`nav:album.view:${JSON.stringify({ urn: ALBUM })}`])
  })

  it('includes sleep timer when sleepTimer service is present', async () => {
    const h = await harness({ sleepTimer: true })
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    const timerItem = items.find((i) => i.id === 'sleep-timer')
    expect(timerItem).toBeTruthy()
    expect(timerItem?.label).toBe('睡眠定时器')
    expect(timerItem?.submenu).toBeTruthy()
  })

  it('shows (已开启) on sleep timer label when timer is active', async () => {
    const h = await harness({ sleepTimer: true })
    h.sleepTimer.startDuration(600_000)
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    const timerItem = items.find((i) => i.id === 'sleep-timer')
    expect(timerItem).toBeTruthy()
    expect(timerItem?.label).toBe('睡眠定时器 (已开启)')
  })

  it('offers share-track when share service is present and triggers shareTrack on press', async () => {
    const h = await harness({ share: true })
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    const shareItem = items.find((i) => i.id === 'share-track')
    expect(shareItem).toBeTruthy()
    expect(shareItem?.label).toBe('分享歌曲')
    await press(items, 'share-track')
    expect(h.share.calls).toContain(`shareTrack:${URN}`)
  })

  it('offers share-lyrics only when the caller hands over lyric lines', async () => {
    const h = await harness({ share: true })

    // Without lyrics on screen the model must not promise the share.
    const bare = trackMenuItems(h.ctx, { track }, { playlists })
    expect(bare.some((i) => i.id === 'share-lyrics')).toBe(false)

    const items = trackMenuItems(h.ctx, { track }, { playlists, lyrics: { lines: ['第一句', '第二句'] } })
    const lyricsItem = items.find((i) => i.id === 'share-lyrics')
    expect(lyricsItem?.label).toBe('分享歌词')
    await press(items, 'share-lyrics')
    expect(h.share.calls).toContain(`shareLyrics:${URN}:2`)
  })

  it('offers track-info when onShowTrackInfo is provided and triggers callback on press', async () => {
    const h = await harness()
    let shownTrack: any = null
    const items = trackMenuItems(
      h.ctx,
      { track },
      {
        onShowTrackInfo: (t) => {
          shownTrack = t
        },
      },
    )
    const infoItem = items.find((i) => i.id === 'track-info')
    expect(infoItem).toBeTruthy()
    expect(infoItem?.label).toBe('查看播放内容')
    await press(items, 'track-info')
    expect(shownTrack).toBe(track)
  })
})

describe('useSaveToPlaylistMenu', () => {
  it('toggles liked through both stores, so the row heart and the shelf agree', async () => {
    const h = await harness({ player: false, downloads: false, ui: false })
    const { result } = renderHook(() => useSaveToPlaylistMenu(h.ctx))
    act(() => {
      result.current.open({ urn: URN, title: 'Jóga', loved: true }, { x: 0, y: 0 })
    })
    await act(async () => {
      await result.current.menuProps.onToggleLiked()
    })
    // Catalogue's loved flag first, then the shelf write — the order every
    // favourite writer uses, because the `library/changed` event the shelf
    // write fires is when listeners re-read.
    expect(h.sources.calls).toEqual([`loved:${URN}:false`])
    expect(h.library.calls).toEqual([`save:${URN}:false`])
  })
})

describe('the sleep-timer submenu', () => {
  it('returns undefined when sleepTimer service is absent', () => {
    expect(sleepTimerSubmenu(undefined)).toBeUndefined()
  })

  it('lists preset intervals, end-of-track, and offers custom time create when inactive', () => {
    const stub = new SleepTimerStub(new Context()) as unknown as SleepTimerService
    const submenu = sleepTimerSubmenu(stub)
    expect(submenu?.title).toBe('睡眠定时器')
    expect(submenu?.create?.label).toBe('自定义时间')
    expect(submenu?.create?.placeholder).toBe('自定义时间 (单位: 分钟)')
    expect(submenu?.create?.alwaysVisible).toBe(true)
    expect(submenu?.create?.placement).toBe('bottom')
    expect(submenu?.create?.buttonLabel).toBe('确定')
    expect(submenu?.items.map((i) => i.label)).toEqual([
      '5 分钟',
      '10 分钟',
      '15 分钟',
      '30 分钟',
      '45 分钟',
      '1 小时',
      '曲目结束时',
    ])
    expect(submenu?.items.some((i) => i.id === 'timer-cancel')).toBe(false)
  })

  it('starts duration and end-of-track from preset items', async () => {
    const ctx = new Context()
    const stub = new SleepTimerStub(ctx)
    const submenu = sleepTimerSubmenu(stub as unknown as SleepTimerService)!

    await submenu.items.find((i) => i.id === 'timer-5m')?.onSelect?.()
    expect(stub.calls).toContain('duration:300000')

    await submenu.items.find((i) => i.id === 'timer-end-of-track')?.onSelect?.()
    expect(stub.calls).toContain('end-of-track')
  })

  it('handles custom time input for minutes and clock time', async () => {
    const ctx = new Context()
    const stub = new SleepTimerStub(ctx)
    const submenu = sleepTimerSubmenu(stub as unknown as SleepTimerService)!

    // Numeric minutes
    await submenu.create?.onSelect('25')
    expect(stub.calls).toContain('duration:1500000')

    // Clock time HH:mm
    await submenu.create?.onSelect('14:30')
    expect(stub.calls.some((c) => c.startsWith('epoch:'))).toBe(true)
  })

  it('shows cancel option when timer is active and cancels on press', async () => {
    const ctx = new Context()
    const stub = new SleepTimerStub(ctx)
    stub.startDuration(600_000)
    expect(stub.state.active).toBe(true)

    const submenu = sleepTimerSubmenu(stub as unknown as SleepTimerService)!
    const cancelItem = submenu.items.find((i) => i.id === 'timer-cancel')
    expect(cancelItem).toBeTruthy()
    expect(cancelItem?.label).toBe('关闭睡眠定时器')
    expect(cancelItem?.tone).toBe('danger')

    await cancelItem?.onSelect?.()
    expect(stub.calls).toContain('cancel')
  })
})

describe('the add-to-playlist submenu', () => {
  it('filters by a search field, offers create, then lists the playlists', () => {
    const submenu = addToPlaylistSubmenu(
      new LibraryStub(new Context()) as unknown as LibraryService,
      [URN],
      playlists,
    )
    expect(submenu?.searchPlaceholder).toBe('查找歌单')
    expect(submenu?.create?.label).toBe('新建歌单')
    expect(submenu?.items.map((i) => i.label)).toEqual(['Road trip', 'Loved'])
    // A smart playlist has no row an add could write, so it is disabled.
    expect(submenu?.items[1]?.disabled).toBe(true)
  })

  it('creates a playlist and adds the track to it in one press', async () => {
    const h = await harness()
    const submenu = addToPlaylistSubmenu(h.library as unknown as LibraryService, [URN], playlists)!
    await submenu.create?.onSelect('New mix')
    expect(h.library.calls).toEqual([
      'create:New mix',
      'add:BBeBee:local:playlist:new:BBeBee:local:track:1',
    ])
  })

  it('adds to an existing playlist from the list', async () => {
    const h = await harness()
    const submenu = addToPlaylistSubmenu(h.library as unknown as LibraryService, [URN], playlists)!
    await submenu.items[0]?.onSelect?.()
    expect(h.library.calls).toEqual(['add:BBeBee:local:playlist:1:BBeBee:local:track:1'])
  })
})

describe('the add-to-collection submenu', () => {
  it('filters, creates and lists, exactly like the playlist one', async () => {
    const h = await harness()
    const submenu = addToCollectionSubmenu(h.library as unknown as LibraryService, [ALBUM], h.library.collections)
    expect(submenu?.searchPlaceholder).toBe('查找合集')
    expect(submenu?.create?.label).toBe('新建合集')
    expect(submenu?.items.map((i) => i.label)).toEqual(['Shelf'])

    await submenu!.create?.onSelect('New shelf')
    expect(h.library.calls).toEqual(['collection:New shelf', `collect:col-new:${ALBUM}`])

    await submenu!.items[0]?.onSelect?.()
    expect(h.library.calls).toContain(`collect:col-1:${ALBUM}`)
  })

  it('rejects track URNs and returns undefined when only tracks are passed', async () => {
    const h = await harness()
    const submenu = addToCollectionSubmenu(h.library as unknown as LibraryService, [URN], h.library.collections)
    expect(submenu).toBeUndefined()
  })

  it('adds a playlist itself, so its songs are in the library through it', async () => {
    const h = await harness()
    const items = playlistMenuItems(
      h.ctx,
      { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
      [URN],
      playlists,
      h.library.collections,
    )
    const submenu = items.find((i) => i.id === 'add-to-collection')?.submenu
    expect(submenu).toBeTruthy()
    await submenu!.items[0]?.onSelect?.()
    expect(h.library.calls).toContain('collect:col-1:BBeBee:local:playlist:1')
  })

  it('moves to root when currentFolderId is provided and removes from original folder', async () => {
    const h = await harness()
    let movedTarget: string | null | undefined
    const submenu = addToCollectionSubmenu(
      h.library as unknown as LibraryService,
      ['BBeBee:local:playlist:1'],
      h.library.collections,
      {
        currentFolderId: 'col-1',
        onMoved: (target) => {
          movedTarget = target
        },
      },
    )!
    const moveRoot = submenu.items.find((i) => i.id === '__move_root')
    expect(moveRoot).toBeTruthy()
    expect(moveRoot?.label).toBe('移至根目录')
    expect(submenu.items.some((i) => i.id === 'col-1')).toBe(false)

    await moveRoot?.onSelect?.()
    expect(h.library.calls).toContain('uncollect:col-1:BBeBee:local:playlist:1')
    expect(movedTarget).toBeNull()
  })

  it('moves to another folder, removing from current folder and adding to target folder', async () => {
    const h = await harness()
    let movedTarget: string | null | undefined
    const cols = [
      { id: 'col-1', name: 'Folder 1', position: 'a', createdAt: 0 },
      { id: 'col-2', name: 'Folder 2', position: 'b', createdAt: 0 },
    ]
    const submenu = addToCollectionSubmenu(
      h.library as unknown as LibraryService,
      ['BBeBee:local:playlist:1'],
      cols,
      {
        currentFolderId: 'col-1',
        onMoved: (target) => {
          movedTarget = target
        },
      },
    )!
    const targetFolder = submenu.items.find((i) => i.id === 'col-2')
    expect(targetFolder).toBeTruthy()

    await targetFolder?.onSelect?.()
    expect(h.library.calls).toContain('uncollect:col-1:BBeBee:local:playlist:1')
    expect(h.library.calls).toContain('collect:col-2:BBeBee:local:playlist:1')
    expect(movedTarget).toBe('col-2')
  })
})

describe('addToCollectionOnlyItems', () => {
  it('offers the folder submenu for an album, and nothing when unloaded', async () => {
    const h = await harness()
    const items = addToCollectionOnlyItems(h.ctx, ['BBeBee:demo:album:1'], h.library.collections)
    expect(items.map((i) => i.id)).toEqual(['add-to-collection'])
    await items[0]?.submenu?.items[0]?.onSelect?.()
    expect(h.library.calls).toContain('collect:col-1:BBeBee:demo:album:1')

    const bare = new Context()
    expect(addToCollectionOnlyItems(bare, ['x'], [])).toEqual([])
  })

  it('offers delete-album when onDelete is provided', async () => {
    const h = await harness()
    const onDelete = vi.fn()
    const items = addToCollectionOnlyItems(h.ctx, ['BBeBee:demo:album:1'], h.library.collections, {
      onDelete,
    })
    const deleteItem = items.find((i) => i.id === 'delete-album')
    expect(deleteItem).toBeDefined()
    expect(deleteItem?.label).toBe('删除')
    expect(deleteItem?.tone).toBe('danger')
    deleteItem?.onSelect?.()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('playlistMenuItems', () => {
  it('saves, queues, downloads and copies the whole list', async () => {
    const h = await harness()
    const items = playlistMenuItems(
      h.ctx,
      { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
      [URN, 'BBeBee:local:track:2'],
      playlists,
    )
    expect(items.map((i) => i.id)).toEqual([
      'save-to-library',
      'enqueue',
      'download',
      'add-to-playlist',
      'add-to-collection',
    ])
    await press(items, 'save-to-library')
    await press(items, 'enqueue')
    await press(items, 'download')

    expect(h.library.calls).toEqual(['save:BBeBee:local:playlist:1:true'])
    expect(h.player.calls).toEqual([`enqueue:${URN},BBeBee:local:track:2`])
    expect(h.downloads.calls).toEqual([`download:${URN},BBeBee:local:track:2`])
  })

  it('drops the list actions when the tracks were never resolved', async () => {
    const h = await harness()
    const items = playlistMenuItems(h.ctx, { urn: 'u', name: 'n' }, [], [])
    // Nothing to queue, download or copy: the save and the folder remain. An
    // item that would act on an empty list is worse than one that is absent.
    expect(items.map((i) => i.id)).toEqual(['save-to-library', 'add-to-collection'])
  })

  it('offers edit-details and delete-playlist when options are provided', async () => {
    const h = await harness()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const items = playlistMenuItems(
      h.ctx,
      { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
      [URN],
      playlists,
      h.library.collections,
      { onEdit, onDelete },
    )
    expect(items[0]?.id).toBe('edit-details')
    expect(items[0]?.label).toBe('编辑详情')
    expect(items[1]?.id).toBe('delete-playlist')
    expect(items[1]?.label).toBe('删除')
    expect(items[1]?.divider).toBe(true)

    await press(items, 'edit-details')
    expect(onEdit).toHaveBeenCalledOnce()

    await press(items, 'delete-playlist')
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('offers share-playlist when share service is present and triggers sharePlaylist on press', async () => {
    const h = await harness({ share: true })
    const items = playlistMenuItems(
      h.ctx,
      { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
      [URN],
      playlists,
      h.library.collections,
    )
    const shareItem = items.find((i) => i.id === 'share-playlist')
    expect(shareItem).toBeTruthy()
    expect(shareItem?.label).toBe('分享歌单')
    await press(items, 'share-playlist')
    expect(h.share.calls).toContain('sharePlaylist:BBeBee:local:playlist:1:1')
  })
})

describe('collectionMenuItems', () => {
  it('acts on the collection’s track members, and offers no save', async () => {
    const h = await harness()
    const items = collectionMenuItems(h.ctx, [URN], playlists)
    expect(items.map((i) => i.id)).toEqual(['enqueue', 'download', 'add-to-playlist'])
    await press(items, 'enqueue')
    expect(h.player.calls).toEqual([`enqueue:${URN}`])
  })

  it('offers rename, delete, create playlist, create folder, and move to folder when provided', async () => {
    const h = await harness()
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const onCreatePlaylist = vi.fn()
    const onCreateFolder = vi.fn()
    const onMoveToFolder = vi.fn()

    const items = collectionMenuItems(
      h.ctx,
      [URN],
      playlists,
      h.library.collections,
      {
        collectionId: 'col-1',
        onRename,
        onDelete,
        onCreatePlaylist,
        onCreateFolder,
        onMoveToFolder,
      },
    )

    expect(items.map((i) => i.id)).toContain('rename-collection')
    expect(items.map((i) => i.id)).toContain('delete-collection')
    expect(items.map((i) => i.id)).toContain('create-playlist')
    expect(items.map((i) => i.id)).toContain('create-folder')
    expect(items.map((i) => i.id)).toContain('move-to-folder')

    await press(items, 'rename-collection')
    expect(onRename).toHaveBeenCalledOnce()

    await press(items, 'delete-collection')
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('useTrackMenu', () => {
  it('opens with the track’s name and closes cleanly', async () => {
    const h = await harness()
    const { result } = renderHook(() => useTrackMenu(h.ctx))
    expect(result.current.menuProps.open).toBe(false)

    act(() => result.current.open({ track }, { x: 10, y: 20 }))
    expect(result.current.menuProps.open).toBe(true)
    expect(result.current.menuProps.x).toBe(10)
    expect(result.current.menuProps.title).toBe('Jóga')
    expect(result.current.menuProps.items.length).toBeGreaterThan(0)

    act(() => result.current.menuProps.onClose())
    expect(result.current.menuProps.open).toBe(false)
  })
})

describe('resolveOriginalResourceUrl & openExternalUrl', () => {
  it('returns undefined for local track or album', () => {
    expect(resolveOriginalResourceUrl('BBeBee:local:track:1')).toBeUndefined()
    expect(resolveOriginalResourceUrl({ urn: 'BBeBee:local:album:1', kind: 'album' })).toBeUndefined()
  })

  it('resolves bilibili track video url', () => {
    expect(resolveOriginalResourceUrl('BBeBee:bilibili:track:BV1xx411c7mD')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    )
    expect(resolveOriginalResourceUrl('BBeBee:bilibili:track:bili_video_BV1xx411c7mD_12345')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    )
    expect(resolveOriginalResourceUrl('BBeBee:bilibili:track:BV1xx411c7mD_p2')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD?p=2',
    )
    expect(resolveOriginalResourceUrl('BBeBee:bilibili:track:BV1xx411c7mD_p1')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    )
  })

  it('resolves bilibili season, series, and collect album/playlist urls', () => {
    expect(
      resolveOriginalResourceUrl({
        urn: 'BBeBee:bilibili:album:bili_season_12345_67890',
        kind: 'album',
      }),
    ).toBe('https://space.bilibili.com/12345/channel/collectiondetail?sid=67890')

    expect(
      resolveOriginalResourceUrl({
        urn: 'BBeBee:bilibili:playlist:bili_series_111_222',
        kind: 'playlist',
      }),
    ).toBe('https://space.bilibili.com/111/channel/seriesdetail?sid=222')

    expect(
      resolveOriginalResourceUrl({
        urn: 'BBeBee:bilibili:album:bili_collect_99999',
        kind: 'album',
      }),
    ).toBe('https://www.bilibili.com/medialist/play/ml99999')
  })

  it('includes open-original-resource item in trackMenuItems for third-party track', async () => {
    const h = await harness()
    const thirdPartyTrack: Track = {
      urn: 'BBeBee:bilibili:track:BV1xx411c7mD',
      title: 'Bili Song',
      artists: [],
    }
    const items = trackMenuItems(h.ctx, { track: thirdPartyTrack })
    const openItem = items.find((i) => i.id === 'open-original-resource')
    expect(openItem).toBeDefined()
    expect(openItem?.label).toBe('跳转原始资源')
  })

  it('includes open-original-resource item in playlistMenuItems for third-party playlist', async () => {
    const h = await harness()
    const items = playlistMenuItems(
      h.ctx,
      { urn: 'BBeBee:bilibili:playlist:bili_season_123_456', name: 'Bili Season' },
      [],
    )
    const openItem = items.find((i) => i.id === 'open-original-resource')
    expect(openItem).toBeDefined()
    expect(openItem?.label).toBe('跳转原始资源')
  })

  it('calls window.open in openExternalUrl fallback', () => {
    const spy = vi.spyOn(window, 'open').mockImplementation(() => null)
    openExternalUrl('https://www.bilibili.com/video/BV1xx411c7mD')
    expect(spy).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1xx411c7mD', '_blank')
    spy.mockRestore()
  })
})

