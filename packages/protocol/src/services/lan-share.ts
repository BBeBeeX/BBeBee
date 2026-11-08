/**
 * `ctx.lanShare` — LocalSend-style song transfer over the local network.
 *
 * A Layer 4 feature contract: discovery of BBeBee peers, session-based file
 * transfer between them, and ingestion of received files into the library.
 * The transport underneath is `ctx.lan` (see `./lan.js`); everything that
 * speaks the BBeBee-LAN wire protocol lives in the feature plugin, so a new
 * platform transport never has to re-implement it.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'

/* ── peers ──────────────────────────────────────────────────────────────── */

/** A BBeBee device seen on the local network. */
export interface LanSharePeer {
  /** Stable per-install device id (random, persisted once). */
  id: string
  /** User-facing device name from settings. */
  name: string
  /** Platform string of the peer, e.g. `desktop`. */
  platform: string
  /** Last known address. */
  host: string
  /** The peer's HTTP port for the transfer API. */
  httpPort: number
  /** Epoch ms of the most recent announce. */
  lastSeen: number
}

/* ── transfers ──────────────────────────────────────────────────────────── */

export interface LanShareTransferItem {
  id: string
  fileName: string
  sizeBytes: number
  /** Bytes transferred so far; undefined before the file starts moving. */
  transferredBytes?: number
}

export type LanShareTransferState =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface LanShareTransfer {
  /** Session id, minted by the sender and used on the wire. */
  id: string
  direction: 'send' | 'receive'
  peer: { id: string; name: string }
  state: LanShareTransferState
  items: LanShareTransferItem[]
  error?: string
  startedAt: number
}

/* ── incoming prompt ────────────────────────────────────────────────────── */

/**
 * An offer from a peer waiting for the user's answer.
 *
 * Delivered through the `lan-share/incoming` event; the UI renders a prompt
 * and calls exactly one of `accept` / `decline`. If nobody answers before the
 * sender's timeout, the session dies on the sender side — the prompt never
 * blocks the service.
 */
export interface LanShareIncomingRequest {
  id: string
  peer: { id: string; name: string; host: string }
  items: Array<{ id: string; fileName: string; sizeBytes: number }>
  accept(): void
  decline(): void
}

/* ── settings ───────────────────────────────────────────────────────────── */

export interface LanShareSettings {
  /** Name announced to peers. */
  deviceName: string
  /** Accept incoming offers without prompting. */
  autoAccept: boolean
  /** Whether this device announces itself and shows in peer lists. */
  discovery: boolean
}

/* ── ctx.lanShare ───────────────────────────────────────────────────────── */

export interface LanShareService {
  readonly peers: readonly LanSharePeer[]
  readonly transfers: readonly LanShareTransfer[]
  readonly settings: LanShareSettings

  /** Send an announce immediately (e.g. when the screen opens). */
  refresh(): void

  /**
   * Offer the given library tracks to a peer. Resolves when the whole
   * transfer completes or fails; the returned transfer is the final record.
   * Progress along the way is tracked in `transfers` (and the
   * `lan-share/transfers-changed` event).
   */
  sendTo(peerId: string, trackUrns: readonly string[]): Promise<LanShareTransfer>

  cancelTransfer(transferId: string): Promise<void>

  updateSettings(patch: Partial<LanShareSettings>): Promise<void>
}

declare module 'cordis' {
  interface Context {
    lanShare: LanShareService
  }
}
