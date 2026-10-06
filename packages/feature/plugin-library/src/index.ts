/**
 * `plugin-library` — `ctx.library`, the user's curation.
 *
 * Playlists, favourites and collections, over the tables docs/07 §4.6
 * declares. The service is deliberately thin: each verb delegates to a module
 * that owns one table group, and this file's whole job is to emit the events
 * the rest of the app invalidates on.
 *
 * It owns no catalogue rows. A smart playlist's rules are compiled to
 * parameterised SQL and run against the same `tracks`, `albums`,
 * `track_stats` and `media_bindings` rows `ctx.sources` maintains, which is
 * why this plugin injects `db` and never a provider: the catalogue is data,
 * and data is what a query needs (MD-3, docs/11 §1.3).
 *
 * Capabilities: `db:read:core` + `db:write:core` — it reads the catalogue and
 * writes the curation tables, and nothing else. No network, no filesystem.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { LibraryError, parseUrn } from '@BBeBee/protocol'
import type {
  Collection,
  CollectionItem,
  DbService,
  LibraryEntry,
  LibraryService,
  Paged,
  PageRequest,
  Playlist,
  PlaylistDetail,
  SavedKind,
  SmartPlaylist,
  UrnKind,
  UserProfile,
} from '@BBeBee/protocol'
import { Playlists } from './playlists.js'
import { Saved } from './saved.js'
import { Collections } from './collections.js'
import { Profile } from './profile.js'
import { LIBRARY_ROUTES, LIBRARY_VIEWS } from './views.js'

/**
 * The kind of a URN an event will name.
 *
 * `setSaved` validates the URN before it writes, so by the time this runs the
 * only malformed input is a URN a deletion was asked for; reporting it as a
 * `track` merely mislabels a no-op event.
 */
function kindOfUrn(urn: string): UrnKind {
  try {
    return parseUrn(urn).kind
  } catch {
    return 'track'
  }
}

export class Library extends Service implements LibraryService {
  static inject = ['db']

  /**
   * The plugin's own context, captured at construction.
   *
   * ⚠️ Not `this.ctx` at call time: inside a method reached through the
   * service proxy Cordis shadows `this.ctx` to the *caller's* context, and the
   * capability gate would then run against the caller's grants. See the note
   * in `plugin-player`.
   */
  private readonly ownCtx: Context
  private readonly ownDb: DbService
  private readonly playlists: Playlists
  private readonly saved: Saved
  private readonly collections: Collections
  private readonly profile: Profile

  constructor(ctx: Context) {
    super(ctx, 'library')
    this.ownCtx = ctx
    this.ownDb = ctx.db
    this.playlists = new Playlists(this.ownDb)
    this.saved = new Saved(this.ownDb)
    this.collections = new Collections(this.ownDb)
    this.profile = new Profile(this.ownDb)
  }

  async [Service.init]() {
    this.ownCtx.logger.debug('library: curation tables ready')

    // The local user: one row, created on first run (UUID id, name "Mine").
    await this.profile.ensure()

    // A fresh install opens with one playlist: an empty curation page reads as
    // "broken" less charitably than a starting point. The seed re-runs only
    // while the library holds no playlists at all.
    const existing = await this.playlists.list()
    if (existing.items.length === 0) {
      await this.createPlaylist('我的歌单')
    }

    // Descriptors, not components: the headless plugin says what exists and
    // where it belongs; whichever view package was loaded for this target
    // binds a component to the same id (docs/08 §2). The `ui` inject is a
    // child fiber, so unloading this plugin unloads the contributions with it.
    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'route',
          id: LIBRARY_ROUTES.home,
          path: '/library',
          title: 'Library',
          icon: 'library',
          placement: ['sidebar', 'tab-bar'],
          order: 0,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: LIBRARY_ROUTES.playlist,
          path: '/playlist/:urn',
          title: 'Playlist',
          // Reached from the playlists screen rather than from the chrome:
          // a tab for one playlist is a tab for every playlist. The empty
          // placement is deliberate — the desktop sidebar treats an *absent*
          // placement as `sidebar`, so omitting it would put a bare "Playlist"
          // entry beside the real one (docs/08 §3).
          placement: [],
          order: 0,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: LIBRARY_ROUTES.collection,
          path: '/collection/:id',
          title: 'Collection',
          // Reached from the library, like the playlist detail.
          placement: [],
          order: 0,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: LIBRARY_ROUTES.favorites,
          path: '/favorites',
          title: 'Favourites',
          icon: 'heart',
          // Reached from inside the library rather than standalone chrome
          placement: [],
          order: 31,
        })
        yield scoped.ui.contribute({
          kind: 'settings',
          id: LIBRARY_VIEWS.profileSettings,
          section: 'general',
          title: '用户资料',
          description: '本地用户资料，歌单等内容的创建者将显示此名称',
          icon: 'user',
          display: 'card',
          order: 10,
        })
      }, 'library-ui-contributions'),
    )
  }

  /* ── favourites ────────────────────────────────────────────────────── */

  isSaved(urn: string): Promise<boolean> {
    return this.saved.isSaved(urn)
  }

  async setSaved(urn: string, saved: boolean): Promise<void> {
    await this.saved.setSaved(urn, saved)
    this.ownCtx.logger.info(`library: ${saved ? 'saved' : 'unsaved'} ${urn}`)
    this.changed(kindOfUrn(urn), [urn])
  }

  listSaved(kind?: SavedKind, page?: PageRequest): Promise<Paged<LibraryEntry>> {
    return this.saved.list(kind, page)
  }

  async setPinned(urn: string, pinned: boolean): Promise<void> {
    await this.saved.setPinned(urn, pinned)
    this.ownCtx.logger.info(`library: ${pinned ? 'pinned' : 'unpinned'} ${urn}`)
    this.changed(kindOfUrn(urn), [urn])
  }

  /* ── playlists ─────────────────────────────────────────────────────── */

  listPlaylists(page?: PageRequest): Promise<Paged<Playlist>> {
    return this.playlists.list(page)
  }

  getPlaylist(urn: string, page?: PageRequest): Promise<PlaylistDetail | undefined> {
    return this.playlists.get(urn, page)
  }

  async createPlaylist(
    name: string,
    opts: { description?: string; smart?: SmartPlaylist } = {},
  ): Promise<Playlist> {
    const playlist = await this.playlists.create(name, opts)
    this.ownCtx.logger.info(`library: created playlist "${playlist.name}" (${playlist.urn})`)
    this.changed('playlist', [playlist.urn])
    return playlist
  }

  async updatePlaylist(
    urn: string,
    patch: { name?: string; description?: string | null; artworkUrl?: string | null },
  ): Promise<void> {
    await this.playlists.update(urn, patch)
    this.ownCtx.logger.info(`library: updated playlist ${urn}`)
    this.changed('playlist', [urn])
  }

  async deletePlaylist(urn: string): Promise<void> {
    await this.playlists.remove(urn)
    this.ownCtx.logger.info(`library: deleted playlist ${urn}`)
    this.changed('playlist', [urn])
  }

  async addTracks(
    urn: string,
    trackUrns: readonly string[],
    opts: { at?: number } = {},
  ): Promise<number> {
    const added = await this.playlists.addTracks(urn, trackUrns, opts)
    if (added > 0) {
      this.ownCtx.logger.info(`library: added ${added} track(s) to playlist ${urn}`)
      this.changed('playlist', [urn])
    }
    return added
  }

  async removeItems(urn: string, itemIds: readonly string[]): Promise<void> {
    await this.playlists.removeItems(urn, itemIds)
    this.ownCtx.logger.info(`library: removed ${itemIds.length} item(s) from playlist ${urn}`)
    this.changed('playlist', [urn])
  }

  async moveItem(urn: string, itemId: string, toIndex: number): Promise<void> {
    await this.playlists.moveItem(urn, itemId, toIndex)
    this.ownCtx.logger.info(`library: moved item ${itemId} in playlist ${urn} to index ${toIndex}`)
    this.changed('playlist', [urn])
  }

  async setSmartQuery(urn: string, query: SmartPlaylist): Promise<void> {
    await this.playlists.setSmartQuery(urn, query)
    this.ownCtx.logger.info(`library: updated smart query for playlist ${urn}`)
    this.changed('playlist', [urn])
  }

  /* ── collections ───────────────────────────────────────────────────── */

  listCollections(): Promise<readonly Collection[]> {
    return this.collections.list()
  }

  async createCollection(name: string, opts: { parentId?: string } = {}): Promise<Collection> {
    const collection = await this.collections.create(name, opts)
    this.ownCtx.logger.info(`library: created collection "${collection.name}" (${collection.id})`)
    this.collectionsChanged()
    return collection
  }

  async renameCollection(id: string, name: string): Promise<void> {
    await this.collections.rename(id, name)
    this.ownCtx.logger.info(`library: renamed collection ${id} to "${name}"`)
    this.collectionsChanged()
  }

  async moveCollection(id: string, parentId: string | null): Promise<void> {
    await this.collections.move(id, parentId)
    this.ownCtx.logger.info(`library: moved collection ${id} to parent ${parentId ?? 'root'}`)
    this.collectionsChanged()
  }

  async deleteCollection(id: string): Promise<void> {
    await this.collections.remove(id)
    this.ownCtx.logger.info(`library: deleted collection ${id}`)
    this.collectionsChanged()
  }

  listCollectionItems(id: string, page?: PageRequest): Promise<Paged<CollectionItem>> {
    return this.collections.items(id, page)
  }

  async addToCollection(id: string, urns: readonly string[]): Promise<number> {
    const added = await this.collections.add(id, urns)
    if (added > 0) {
      this.ownCtx.logger.info(`library: added ${added} item(s) to collection ${id}`)
      this.collectionsChanged()
    }
    return added
  }

  async removeFromCollection(id: string, urns: readonly string[]): Promise<void> {
    await this.collections.removeItems(id, urns)
    this.ownCtx.logger.info(`library: removed ${urns.length} item(s) from collection ${id}`)
    this.collectionsChanged()
  }

  /* ── profile ───────────────────────────────────────────────────────── */

  getProfile(): Promise<UserProfile> {
    return this.profile.ensure()
  }

  async updateProfile(patch: { name?: string }): Promise<UserProfile> {
    const name = patch.name?.trim()
    if (name !== undefined && name.length === 0) {
      throw new LibraryError('a profile name cannot be empty', 'invalid-name')
    }
    const updated = await this.profile.update(patch)
    this.ownCtx.logger.info(`library: profile is now "${updated.name}" (${updated.id})`)
    this.ownCtx.emit('library/profile-changed')
    return updated
  }

  /* ── events ────────────────────────────────────────────────────────── */

  /**
   * Tell the app one entity's curation state changed.
   *
   * A listener that throws must not take the write down with it — the row is
   * already committed, and `emit` dispatches synchronously straight out of
   * this call.
   */
  private changed(kind: UrnKind, urns: string[]): void {
    try {
      this.ownCtx.emit('library/changed', kind, urns)
    } catch (error) {
      this.ownCtx.logger.warn(`library: a library/changed listener threw: ${String(error)}`)
    }
  }

  private collectionsChanged(): void {
    try {
      this.ownCtx.emit('library/collections-changed')
    } catch (error) {
      this.ownCtx.logger.warn(`library: a library/collections-changed listener threw: ${String(error)}`)
    }
  }
}

export { LibraryError }

export const name = 'plugin-library'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before the
 * service inside is usable.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-library: loaded')
  const fiber = await ctx.plugin(Library)
  return () => void fiber.dispose()
}

export default { name, apply }
