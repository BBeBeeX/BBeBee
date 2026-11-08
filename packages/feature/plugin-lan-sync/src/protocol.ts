/**
 * The BBeBee-LAN-Sync wire protocol, v1 — pure encode/parse, no I/O.
 *
 * Four shapes cross the wire, all JSON:
 *
 *   - a UDP announce datagram, for discovery
 *   - the sync snapshot (the leader's published transport state)
 *   - a join/leave/command envelope
 *   - URL paths for the stream/artwork endpoints
 *
 * Everything a peer sends is *data from a stranger*, so every parser here
 * validates shape and refuses the rest — a malformed snapshot is dropped, a
 * malformed command answers 400, and a path that does not match the grammar
 * exactly answers 404.
 *
 * The announce shares the well-known UDP port and multicast group with the
 * transfer feature (`plugin-lan-share`), but carries `app: 'bbebee-sync'`:
 * each side's parser refuses the other's datagrams at the `app` check, so
 * the two features coexist on one socket without knowing about each other.
 *
 * Small helpers (`isId`, `randomId`) are duplicated from `plugin-lan-share`:
 * Layer 4 packages reach each other through ctx services and events, not
 * imports, and these twenty lines are the whole overlap.
 */

/* ── constants ──────────────────────────────────────────────────────────── */

export const LAN_SYNC_PROTOCOL_VERSION = 1
/** Distinct from the transfer feature's `bbebee` — the two share a socket. */
export const LAN_SYNC_APP_ID = 'bbebee-sync'

/**
 * Same ports as `plugin-lan-share` on purpose: one socket, one number to put
 * on a sticker. `ctx.lan.start` is idempotent, so whichever plugin loads
 * first binds and the second reuses it.
 */
export const LAN_SYNC_UDP_PORT = 53318
export const LAN_SYNC_HTTP_PORT = 53318
/** Site-local multicast group, same range as the transfer feature. */
export const LAN_SYNC_MULTICAST_GROUP = '239.255.42.98'

export const API_BASE = '/api/bbebee-lan-sync/v1'
export const ANNOUNCE_INTERVAL_MS = 3_000
/** A leader not heard from for this long drops off the discovery list. */
export const PEER_TTL_MS = 10_000
/** A follower silent for this long is dropped from the leader's roster. */
export const FOLLOWER_TTL_MS = 15_000
/**
 * How long a `/state` long-poll is held before answering with the current
 * snapshot anyway. Doubles as the drift-correction cycle: a follower hears
 * from its leader at least this often, so playback-clock divergence is
 * caught within ten seconds even when nobody touches anything. Must stay
 * under the transport's 30 s unanswered-request timeout, with margin for the
 * reply to cross the bridge.
 */
export const LONG_POLL_MS = 10_000
/** The follower's own request timeout — past the hold, plus margin. */
export const POLL_TIMEOUT_MS = 15_000
/** Consecutive silence beyond this and the follower declares the session lost. */
export const SESSION_LOST_MS = 15_000
/** Position disagreement beyond this triggers a seek correction. */
export const DRIFT_THRESHOLD_MS = 350
/** Stream and artwork registrations die unused after this long. */
export const STREAM_TTL_MS = 10 * 60_000

/* ── announce ───────────────────────────────────────────────────────────── */

export interface AnnounceMessage {
  v: number
  app: string
  id: string
  name: string
  platform: string
  httpPort: number
  ts: number
  bye?: boolean
}

export function encodeAnnounce(msg: AnnounceMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg))
}

export function decodeAnnounce(raw: Uint8Array): AnnounceMessage | undefined {
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    if (data['v'] !== LAN_SYNC_PROTOCOL_VERSION) return undefined
    if (data['app'] !== LAN_SYNC_APP_ID) return undefined
    if (typeof data['id'] !== 'string' || !isId(data['id'])) return undefined
    if (data['bye'] === true) {
      // A leave datagram only needs to identify the sender.
      return {
        v: LAN_SYNC_PROTOCOL_VERSION,
        app: LAN_SYNC_APP_ID,
        id: data['id'],
        name: '',
        platform: '',
        httpPort: 0,
        ts: Date.now(),
        bye: true,
      }
    }
    if (typeof data['name'] !== 'string' || data['name'].length === 0 || data['name'].length > 64) {
      return undefined
    }
    if (typeof data['platform'] !== 'string') return undefined
    if (
      typeof data['httpPort'] !== 'number' ||
      !Number.isInteger(data['httpPort']) ||
      data['httpPort'] <= 0 ||
      data['httpPort'] > 65_535
    ) {
      return undefined
    }
    return {
      v: LAN_SYNC_PROTOCOL_VERSION,
      app: LAN_SYNC_APP_ID,
      id: data['id'],
      name: data['name'],
      platform: data['platform'],
      httpPort: data['httpPort'],
      ts: typeof data['ts'] === 'number' ? data['ts'] : Date.now(),
    }
  } catch {
    return undefined
  }
}

/* ── paths ──────────────────────────────────────────────────────────────── */

/**
 * The minted id format: UUID-shaped or a prefixed token. Everything a path
 * interpolates must match this — it is the traversal guard for the URL
 * grammar below.
 */
export function isId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(value)
}

export function infoPath(): string {
  return `${API_BASE}/info`
}

export function joinPath(): string {
  return `${API_BASE}/join`
}

export function leavePath(): string {
  return `${API_BASE}/leave`
}

export function statePath(since?: number): string {
  return since === undefined ? `${API_BASE}/state` : `${API_BASE}/state?since=${Math.max(0, Math.floor(since))}`
}

export function commandPath(): string {
  return `${API_BASE}/command`
}

export function streamPath(token: string): string {
  if (!isId(token)) throw new Error('stream: invalid token')
  return `${API_BASE}/stream/${token}`
}

/** Artwork is addressed by the track URN it belongs to — never by a raw path. */
export function artworkPath(trackUrn: string): string {
  return `${API_BASE}/artwork/${encodeURIComponent(trackUrn)}`
}

const STREAM_RE = new RegExp(`^${API_BASE}/stream/([A-Za-z0-9][A-Za-z0-9-]{7,63})$`)
const ARTWORK_RE = new RegExp(`^${API_BASE}/artwork/([^/]+)$`)

export function parseStreamPath(path: string): string | undefined {
  const m = STREAM_RE.exec(path)
  return m ? m[1]! : undefined
}

export function parseArtworkPath(path: string): string | undefined {
  const m = ARTWORK_RE.exec(path)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return undefined
  }
}

/* ── join / leave / command ─────────────────────────────────────────────── */

export interface JoinRequest {
  id: string
  name: string
  platform: string
}

export interface JoinReply {
  sessionId: string
  snapshot: SyncSnapshotWire
}

export function encodeJoin(req: JoinRequest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(req))
}

export function decodeJoinReply(raw: Uint8Array): JoinReply | undefined {
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    if (typeof data['sessionId'] !== 'string' || !isId(data['sessionId'])) return undefined
    if (!data['snapshot'] || typeof data['snapshot'] !== 'object') return undefined
    const snapshot = parseSnapshot(data['snapshot'] as Record<string, unknown>)
    if (!snapshot) return undefined
    return { sessionId: data['sessionId'], snapshot }
  } catch {
    return undefined
  }
}

export function encodeLeave(sessionId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ sessionId }))
}

export function decodeLeave(raw: Uint8Array): string | undefined {
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    return typeof data['sessionId'] === 'string' && isId(data['sessionId']) ? data['sessionId'] : undefined
  } catch {
    return undefined
  }
}

export interface CommandRequest extends CommandWire {
  sessionId: string
}

/**
 * The wire form of a control command — structurally the same shape as the
 * protocol-level `SyncCommand`, re-declared here so the wire module stays
 * independent of the contract module's import graph.
 */
export interface CommandWire {
  action: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek'
  positionMs?: number
}

export function encodeCommand(cmd: CommandRequest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(cmd))
}

export function decodeCommand(raw: Uint8Array): CommandRequest | undefined {
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    if (typeof data['sessionId'] !== 'string' || !isId(data['sessionId'])) return undefined
    const action = data['action']
    if (action !== 'play' && action !== 'pause' && action !== 'toggle' && action !== 'next' && action !== 'previous' && action !== 'seek') {
      return undefined
    }
    const positionMs = data['positionMs']
    if (positionMs !== undefined && (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0)) {
      return undefined
    }
    return {
      sessionId: data['sessionId'],
      action,
      ...(typeof positionMs === 'number' ? { positionMs } : {}),
    }
  } catch {
    return undefined
  }
}

/* ── snapshot ───────────────────────────────────────────────────────────── */

/**
 * The wire form of a `SyncSnapshot`. Structurally identical to the contract
 * type; declared separately so the wire codec validates every field it
 * accepts and never trusts the peer's JSON shape.
 */
export interface SyncSnapshotWire {
  v: 1
  leaderId: string
  leaderName: string
  platform: string
  version: number
  serverTimeMs: number
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'stalled' | 'error'
  positionMs: number
  durationMs: number
  track?: {
    urn: string
    title: string
    artist?: string
    album?: string
    durationMs?: number
    artworkUrl?: string
  }
  stream?:
    | {
        mode: 'direct'
        url: string
        headers?: Record<string, string>
        mimeType?: string
        byteLength?: number
        expiresAt?: number
        seekable: boolean
      }
    | { mode: 'serve'; path: string; mimeType?: string; byteLength?: number }
  queue?: Array<{ urn: string; title: string; artist?: string; album?: string; durationMs?: number; artworkUrl?: string }>
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
}

const STATUSES = new Set(['idle', 'loading', 'playing', 'paused', 'stalled', 'error'])
const REPEATS = new Set(['off', 'all', 'one'])

export function encodeSnapshot(snapshot: SyncSnapshotWire): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(snapshot))
}

/** Validate an already-parsed snapshot object. Returns undefined for malformed shapes. */
function parseSnapshot(data: Record<string, unknown>): SyncSnapshotWire | undefined {
  if (data['v'] !== LAN_SYNC_PROTOCOL_VERSION) return undefined
  if (typeof data['leaderId'] !== 'string' || !isId(data['leaderId'])) return undefined
  if (typeof data['leaderName'] !== 'string' || data['leaderName'].length > 64) return undefined
  if (typeof data['platform'] !== 'string') return undefined
  if (typeof data['version'] !== 'number' || !Number.isFinite(data['version'])) return undefined
  if (typeof data['serverTimeMs'] !== 'number' || !Number.isFinite(data['serverTimeMs'])) return undefined
  if (typeof data['status'] !== 'string' || !STATUSES.has(data['status'])) return undefined
  if (typeof data['positionMs'] !== 'number' || !Number.isFinite(data['positionMs']) || data['positionMs'] < 0) return undefined
  if (typeof data['durationMs'] !== 'number' || !Number.isFinite(data['durationMs']) || data['durationMs'] < 0) return undefined
  if (typeof data['repeat'] !== 'string' || !REPEATS.has(data['repeat'])) return undefined
  if (typeof data['shuffle'] !== 'boolean') return undefined
  return data as unknown as SyncSnapshotWire
}

/** Parse a snapshot from a peer. Returns undefined for anything malformed. */
export function decodeSnapshot(raw: string): SyncSnapshotWire | undefined {
  try {
    return parseSnapshot(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    return undefined
  }
}

/* ── range header ───────────────────────────────────────────────────────── */

/**
 * Parse a `Range: bytes=…` header into an inclusive byte interval.
 *
 * Handles `bytes=a-b`, `bytes=a-` and the suffix form `bytes=-n`. Returns
 * undefined for a header this server will answer with a full body (absent,
 * unparsable, or a start beyond a caller-declared size — the caller turns
 * that into a 416 if it wants to).
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  if (!header) return undefined
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return undefined
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    // Suffix form: the last `n` bytes.
    const n = Number(rawEnd)
    if (!Number.isInteger(n) || n <= 0) return undefined
    if (size === 0) return { start: 0, end: -1 } // unsatisfiable; caller answers 416/200
    const start = Math.max(0, size - n)
    return { start, end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isInteger(start) || start < 0) return undefined
  if (rawEnd === undefined || rawEnd === '') {
    return start >= size ? { start: size, end: size - 1 } : { start, end: size - 1 }
  }
  const end = Number(rawEnd)
  if (!Number.isInteger(end) || end < start) return undefined
  return { start, end: Math.min(end, size - 1) }
}

/* ── small helpers (duplicated from plugin-lan-share — see the header) ──── */

/**
 * An identifier minted locally. Not a secret — a session handle and a device
 * fingerprint — so `crypto.randomUUID` when the realm has one and a
 * timestamp-collided random otherwise (React Native's Hermes has no
 * `crypto.randomUUID`).
 */
export function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  const rand = Math.random().toString(36).slice(2, 10)
  return `id-${Date.now().toString(36)}-${rand}-${Math.random().toString(36).slice(2, 6)}`
}

/** A stream/artwork token: these ARE secrets — full entropy, no timestamps. */
export function randomToken(): string {
  const bytes = new Uint8Array(16)
  const g = globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
