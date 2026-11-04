// @vitest-environment jsdom
/**
 * The mobile library screens, rendered and pressed.
 *
 * Same wiring as the desktop twin, on the phone's transcription: the create
 * sheet that writes the trimmed name, a delete that goes through the shared
 * row menu and its confirmation, a remove control that passes the **item
 * id**, and a smart playlist that draws no remove control at all.
 *
 * React Native is injected as DOM host components, the same seam
 * `apps/mobile` uses to hand over the real `react-native`.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Collection, Paged, Playlist, PlaylistDetail, SavedKind, Track } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { CollectionScreen, FavoritesScreen, LibraryScreen, LocalMusicScreen, PlaylistDetailScreen, inject } from './index.js'
import enCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'
import zhCatalogue from '../../../feature/plugin-i18n/src/locales/zh.json'
import libraryCatalogue from '../../../feature/plugin-i18n/src/locales/library.json'

const CATALOGUES: Record<string, { en: unknown; zh: unknown }> = {
  app: { en: enCatalogue, zh: zhCatalogue },
  library: { en: libraryCatalogue.en, zh: libraryCatalogue.zh },
}

/**
 * Default i18n service for tests: serves the real English catalogue so
 * components under test render the same copy the app shows.
 */
class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  setLocale = (next: string): void => {
    this.locale = next
    for (const listener of [...this.listeners]) listener(next)
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const ns = key.slice(0, sep)
    const catalogue = CATALOGUES[ns]?.[this.locale === 'zh' ? 'zh' : 'en']
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

afterEach(cleanup)

const TRACK = 'BBeBee:demo:track:one'
const PLAYLIST_URN = 'BBeBee:local:playlist:one'
const ALBUM_URN = 'BBeBee:demo:album:one'
const COLLECTION_ID = 'col-1'

const track: Track = {
  urn: TRACK,
  title: 'Alpha',
  artists: [{ urn: 'BBeBee:demo:artist:a', name: 'A', role: 'main', ordinal: 0 }],
  albumUrn: ALBUM_URN,
  albumTitle: 'Homogenic',
  loved: true,
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

/** A fake native host: a `div` that keeps the RN props it was given. */
function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, onLongPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
        onContextMenu:
          typeof onLongPress === 'function'
            ? (e: any) => {
                e?.preventDefault?.()
                ;(onLongPress as () => void)()
              }
            : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  ScrollView: hostComponent('ScrollView'),
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
    testID?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      {
        'data-host': 'FlashList',
        'data-label': props.accessibilityLabel,
        'data-testid': props.testID,
        role: 'list',
      },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: function TextInput(props: Record<string, unknown>) {
    return h('input', {
      'data-testid': props.testID,
      value: props.value as string,
      placeholder: props.placeholder as string,
      onChange: (event: { target: { value: string } }) =>
        (props.onChangeText as ((value: string) => void) | undefined)?.(event.target.value),
    })
  },
})

class LibraryStub extends Service {
  readonly calls: string[] = []
  playlists: Playlist[] = [storedPlaylist]
  collections: Collection[] = []
  saved: string[] = [TRACK]

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
  async createCollection(name: string): Promise<Collection> {
    this.calls.push(`collection:${name}`)
    return { id: 'c1', name, position: 'a', createdAt: 0 }
  }
  async deleteCollection(id: string): Promise<void> {
    this.calls.push(`collection-delete:${id}`)
  }
  async listCollectionItems(id: string): Promise<Paged<{ urn: string; position: string }>> {
    return id === COLLECTION_ID
      ? {
          items: [
            { urn: TRACK, position: 'a' },
            { urn: ALBUM_URN, position: 'b' },
            { urn: PLAYLIST_URN, position: 'c' },
          ],
          hasMore: false,
        }
      : { items: [], hasMore: false }
  }
  async getPlaylist(urn: string): Promise<PlaylistDetail | undefined> {
    return urn === PLAYLIST_URN ? storedPlaylist : undefined
  }
  async listSaved(_kind?: SavedKind): Promise<Paged<{ urn: string; kind: 'track'; sourceId: string; addedAt: number }>> {
    return {
      items: this.saved.map((urn, index) => ({ urn, kind: 'track' as const, sourceId: 'demo', addedAt: index })),
      hasMore: false,
    }
  }
  async setSaved(urn: string, saved: boolean): Promise<void> {
    this.calls.push(`save:${urn}:${saved}`)
  }
  async isSaved(urn: string): Promise<boolean> {
    return this.saved.includes(urn)
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
  async playNow(urns: string[]): Promise<void> {
    this.calls.push(`playNow:${urns.join(',')}`)
  }
}

class SourcesStub extends Service {
  tracks: Track[] = [track]
  albums: { urn: string; title: string; artists: { urn: string; name: string; role: 'main'; ordinal: number }[]; trackCount?: number }[] = [
    { urn: ALBUM_URN, title: 'Homogenic', artists: [{ urn: 'a', name: 'Björk', role: 'main', ordinal: 0 }], trackCount: 1 },
  ]
  loved: Record<string, boolean> = {}

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getTracks(urns: readonly string[]): Promise<Track[]> {
    return this.tracks.filter((t) => urns.includes(t.urn))
  }
  async listTracks(): Promise<Paged<Track>> {
    return { items: this.tracks, hasMore: false }
  }
  async listAlbums() {
    return { items: this.albums, hasMore: false }
  }
  async getAlbum(urn: string) {
    return this.albums.find((a) => a.urn === urn)
  }
  async getArtist() {
    return undefined
  }
  async setLoved(urn: string, loved: boolean): Promise<void> {
    this.loved[urn] = loved
    const t = this.tracks.find((item) => item.urn === urn)
    if (t) t.loved = loved
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
  await root.plugin(DefaultI18nStub)
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

describe('LibraryScreen on mobile', () => {
  it('renders the playlists and creates a trimmed one through the create sheet', async () => {
    const { ctx, library } = await harness()
    const { container, getByTestId } = render(h(LibraryScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Road trip')
    expect(getByTestId('library-quick-library.favorites')).toBeTruthy()
    expect(getByTestId('library-quick-library.local')).toBeTruthy()

    // Header (⋯) → the combined sheet's playlist option → name + confirm.
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })
    await act(async () => {
      getByTestId('create-menu-playlist').click()
      await tick()
    })
    await act(async () => {
      type(getByTestId('create-playlist-name'), '  New mix  ')
      await tick()
    })
    await act(async () => {
      getByTestId('create-playlist-confirm').click()
      await tick()
    })

    expect(library.calls).toContain('create:New mix')
  })

  it('deletes through the row menu and opens by the playlist URN', async () => {
    const { ctx, library, ui } = await harness()
    const { container } = render(h(LibraryScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // The row's long press opens the shared playlist menu; its Delete item asks for
    // confirmation before it names the right URN.
    await act(async () => {
      const row = container.querySelector('[data-label="Road trip"]') as HTMLElement
      fireEvent.contextMenu(row)
      await tick()
    })
    await act(async () => {
      const del = Array.from(container.querySelectorAll('div')).find((d) => d.textContent === 'Delete')
      del?.click()
      await tick()
    })
    await act(async () => {
      getByTestIdHelper(container, 'confirm-delete-button').click()
      await tick()
    })

    expect(library.calls).toContain(`delete:${PLAYLIST_URN}`)

    await act(async () => {
      ;(container.querySelector('[data-label="Road trip"]') as HTMLElement).click()
      await tick()
    })
    expect(ui.calls).toContain(`library.playlist:{"urn":"${PLAYLIST_URN}"}`)
  })
})

/** A testID lookup that reads the host components' `data-testid` attribute. */
function getByTestIdHelper(container: HTMLElement, testID: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testID}"]`) as HTMLElement | null
  if (!el) throw new Error(`no element with testID ${testID}`)
  return el
}

describe('PlaylistDetailScreen on mobile', () => {
  it('plays a tapped track with the whole playlist as its context', async () => {
    const { ctx, player } = await harness()
    const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
    await act(async () => {
      await tick()
    })

    const row = container.querySelector('[data-host="Pressable"]') as HTMLElement | null
    expect(row, 'the track is on screen').toBeTruthy()
    await act(async () => {
      row!.click()
      await tick()
    })

    expect(player.calls[0]).toBe(`${TRACK} <- 2`)
  })

  it('removes the item, not every row that shares its track', async () => {
    const { ctx, library } = await harness()
    const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      const removes = container.querySelectorAll('[data-label="Remove Alpha from Road trip"]')
      expect(removes).toHaveLength(2)
      ;(removes[0] as HTMLElement).click()
      await tick()
    })

    expect(library.calls).toEqual([`remove:${PLAYLIST_URN}:item-1`])
  })

  it('draws no remove control for a smart playlist', async () => {
    const { ctx, library } = await harness()
    library.playlists = []
    const smart: PlaylistDetail = {
      ...storedPlaylist,
      isSmart: true,
      smart: { rules: { field: 'loved', cmp: 'eq', value: true } },
    }
    library.getPlaylist = async () => smart

    const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Smart playlist')
    expect(container.querySelectorAll('[data-label^="Remove"]')).toHaveLength(0)
  })

  it('renders header hero, plays all, and shuffles in PlaylistDetailScreen', async () => {
    const { ctx, player } = await harness()
    const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Road trip')

    // Play all via playlist-play
    await act(async () => {
      getByTestIdHelper(container, 'playlist-play').click()
      await tick()
    })
    expect(player.calls).toContain(`${TRACK} <- 2`)

    // Shuffle via playlist-shuffle
    await act(async () => {
      getByTestIdHelper(container, 'playlist-shuffle').click()
      await tick()
    })
    expect(player.calls.some((c) => c.startsWith('playNow:'))).toBe(true)
  })

  it('opens header menu on library/open-header-menu in PlaylistDetailScreen', async () => {
    const { ctx } = await harness()
    const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    expect(container.textContent).toContain('Batch operations')
    expect(container.textContent).toContain('Sort by')
  })

  it('supports batch mode in PlaylistDetailScreen', async () => {
    const { ctx, player } = await harness()
    const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
    await act(async () => {
      await tick()
    })

    // Open menu and enter batch mode
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    const batchMenuRow = Array.from(container.querySelectorAll('[data-label="Batch operations"]'))[0] as HTMLElement
    expect(batchMenuRow).toBeTruthy()
    await act(async () => {
      batchMenuRow.click()
      await tick()
    })

    expect(getByTestIdHelper(container, 'batch-select-all')).toBeTruthy()

    // Select all
    await act(async () => {
      getByTestIdHelper(container, 'batch-select-all').click()
      await tick()
    })

    // Batch play
    await act(async () => {
      getByTestIdHelper(container, 'batch-play-btn').click()
      await tick()
    })

    expect(player.calls).toContain(`playNow:${TRACK},${TRACK}`)
  })
})

describe('FavoritesScreen on mobile', () => {
  it('unsaves a row through the library service', async () => {
    const { ctx, library } = await harness()
    const { container } = render(h(FavoritesScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      ;(container.querySelector('[data-label="More"]') as HTMLElement).click()
      await tick()
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="remove-favorite"]') as HTMLElement).click()
      await tick()
    })

    expect(library.calls).toContain(`save:${TRACK}:false`)
  })

  it('renders header hero, plays all, and shuffles in FavoritesScreen', async () => {
    const { ctx, player } = await harness()
    const { container, getByTestId } = render(h(FavoritesScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Liked songs')
    expect(container.textContent).toContain('Saved music • 1 song')

    const playBtn = getByTestId('favorites-play')
    await act(async () => {
      playBtn.click()
      await tick()
    })

    expect(player.calls).toContain(`${TRACK} <- 1`)
  })

  it('supports batch mode in FavoritesScreen: select all, batch play, and batch delete', async () => {
    const { ctx, library, player } = await harness()
    const { container, getByTestId, queryByTestId } = render(h(FavoritesScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // Initially batch action bar is not rendered
    expect(queryByTestId('batch-action-bar')).toBeNull()

    // Open header menu via library/open-header-menu
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    // Click "Batch operations" in context menu
    const batchMenuRow = Array.from(container.querySelectorAll('[data-label="Batch operations"]'))[0] as HTMLElement
    expect(batchMenuRow).toBeTruthy()
    await act(async () => {
      batchMenuRow.click()
      await tick()
    })

    // Now batch action bar is visible
    expect(getByTestId('batch-action-bar')).toBeTruthy()

    // Toggle select all
    const selectAllBtn = getByTestId('batch-select-all')
    await act(async () => {
      selectAllBtn.click()
      await tick()
    })

    expect(getByTestId('batch-selected-count').textContent).toContain('1 / 1')

    // Batch play
    const batchPlayBtn = getByTestId('batch-play-btn')
    await act(async () => {
      batchPlayBtn.click()
      await tick()
    })

    expect(player.calls).toContain(`playNow:${TRACK}`)

    // Batch delete
    const batchDeleteBtn = getByTestId('batch-delete-btn')
    await act(async () => {
      batchDeleteBtn.click()
      await tick()
    })

    expect(library.calls).toContain(`save:${TRACK}:false`)

    // Exit batch
    const exitBtn = getByTestId('batch-exit-btn')
    await act(async () => {
      exitBtn.click()
      await tick()
    })

    expect(queryByTestId('batch-action-bar')).toBeNull()
  })
})

describe('CollectionScreen on mobile', () => {
  it('renders tracks, albums and playlists as folder members and plays collection tracks', async () => {
    const { ctx, ui, player } = await harness()
    const { container, getByTestId } = render(h(CollectionScreen, { ctx, id: COLLECTION_ID }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Alpha')
    expect(container.textContent).toContain('Homogenic')
    expect(container.textContent).toContain('Road trip')

    // Play all collection tracks
    const playBtn = getByTestId('collection-play')
    await act(async () => {
      playBtn.click()
      await tick()
    })

    expect(player.calls).toContain(`playNow:${TRACK}`)

    // Click album member
    await act(async () => {
      const album = Array.from(container.querySelectorAll('[data-label="Homogenic"]'))[0] as HTMLElement
      album.click()
      await tick()
    })
    expect(ui.calls).toContain(`album.view:${JSON.stringify({ urn: ALBUM_URN })}`)

    // Click playlist member
    await act(async () => {
      const pl = Array.from(container.querySelectorAll('[data-label="Road trip"]'))[0] as HTMLElement
      pl.click()
      await tick()
    })
    expect(ui.calls).toContain(`library.playlist:${JSON.stringify({ urn: PLAYLIST_URN })}`)
  })

  it('opens header menu and supports renaming in CollectionScreen', async () => {
    const { ctx } = await harness()
    const { container, getByTestId } = render(h(CollectionScreen, { ctx, id: COLLECTION_ID }))
    await act(async () => {
      await tick()
    })

    // Open header menu via library/open-header-menu
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    const renameOption = Array.from(container.querySelectorAll('[data-label="Rename"]'))[0] as HTMLElement
    expect(renameOption).toBeTruthy()
    await act(async () => {
      renameOption.click()
      await tick()
    })

    expect(getByTestId('collection-rename-input')).toBeTruthy()
  })
})

describe('LocalMusicScreen on mobile', () => {
  it('switches between songs, albums, and artists views', async () => {
    const { ctx } = await harness()
    const { container, getByTestId } = render(h(LocalMusicScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // Default is songs / tracks view
    expect(container.textContent).toContain('Local files')
    expect(container.textContent).toContain('Files from this computer • 1 songs')
    expect(getByTestId('local-tracks-list')).toBeTruthy()

    // Switch to Albums view
    const albumsTab = getByTestId('local-tab-albums')
    await act(async () => {
      albumsTab.click()
      await tick()
    })

    expect(container.textContent).toContain('Local albums')
    expect(container.textContent).toContain('Albums from this computer • 1 albums')
    expect(getByTestId('local-albums-container')).toBeTruthy()

    // Switch to Artists view
    const artistsTab = getByTestId('local-tab-artists')
    await act(async () => {
      artistsTab.click()
      await tick()
    })

    expect(container.textContent).toContain('Local artists')
    expect(getByTestId('local-artists-list')).toBeTruthy()
  })

  it('plays all local tracks and enters batch mode in songs view', async () => {
    const { ctx, player } = await harness()
    const { container, getByTestId } = render(h(LocalMusicScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // Play all
    const playBtn = getByTestId('local-music-play')
    await act(async () => {
      playBtn.click()
      await tick()
    })

    expect(player.calls).toContain(`playNow:${TRACK}`)

    // Open header menu via library/open-header-menu
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    // Click "Batch operations"
    const batchOption = Array.from(container.querySelectorAll('[data-label="Batch operations"]'))[0] as HTMLElement
    expect(batchOption).toBeTruthy()
    await act(async () => {
      batchOption.click()
      await tick()
    })

    expect(getByTestId('batch-action-bar')).toBeTruthy()
  })

  it('renders albums in albums view, plays album and navigates to album detail', async () => {
    const { ctx, ui, player } = await harness()
    const { getByTestId } = render(h(LocalMusicScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // Switch to Albums view
    const albumsTab = getByTestId('local-tab-albums')
    await act(async () => {
      albumsTab.click()
      await tick()
    })

    // Find album card
    const albumCard = getByTestId(`local-album-card-${ALBUM_URN}`)
    expect(albumCard).toBeTruthy()

    // Play album directly via overlay play button
    const playAlbumBtn = getByTestId(`local-album-play-${ALBUM_URN}`)
    await act(async () => {
      playAlbumBtn.click()
      await tick()
    })

    expect(player.calls).toContain(`playNow:${TRACK}`)

    // Click album card to navigate
    await act(async () => {
      albumCard.click()
      await tick()
    })

    expect(ui.calls).toContain(`album.view:${JSON.stringify({ urn: ALBUM_URN })}`)
  })

  it('renders artists in artists view, selects artist and plays artist tracks', async () => {
    const { ctx, player } = await harness()
    const { container, getByTestId } = render(h(LocalMusicScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // Switch to Artists view
    const artistsTab = getByTestId('local-tab-artists')
    await act(async () => {
      artistsTab.click()
      await tick()
    })

    // Artist row for 'A'
    const artistRow = getByTestId('local-artist-row-A')
    expect(artistRow).toBeTruthy()

    // Click artist to view artist tracks
    await act(async () => {
      artistRow.click()
      await tick()
    })

    expect(getByTestId('local-artist-tracks-list')).toBeTruthy()
    expect(container.textContent).toContain('Alpha')

    // Play artist tracks
    const playBtn = getByTestId('local-music-play')
    await act(async () => {
      playBtn.click()
      await tick()
    })

    expect(player.calls).toContain(`playNow:${TRACK}`)
  })

  it('navigates to scan settings via 3-dots header menu', async () => {
    const { ctx, ui } = await harness()
    const { container } = render(h(LocalMusicScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    const settingsBtn = Array.from(container.querySelectorAll('[data-label="Scan settings"]'))[0] as HTMLElement
    expect(settingsBtn).toBeTruthy()
    await act(async () => {
      settingsBtn.click()
      await tick()
    })

    expect(ui.calls).toContain(`settings.view:${JSON.stringify({ tab: 'sources' })}`)
  })
})

