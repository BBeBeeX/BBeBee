// @vitest-environment jsdom
/**
 * The desktop album screen, rendered and pressed.
 *
 * What is pinned is the playback contract the screen exists to express:
 * "Play album" replaces the queue outright, a row tap carries the whole album
 * as its context, a download button reaches the queue, and a missing album is
 * said out loud rather than shown as an empty page.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { AlbumDetail, DownloadTask } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { AlbumScreen } from './index.js'

afterEach(cleanup)

const ALBUM_URN = 'BBeBee:remote:album:one'
const TRACK_A = 'BBeBee:remote:track:a'
const TRACK_B = 'BBeBee:remote:track:b'

const detail: AlbumDetail = {
  urn: ALBUM_URN,
  title: 'Homogenic',
  artists: [{ urn: 'BBeBee:remote:artist:bjork', name: 'Björk', role: 'main', ordinal: 0 }],
  tracks: [
    { urn: TRACK_A, title: 'Hunter', artists: [] },
    { urn: TRACK_B, title: 'Jóga', artists: [] },
  ],
}

const LOCAL_ALBUM_URN = 'BBeBee:local:album:local1'
const localDetail: AlbumDetail = {
  urn: LOCAL_ALBUM_URN,
  title: 'Local Album',
  artists: [{ urn: 'BBeBee:local:artist:local', name: 'Local Artist', role: 'main', ordinal: 0 }],
  tracks: [
    { urn: 'BBeBee:local:track:1', title: 'Local 1', artists: [] },
  ],
}

class SourcesStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    if (urn === ALBUM_URN) return detail
    if (urn === LOCAL_ALBUM_URN) return localDetail
    return undefined
  }
}

class PlayerStub extends Service {
  readonly calls: { method: string; urn?: string; urns?: readonly string[]; context?: unknown }[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  async playNow(urns: string[]): Promise<void> {
    this.calls.push({ method: 'playNow', urns })
  }
  async playFromContext(
    urn: string,
    urns?: readonly string[],
    opts?: { context?: unknown },
  ): Promise<void> {
    this.calls.push({ method: 'playFromContext', urn, urns, context: opts?.context })
  }
}

class DownloadsStub extends Service {
  readonly queued: string[][] = []
  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }
  async enqueue(urns: string[]): Promise<DownloadTask[]> {
    this.queued.push(urns)
    return []
  }
}

class UiStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(): void {}
}

class LibraryStub extends Service {
  readonly saved = new Set<string>()
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'library')
  }
  async isSaved(urn: string): Promise<boolean> {
    return this.saved.has(urn)
  }
  async setSaved(urn: string, saved: boolean): Promise<void> {
    this.calls.push(`save:${urn}:${saved}`)
    if (saved) this.saved.add(urn)
    else this.saved.delete(urn)
    this.ctx.emit('library/changed', 'album', [urn])
  }
  async listSaved(kind: string): Promise<{ items: { urn: string }[] }> {
    return { items: Array.from(this.saved).filter((urn) => urn.includes(kind)).map((urn) => ({ urn })) }
  }
  async listPlaylists() {
    return { items: [{ urn: 'BBeBee:user:playlist:p1', name: 'My Playlist', isSmart: false }] }
  }
  async addTracks(playlistUrn: string, trackUrns: string[]): Promise<void> {
    this.calls.push(`addTracks:${playlistUrn}:${trackUrns.join(',')}`)
  }
  async createPlaylist(name: string) {
    const p = { urn: `BBeBee:user:playlist:${Date.now()}`, name, isSmart: false }
    this.calls.push(`createPlaylist:${name}`)
    return p
  }
  async listCollections() {
    return [
      { id: 'col-1', name: 'My Folder', memberCount: 0, depth: 0, path: 'My Folder', revision: 0, createdAt: 0, updatedAt: 0 },
    ]
  }
}

async function harness() {
  const root = new Context()
  await root.plugin(SourcesStub)
  await root.plugin(PlayerStub)
  await root.plugin(DownloadsStub)
  await root.plugin(UiStub)
  await root.plugin(LibraryStub)
  let scoped: Context | undefined
  root.inject(['ui', 'sources', 'player', 'downloads', 'library'], (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('no scoped context')
  return {
    ctx: scoped,
    player: root.player as unknown as PlayerStub,
    downloads: root.downloads as unknown as DownloadsStub,
    library: root.library as unknown as LibraryStub,
  }
}

describe('AlbumScreen', () => {
  it('draws the album and plays it from the top', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getAllByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
        await tick()
      })

      expect(getAllByText('Homogenic').length).toBeGreaterThan(0)
      await act(async () => {
        // 页面滚动折叠后 hero 与吸顶栏各有一个 Play album，点第一个（hero）。
        getAllByText('Play album')[0]!.click()
        await tick()
      })
    })

    expect(player.calls).toEqual([{ method: 'playNow', urns: [TRACK_A, TRACK_B] }])
  })

  it('plays a tapped row with the whole album as its context', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })
      await act(async () => {
        getByText('Jóga').click()
        await tick()
      })
    })

    expect(player.calls).toEqual([
      {
        method: 'playFromContext',
        urn: TRACK_B,
        urns: [TRACK_A, TRACK_B],
        context: { kind: 'album', urn: ALBUM_URN, label: 'Homogenic' },
      },
    ])
  })

  it('queues a download from a row without touching playback', async () => {
    const { ctx, player, downloads } = await harness()
    await withListLayout(async () => {
      const { getAllByLabelText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })
      await act(async () => {
        getAllByLabelText('Download')[0]!.click()
        await tick()
      })
    })

    expect(downloads.queued).toEqual([[TRACK_A]])
    expect(player.calls).toEqual([])
  })

  it('says an album is unavailable rather than drawing an empty one', async () => {
    const { ctx } = await harness()
    const { container } = render(h(AlbumScreen, { ctx, urn: 'BBeBee:local:album:missing' }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Album unavailable')
    expect(container.textContent).toContain('no album')
  })

  it('supports sorting tracks by clicking headers', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByTestId, getAllByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      // Clicking '#' toggles trackNo to desc
      await act(async () => {
        getByTestId('album-sort-trackNo').click()
        await tick()
      })

      // Now "Play album" should play in reversed order [TRACK_B, TRACK_A]
      await act(async () => {
        getAllByText('Play album')[0]!.click()
        await tick()
      })
    })

    expect(player.calls).toEqual([{ method: 'playNow', urns: [TRACK_B, TRACK_A] }])
  })

  it('supports sorting tracks via sort menu trigger', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      // Click sort trigger to open ContextMenu
      await act(async () => {
        getByTestId('album-sort-trigger').click()
        await tick()
      })

      // Click "降序" in the menu
      await act(async () => {
        getByText('降序').click()
        await tick()
      })

      // Play Jóga row, context should be [TRACK_B, TRACK_A]
      await act(async () => {
        getByText('Jóga').click()
        await tick()
      })
    })

    expect(player.calls).toEqual([
      {
        method: 'playFromContext',
        urn: TRACK_B,
        urns: [TRACK_B, TRACK_A],
        context: { kind: 'album', urn: ALBUM_URN, label: 'Homogenic' },
      },
    ])
  })

  it('toggles album save state via heart button', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { getByTestId } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      const heart = getByTestId('album-heart-trigger')
      expect(heart.querySelector('[data-icon="heart"]')).toBeTruthy()

      await act(async () => {
        heart.click()
        await tick()
      })
      expect(library.calls).toContain(`save:${ALBUM_URN}:true`)
      expect(heart.querySelector('[data-icon="heart-filled"]')).toBeTruthy()

      await act(async () => {
        heart.click()
        await tick()
      })
      expect(library.calls).toContain(`save:${ALBUM_URN}:false`)
      expect(heart.querySelector('[data-icon="heart"]')).toBeTruthy()
    })
  })

  it('hides download buttons when album is local', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const { queryByTestId, queryAllByLabelText } = render(h(AlbumScreen, { ctx, urn: LOCAL_ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      expect(queryByTestId('album-download-all')).toBeNull()
      expect(queryAllByLabelText('Download')).toHaveLength(0)
    })
  })

  it('provides custom album three-dots menu', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { getByTestId, getByText, queryByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      // Click more options trigger
      await act(async () => {
        getByTestId('album-more-trigger').click()
        await tick()
      })

      // Check items
      expect(getByText('加入文件夹')).toBeTruthy()
      expect(getByText('添加到音乐库')).toBeTruthy()
      expect(getByText('加入播放列表')).toBeTruthy()
      expect(getByText('下载')).toBeTruthy()

      // Removed items
      expect(queryByText('加入歌单')).toBeNull()
      expect(queryByText('转至专辑')).toBeNull()

      // Clicking '添加到音乐库' in menu saves the album
      await act(async () => {
        getByText('添加到音乐库').click()
        await tick()
      })
      expect(library.calls).toContain(`save:${ALBUM_URN}:true`)
    })
  })

  it('displays album column in table header and supports sorting by album', async () => {
    const { ctx } = await harness()
    await withListLayout(async () => {
      const { getByTestId } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      const albumCol = getByTestId('album-sort-album')
      expect(albumCol.textContent).toContain('专辑')

      await act(async () => {
        albumCol.click()
        await tick()
      })
      // 表头默认不带箭头；悬停表头后，当前排序列显示方向箭头。
      expect(albumCol.querySelector('[data-icon="chevron-up"]')).toBeNull()
      await act(async () => {
        fireEvent.mouseOver(albumCol)
        await tick()
      })
      expect(albumCol.querySelector('[data-icon="chevron-up"]')).toBeTruthy()
    })
  })

  it('renders track library action button and handles add to favorites and playlist menu', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { getAllByTitle, getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      const addButtons = getAllByTitle('加入最喜欢的音乐')
      expect(addButtons.length).toBeGreaterThan(0)
      const firstBtn = addButtons[0]!
      expect(firstBtn.querySelector('[data-icon="plus"]')).toBeTruthy()

      // Click '+'
      await act(async () => {
        firstBtn.click()
        await tick()
      })

      // Saved in library
      expect(library.calls).toContain(`save:${TRACK_A}:true`)
      // Row immediately updates to green heart '♥'
      expect(firstBtn.querySelector('[data-icon="heart-filled"]')).toBeTruthy()

      // Clicking '♥' opens playlist menu
      await act(async () => {
        firstBtn.click()
        await tick()
      })

      expect(getByText('添加到歌单')).toBeTruthy()
      expect(getByText('My Playlist')).toBeTruthy()
    })
  })

  it('renders third-party source badge on the album screen', async () => {
    const ctx = new Context()
    new SourcesStub(ctx)
    new PlayerStub(ctx)
    new DownloadsStub(ctx)
    new UiStub(ctx)
    new LibraryStub(ctx)

    await withListLayout(async () => {
      const { getByTestId } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })
      const badge = getByTestId('album-source-badge')
      expect(badge).toBeTruthy()
      expect(badge.textContent).toBe('remote')
    })
  })

  it('does not render source badge for local album', async () => {
    const ctx = new Context()
    new SourcesStub(ctx)
    new PlayerStub(ctx)
    new DownloadsStub(ctx)
    new UiStub(ctx)
    new LibraryStub(ctx)

    await withListLayout(async () => {
      const { queryByTestId } = render(h(AlbumScreen, { ctx, urn: LOCAL_ALBUM_URN }))
      await act(async () => {
        await tick()
      })
      expect(queryByTestId('album-source-badge')).toBeNull()
    })
  })

  it('deduplicates tracks, renders source column, and supports batch operations', async () => {
    const ctx = new Context()
    const sources = new SourcesStub(ctx)
    new PlayerStub(ctx)
    new DownloadsStub(ctx)
    new UiStub(ctx)
    new LibraryStub(ctx)

    const dupAlbumUrn = 'BBeBee:remote:album:dup'
    const origGetAlbum = sources.getAlbum.bind(sources)
    sources.getAlbum = async (urn: string) => {
      if (urn === dupAlbumUrn) {
        return {
          urn: dupAlbumUrn,
          title: 'Dup Album',
          artists: [],
          tracks: [
            { urn: TRACK_A, title: 'Hunter', artists: [] },
            { urn: TRACK_A, title: 'Hunter duplicate', artists: [] },
            { urn: TRACK_B, title: 'Jóga', artists: [] },
          ],
        }
      }
      return origGetAlbum(urn)
    }

    await withListLayout(async () => {
      const { container, getByTestId, queryByTestId, getByText } = render(h(AlbumScreen, { ctx, urn: dupAlbumUrn }))
      await act(async () => {
        await tick()
      })

      // 1. Deduplication: only 2 unique rows rendered
      const rows = container.querySelectorAll('[role="row"]')
      expect(rows.length).toBe(2)

      // 2. Source column header present
      const header = getByTestId('album-table-header')
      expect(header.textContent).toContain('来源')

      // 3. Batch mode initially off
      expect(queryByTestId('batch-action-bar')).toBeNull()

      // Open more menu
      const moreBtn = getByTestId('album-more-trigger')
      await act(async () => {
        moreBtn.click()
        await tick()
      })

      // Click batch operations to enter batch mode directly
      const batchOpItem = getByText('批量操作')
      expect(batchOpItem).toBeTruthy()
      await act(async () => {
        batchOpItem.click()
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

