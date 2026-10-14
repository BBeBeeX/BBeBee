/**
 * `ctx.downloads` — the managed download queue.
 *
 * A download is a row in `download_tasks` (docs/07 §4.8) driven by one worker:
 * queued → running → done, with `paused`, `canceled` and `failed` as the
 * states a user or a network can put it in. What lands on disk is a
 * `media_bindings` row exactly like a scanned file's, so the player already
 * knows how to play it and `plugin-download`'s `player/before-resolve`
 * substitution needs no download concept at all.
 *
 * The service is deliberately small: state, the six verbs that move it, and
 * events. Progress is *emitted* per chunk, not stored per chunk — the row is
 * checkpointed so a kill resumes from near where it stopped, but the byte
 * counter a screen renders is the in-memory one.
 *
 * See docs/05 §2, docs/07 §4.8.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { ArtistCredit, ArtworkRef, Track } from '../entities/catalog.js'
import type { StreamQuality } from '../entities/media.js'

export type DownloadState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'

/** Why a queued task is not running yet. `undefined` means "nothing holding it". */
export type DownloadHold = 'wifi' | 'charging'

/**
 * Rich metadata for an enqueued track.
 * Passing this avoids lossy secondary lookups when music sources have varying schemas.
 */
export interface DownloadTrackMeta {
  urn: string
  title?: string
  artist?: string
  artists?: readonly ArtistCredit[] | readonly { name: string; role?: string; urn?: string }[]
  albumTitle?: string
  albumUrn?: string
  year?: number
  trackNo?: number
  artwork?: ArtworkRef | { id?: string; sourceUrl?: string }
  artworkUrl?: string
  artworkLocalUri?: string
  raw?: unknown
}

export type EnqueueItem = string | Track | DownloadTrackMeta

/**
 * The download policy, as the queue reads it.
 *
 * One row in `download_policies` (docs/07 §4.8) governs both the playback
 * cache and explicit downloads. `enabled: false` ignores the constraints; the
 * master switch for transfers at all is the plugin's own config.
 */
export interface DownloadPolicy {
  id: string
  name: string
  enabled: boolean
  /** Hold transfers on a metered connection. */
  wifiOnly: boolean
  /**
   * Hold transfers while the battery is not charging.
   *
   * A platform that reports no battery (a desktop, a test) never holds: the
   * constraint is about conserving a battery, and "unknown" is not "drained".
   */
  chargingOnly: boolean
  /** Quality asked of the source when the task does not name one. */
  quality: StreamQuality
}

/** One download, as a screen renders it. */
export interface DownloadTask {
  id: string
  trackUrn: string
  /**
   * The catalogue's display name, resolved at read time.
   *
   * Carried here so a downloads screen does not need a second query per row —
   * and so it can still show *something* for a track whose source has since
   * been removed, which is the state a stale download is in.
   */
  title: string
  artist?: string
  state: DownloadState
  quality?: StreamQuality
  bytesDone: number
  /** Absent when the server sent no length; a progress bar then has no maximum. */
  bytesTotal?: number
  /** The reason a task is `failed`, kept so the screen can say it. */
  error?: string
  /** Set once a `media_bindings` row exists for this download. */
  bindingId?: string
  /**
   * True for a user-requested download, which lives in the (kept) downloads
   * directory and is never evicted. False for the playback cache, which is
   * evictable and rebuilt on the next play.
   */
  kept: boolean
  /** Present while the policy is holding the task. See {@link DownloadHold}. */
  blocked?: DownloadHold
  createdAt: number
  updatedAt: number
  /** Epoch ms of the terminal transition, when there was one. */
  finishedAt?: number
}

export interface DownloadsService {
  /** Every task, active first, newest first within a state. */
  readonly tasks: readonly DownloadTask[]
  task(id: string): DownloadTask | undefined

  /** The policy the queue applies to every task. */
  readonly policy: DownloadPolicy
  setPolicy(
    patch: Partial<Pick<DownloadPolicy, 'enabled' | 'wifiOnly' | 'chargingOnly'>>,
  ): Promise<void>

  /**
   * Queue explicit downloads.
   *
   * Accepts either track URN strings, complete `Track` entities, or `DownloadTrackMeta` objects.
   * Passing track metadata preserves artist, title, album and artwork information directly from the UI.
   *
   * A track already queued, running or paused is returned as-is rather than
   * duplicated — `download_tasks` enforces one active task per track, and
   * "download" pressed twice means the same thing twice (docs/07 §4.8).
   */
  enqueue(
    items: readonly EnqueueItem[],
    opts?: { quality?: StreamQuality },
  ): Promise<readonly DownloadTask[]>

  /** Stop a queued or running download; its bytes are kept for `resume`. */
  pause(id: string): Promise<void>
  /** Continue a paused download from `bytesDone`. */
  resume(id: string): Promise<void>
  /** Queue a failed download again, keeping whatever bytes landed. */
  retry(id: string): Promise<void>
  /** Abandon a download and remove its partial file. */
  cancel(id: string): Promise<void>
  /**
   * Forget a download.
   *
   * A finished download's binding and file go with it: the row *is* what "this
   * track is downloaded" means, and leaving the file behind would make the
   * next play cache it again while the screen said it was deleted.
   */
  remove(id: string): Promise<void>
  /**
   * Drop finished cache entries and canceled tasks.
   *
   * Kept downloads are untouched: they are the files the user asked for, and
   * `remove` is the only thing that deletes one.
   */
  clearFinished(): Promise<void>
}

declare module 'cordis' {
  interface Context {
    downloads: DownloadsService
  }
}
