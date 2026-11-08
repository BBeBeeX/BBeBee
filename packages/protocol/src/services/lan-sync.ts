/**
 * `ctx.lanSync` — listen-together over the local network.
 *
 * One device (the leader) plays normally; every other device (a follower)
 * mirrors the leader's transport within a bounded drift window. This is a
 * Layer 4 feature contract: the transport underneath is `ctx.lan` (see
 * `./lan.js`), and the whole BBeBee-LAN-Sync wire protocol lives in the
 * feature plugin so a platform swap never re-implements it.
 *
 * The two playback answers the feature exists for:
 *   - Local music streams as network audio: the leader registers the file
 *     behind the resolved handle under an unguessable token and serves it
 *     with Range/206 through `ctx.lan`'s HTTP server, so the follower's own
 *     engine (mpv) seeks like it would against any web server.
 *   - Third-party source music travels as the *final resolved stream URL*
 *     (plus headers and `expiresAt`): the follower loads that URL directly
 *     and no audio bytes transit the leader.
 *
 * Delivery is pull-based long-poll (`GET /state?since=<version>`), so a
 * leader needs no knowledge of its followers' addresses and a follower needs
 * no HTTP server of its own — the same code path serves every platform.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { PlaybackStatus, RepeatMode } from '../entities/playback.js'

/* ── discovery ──────────────────────────────────────────────────────────── */

/** A device currently announcing itself as a listen-together participant. */
export interface SyncLeaderInfo {
  /** Stable per-install device id (random, persisted once). */
  id: string
  /** User-facing device name from settings. */
  name: string
  /** Platform string of the peer, e.g. `desktop`. */
  platform: string
  /** Last known address (from the announce datagram's sender). */
  host: string
  /** The peer's HTTP port for the sync API. */
  httpPort: number
  /** Epoch ms of the most recent announce. */
  lastSeen: number
}

/* ── wire snapshot (also the UI's mirror state) ─────────────────────────── */

/** Track metadata as it crosses the wire — self-contained, no library rows. */
export interface SyncTrackMeta {
  urn: string
  title: string
  artist?: string
  album?: string
  durationMs?: number
  /**
   * Artwork location. An absolute `http(s)://` URL, or a leader-relative path
   * (starts with `/`) to resolve against `http://<leaderHost>:<httpPort>` —
   * the leader cannot know its own LAN address, so it emits paths for files
   * it serves itself and absolute URLs for remote artwork.
   */
  artworkUrl?: string
}

/**
 * How the follower obtains audio for the current track.
 *
 * `direct` hands the follower the leader's own resolved third-party URL.
 * `serve` points at the leader's token endpoint for a local file — `path` is
 * resolved against the leader's `http://<host>:<httpPort>` base.
 */
export type SyncStreamDescriptor =
  | {
      mode: 'direct'
      url: string
      /** May contain credentials — never logged. */
      headers?: Record<string, string>
      mimeType?: string
      byteLength?: number
      /** Epoch ms; the follower re-polls state before this. */
      expiresAt?: number
      seekable: boolean
    }
  | {
      mode: 'serve'
      /** Path under the sync API, e.g. `/api/bbebee-lan-sync/v1/stream/<token>`. */
      path: string
      mimeType?: string
      byteLength?: number
    }

/**
 * The leader's published transport state — everything a follower needs to
 * mirror playback. `version` is monotonic; a long-poll returns as soon as it
 * moves past the follower's `since`.
 */
export interface SyncSnapshot {
  v: 1
  leaderId: string
  leaderName: string
  platform: string
  version: number
  /** Leader clock at build time; the follower derives its offset from this. */
  serverTimeMs: number
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  track?: SyncTrackMeta
  stream?: SyncStreamDescriptor
  /** The upcoming queue, leader-enriched with titles. */
  queue?: SyncTrackMeta[]
  repeat: RepeatMode
  shuffle: boolean
}

/* ── commands ───────────────────────────────────────────────────────────── */

/** Follower → leader control. The leader maps this onto `ctx.player`. */
export interface SyncCommand {
  action: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek'
  /** Only meaningful with `seek`. */
  positionMs?: number
}

/* ── session ────────────────────────────────────────────────────────────── */

export type SyncRole = 'none' | 'follower'

/** A device currently following this one (only meaningful on the leader). */
export interface SyncFollowerInfo {
  sessionId: string
  name: string
  platform: string
  /** Epoch ms of the follower's most recent poll or command. */
  lastSeen: number
}

/** The local session state the UI renders. */
export interface SyncSessionState {
  role: SyncRole
  /** Set when `role === 'follower'`. */
  leader?: { id: string; name: string; host: string; httpPort: number }
  /** The latest snapshot while following (the mirrored transport). */
  snapshot?: SyncSnapshot
  /** Who is currently following this device (always available — serving is passive). */
  followers: readonly SyncFollowerInfo[]
}

/* ── settings ───────────────────────────────────────────────────────────── */

export interface LanSyncSettings {
  /** Name announced to peers. */
  deviceName: string
  /** Whether this device announces itself and appears in leader lists. */
  discovery: boolean
}

/* ── ctx.lanSync ────────────────────────────────────────────────────────── */

export interface LanSyncService {
  /** Discovered leaders, most recent announce first. */
  readonly leaders: readonly SyncLeaderInfo[]
  readonly session: SyncSessionState
  readonly settings: LanSyncSettings

  /** Send an announce immediately (e.g. when the screen opens). */
  refresh(): void

  /** Join a discovered leader. Resolves once the first snapshot is mirrored. */
  joinLeader(leaderId: string): Promise<void>

  /** Join by explicit address — the fallback when discovery is blocked. */
  connectByAddress(host: string, port: number): Promise<void>

  /** Leave the current session (no-op when not following). */
  leave(): Promise<void>

  /** Send a control command to the leader while following. */
  sendCommand(command: SyncCommand): Promise<void>

  /**
   * The leader's position *right now*, interpolated from the last snapshot
   * and the learned clock offset — the honest value for a progress bar
   * between polls. Undefined when not following.
   */
  mirrorPositionNow(): number | undefined

  updateSettings(patch: Partial<LanSyncSettings>): Promise<void>
}

declare module 'cordis' {
  interface Context {
    lanSync: LanSyncService
  }
}
