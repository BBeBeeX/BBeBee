import { useCallback } from 'react'
import type { Context } from 'cordis'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  Collection,
  DownloadsService,
  LibraryService,
  PlayerService,
  Playlist,
  ShareService,
  SleepTimerService,
  SourcesService,
  Track,
  UiService,
} from '@BBeBee/protocol'
import { addToPlaylistSubmenu } from '../submenus/playlistSubmenu.js'
import { sleepTimerSubmenu } from '../submenus/sleepTimerSubmenu.js'
import { useMenuState, type MenuController } from '../types.js'
import { openExternalUrl, resolveOriginalResourceUrl } from '../utils/resourceUrls.js'
import { menuTranslate } from '../utils/i18n.js'

export interface TrackMenuTarget {
  track: Track
  /**
   * The row's id inside the playlist it is shown in, when it is shown in one.
   * Its presence is what makes "remove from this playlist" offerable.
   */
  playlistItemId?: string
  /**
   * The row's id inside the queue, when shown in the queue.
   * Its presence makes "remove from queue" offerable.
   */
  queueItemId?: string
  /**
   * The history record id or track urn, when shown in history.
   * Its presence makes "remove from history" offerable.
   */
  historyRecordId?: string
}

export interface TrackMenuOptions {
  /** Set by a playlist detail screen; absent everywhere else. */
  fromPlaylistUrn?: string
  /** Resolved by the hook when the menu opens. */
  playlists?: readonly Playlist[]
  /** Same, for the "add to collection" submenu. */
  collections?: readonly Collection[]
  /** Set when used in a history list. */
  isHistory?: boolean
  /**
   * The lyric text of the track, when the calling screen already has it on
   * screen; its presence (with the share service) makes "Share lyrics" offerable.
   * The model never fetches lyrics itself.
   */
  lyrics?: { lines: readonly string[] }
  /**
   * Called to display technical playback metadata & file/source details.
   */
  onShowTrackInfo?: (track: Track) => void
}

/**
 * Every action a track row offers, in the order the menu shows them.
 *
 * Exported and pure of React so the model is testable without a renderer —
 * the same reason `plugin-library`'s smart compiler is a separate file.
 */
export function trackMenuItems(
  ctx: Context,
  target: TrackMenuTarget,
  opts: TrackMenuOptions = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const ui = serviceOf<UiService>(ctx, 'ui')
  const track = target.track ?? (target as unknown as Track)
  if (!track) return []
  const items: MenuItemSpec[] = []

  const submenu = addToPlaylistSubmenu(library, [track.urn], opts.playlists ?? [], { ctx })
  if (submenu) items.push({ id: 'add-to-playlist', label: menuTranslate(ctx, 'app:common.menu.addToPlaylist', 'Add to playlist'), icon: 'plus', submenu })

  if (library && opts.fromPlaylistUrn && target.playlistItemId) {
    const playlistUrn = opts.fromPlaylistUrn
    const itemId = target.playlistItemId
    items.push({
      id: 'remove-from-playlist',
      label: menuTranslate(ctx, 'app:common.menu.removeFromPlaylist', 'Remove from this playlist'),
      icon: 'minus',
      tone: 'danger',
      onSelect: () => library.removeItems(playlistUrn, [itemId]),
    })
  }

  if (player && target.queueItemId) {
    const queueItemId = target.queueItemId
    items.push({
      id: 'remove-from-queue',
      label: menuTranslate(ctx, 'app:common.menu.removeFromQueue', 'Remove from queue'),
      icon: 'trash',
      tone: 'danger',
      onSelect: () => player.removeItems([queueItemId]),
    })
  }

  if (player && (target.historyRecordId || opts.isHistory)) {
    const historyTarget = target.historyRecordId ?? track.urn
    items.push({
      id: 'remove-from-history',
      label: menuTranslate(ctx, 'app:common.menu.removeFromHistory', 'Remove from history'),
      icon: 'trash',
      tone: 'danger',
      onSelect: () => void player.removeHistory?.(historyTarget),
    })
  }

  if (track.loved) {
    items.push({
      id: 'remove-favorite',
      label: menuTranslate(ctx, 'app:common.menu.removeFromFavorites', 'Remove from Favorites'),
      icon: 'heart',
      tone: 'danger',
      onSelect: async () => {
        await sources?.setLoved(track.urn, false)
        await library?.setSaved(track.urn, false)
      },
    })
  } else if (sources || library) {
    items.push({
      id: 'add-favorite',
      label: menuTranslate(ctx, 'app:common.menu.addToFavorites', 'Add to Favorites'),
      icon: 'heart-filled',
      onSelect: async () => {
        await sources?.setLoved(track.urn, true)
        await library?.setSaved(track.urn, true)
      },
    })
  }

  if (player) {
    items.push({
      id: 'enqueue',
      label: menuTranslate(ctx, 'app:common.menu.addToPlayQueue', 'Add to play queue'),
      icon: 'playlist-add',
      onSelect: () => player.enqueueLast([track.urn]),
    })
  }

  if (downloads) {
    items.push({
      id: 'download',
      label: menuTranslate(ctx, 'app:common.menu.download', 'Download'),
      icon: 'download',
      onSelect: () => void downloads.enqueue([track]),
    })
  }

  const share = serviceOf<ShareService>(ctx, 'share')
  if (share) {
    items.push({
      id: 'share-track',
      label: menuTranslate(ctx, 'app:common.menu.shareSong', 'Share song'),
      icon: 'share',
      onSelect: () => share.shareTrack(track),
    })

    const lyricLines = opts.lyrics?.lines ?? []
    if (lyricLines.length > 0) {
      const lines = [...lyricLines]
      items.push({
        id: 'share-lyrics',
        label: menuTranslate(ctx, 'app:common.menu.shareLyrics', 'Share lyrics'),
        icon: 'share',
        onSelect: () => share.shareLyrics(track, lines),
      })
    }
  }

  const sleepTimer = serviceOf<SleepTimerService>(ctx, 'sleepTimer')
  const sleepSubmenu = sleepTimerSubmenu(sleepTimer, ctx)
  if (sleepSubmenu) {
    items.push({
      id: 'sleep-timer',
      label: sleepTimer?.state.active
        ? menuTranslate(ctx, 'app:common.menu.sleepTimerOn', 'sleep timer (on)')
        : menuTranslate(ctx, 'app:common.menu.sleepTimer', 'sleep timer'),
      icon: 'clock',
      submenu: sleepSubmenu,
    })
  }

  if (ui && track.albumUrn) {
    const albumUrn = track.albumUrn
    items.push({
      id: 'go-to-album',
      label: menuTranslate(ctx, 'app:common.menu.goToAlbum', 'Go to album'),
      icon: 'disc',
      // 'album.view' is plugin-album's view descriptor id — serialized data,
      // so the menu model carries the literal rather than importing the
      // contributing plugin's constant.
      onSelect: () => ui.navigate('album.view', { urn: albumUrn }),
    })
  }

  if (opts.onShowTrackInfo) {
    items.push({
      id: 'track-info',
      label: menuTranslate(ctx, 'app:common.menu.seeWhatsPlaying', "See what's playing"),
      icon: 'info-circle',
      onSelect: () => opts.onShowTrackInfo!(track),
    })
  }

  const originalUrl = resolveOriginalResourceUrl({ track, kind: 'track' })
  if (originalUrl) {
    items.push({
      id: 'open-original-resource',
      label: menuTranslate(ctx, 'app:common.menu.openOriginalResource', 'Open original resource'),
      icon: 'share-box',
      onSelect: () => openExternalUrl(originalUrl),
    })
  }

  return items
}

export interface TrackMenuController extends MenuController {
  open(target: TrackMenuTarget, anchor?: MenuAnchor): void
}

/** A track row's menu. `opts.fromPlaylistUrn` makes "remove from this playlist" appear. */
export function useTrackMenu(ctx: Context, opts: TrackMenuOptions = {}): TrackMenuController {
  const state = useMenuState<TrackMenuTarget>()
  const open = useCallback(
    (target: TrackMenuTarget, anchor?: MenuAnchor) => state.show(target, anchor, ctx),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open
        ? trackMenuItems(ctx, state.open.target, {
            ...opts,
            playlists: state.playlists,
            collections: state.collections,
          })
        : [],
      ...(state.open
        ? {
            title:
              state.open.target.track?.title ??
              (state.open.target as unknown as Track)?.title ??
              '',
          }
        : {}),
    },
  }
}
