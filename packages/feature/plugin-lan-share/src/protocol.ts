/**
 * The BBeBee-LAN wire protocol, v1 — pure encode/parse, no I/O.
 *
 * Three shapes cross the wire:
 *
 *   - a UDP announce datagram (JSON), for discovery
 *   - `prepare-upload` (JSON), the offer a sender puts before a receiver
 *   - `upload` / `cancel` (paths), the follow-up requests
 *
 * Everything a peer sends is *data from a stranger*, so every parser here
 * validates shape and refuses the rest — a malformed announce is dropped, a
 * malformed offer is declined, and a path that does not match the grammar
 * exactly (no traversal, ids are the minted format only) answers 404.
 *
 * File names are sanitised on receipt and re-checked at `mkdir`/`copy` time;
 * the two layers exist because the wire name and the disk name must agree.
 */

export const LAN_PROTOCOL_VERSION = 1
export const LAN_APP_ID = 'bbebee'

/** Multicast group discovery datagrams join. Site-local, private to this range. */
export const MULTICAST_GROUP = '239.255.42.98'
/**
 * UDP announce port and HTTP transfer port share the *number* (different
 * protocols, different binds) the way LocalSend's 53317 does — one number to
 * put on a sticker.
 */
export const LAN_UDP_PORT = 53318
export const LAN_HTTP_PORT = 53318

export const API_BASE = '/api/bbebee-lan/v1'
export const ANNOUNCE_INTERVAL_MS = 3_000
export const PEER_TTL_MS = 10_000
/** One offer, unanswered, dies with the sender's own request timeout. */
export const PREPARE_TIMEOUT_MS = 30_000
/** A whole song over Wi-Fi. Not per-byte — the transport streams the file. */
export const UPLOAD_TIMEOUT_MS = 10 * 60_000

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
    if (data['v'] !== LAN_PROTOCOL_VERSION) return undefined
    if (data['app'] !== LAN_APP_ID) return undefined
    if (typeof data['id'] !== 'string' || !isId(data['id'])) return undefined
    if (data['bye'] === true) {
      // A leave datagram only needs to identify the sender.
      return {
        v: LAN_PROTOCOL_VERSION,
        app: LAN_APP_ID,
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
    if (typeof data['httpPort'] !== 'number' || !Number.isInteger(data['httpPort']) || data['httpPort'] <= 0 || data['httpPort'] > 65_535) {
      return undefined
    }
    return {
      v: LAN_PROTOCOL_VERSION,
      app: LAN_APP_ID,
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

/* ── prepare-upload ─────────────────────────────────────────────────────── */

export interface WireFileOffer {
  id: string
  fileName: string
  sizeBytes: number
  mime?: string
}

export interface PrepareRequest {
  id: string
  sender: { id: string; name: string; platform: string }
  files: WireFileOffer[]
}

export function encodePrepare(req: PrepareRequest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(req))
}

/** The receiver's answer to an offer. */
export type PrepareReply = { status: 'accepted'; sessionId: string } | { status: 'declined' }

export function encodePrepareReply(reply: PrepareReply): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(reply))
}

export function decodePrepareReply(raw: Uint8Array): PrepareReply | undefined {
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    if (data['status'] === 'accepted') {
      if (typeof data['sessionId'] !== 'string' || !isId(data['sessionId'])) return undefined
      return { status: 'accepted', sessionId: data['sessionId'] }
    }
    if (data['status'] === 'declined') return { status: 'declined' }
    return undefined
  } catch {
    return undefined
  }
}

export function decodePrepare(raw: Uint8Array): PrepareRequest | undefined {
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    if (typeof data['id'] !== 'string' || !isId(data['id'])) return undefined
    const sender = data['sender'] as Record<string, unknown> | undefined
    if (!sender || typeof sender['id'] !== 'string' || !isId(sender['id'])) return undefined
    if (typeof sender['name'] !== 'string' || sender['name'].length === 0 || sender['name'].length > 64) return undefined
    if (typeof sender['platform'] !== 'string') return undefined
    if (!Array.isArray(data['files']) || data['files'].length === 0 || data['files'].length > 1_000) return undefined
    const files: WireFileOffer[] = []
    for (const entry of data['files']) {
      const file = entry as Record<string, unknown>
      if (typeof file['id'] !== 'string' || !isId(file['id'])) return undefined
      if (typeof file['fileName'] !== 'string') return undefined
      const fileName = sanitizeFileName(file['fileName'])
      if (!fileName) return undefined
      if (typeof file['sizeBytes'] !== 'number' || !Number.isFinite(file['sizeBytes']) || file['sizeBytes'] < 0) return undefined
      files.push({
        id: file['id'],
        fileName,
        sizeBytes: file['sizeBytes'],
        ...(typeof file['mime'] === 'string' ? { mime: file['mime'] } : {}),
      })
    }
    return {
      id: data['id'],
      sender: { id: sender['id'], name: sender['name'], platform: sender['platform'] },
      files,
    }
  } catch {
    return undefined
  }
}

/* ── paths ──────────────────────────────────────────────────────────────── */

/**
 * The minted id format: 32 hex, or a UUID-shaped token. Everything a path
 * interpolates must match this — it is the traversal guard for the URL
 * grammar below.
 */
export function isId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(value)
}

export function infoPath(): string {
  return `${API_BASE}/info`
}

export function preparePath(): string {
  return `${API_BASE}/prepare-upload`
}

export function uploadPath(sessionId: string, fileId: string): string {
  if (!isId(sessionId) || !isId(fileId)) throw new Error(`upload: invalid id`)
  return `${API_BASE}/upload/${sessionId}/${fileId}`
}

export function cancelPath(sessionId: string): string {
  if (!isId(sessionId)) throw new Error(`cancel: invalid id`)
  return `${API_BASE}/cancel/${sessionId}`
}

const UPLOAD_RE = new RegExp(`^${API_BASE}/upload/([A-Za-z0-9][A-Za-z0-9-]{7,63})/([A-Za-z0-9][A-Za-z0-9-]{7,63})$`)
const CANCEL_RE = new RegExp(`^${API_BASE}/cancel/([A-Za-z0-9][A-Za-z0-9-]{7,63})$`)

export function parseUploadPath(path: string): { sessionId: string; fileId: string } | undefined {
  const m = UPLOAD_RE.exec(path)
  return m ? { sessionId: m[1]!, fileId: m[2]! } : undefined
}

export function parseCancelPath(path: string): string | undefined {
  const m = CANCEL_RE.exec(path)
  return m ? m[1]! : undefined
}

/* ── file-name safety ───────────────────────────────────────────────────── */

/**
 * Reduce a peer-supplied file name to a safe basename: directory components
 * dropped, separators and control characters flattened, `..` defused by
 * construction (no separators survive), length capped.
 *
 * Returns '' for a name that sanitises to nothing — the caller refuses it.
 */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- the control characters are exactly what is being removed
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ ()[\]-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .slice(0, 180)
    .trimEnd()
  if (!cleaned || cleaned === '.' || cleaned.startsWith('.')) {
    // A dotfile is not what the sender meant, and '.' is a path.
    return cleaned === '.' ? '' : cleaned.replace(/^\.+/, '')
  }
  return cleaned
}

/* ── small helpers ──────────────────────────────────────────────────────── */

/** Extension → mime, for the audio types this app ships bindings for. */
export function mimeForFileName(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'flac':
      return 'audio/flac'
    case 'm4a':
    case 'm4b':
    case 'mp4':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'opus':
      return 'audio/opus'
    case 'wav':
      return 'audio/wav'
    case 'aiff':
    case 'aif':
      return 'audio/aiff'
    case 'wma':
      return 'audio/x-ms-wma'
    case 'ape':
      return 'audio/x-ape'
    case 'wv':
      return 'audio/x-wavpack'
    case 'dsf':
    case 'dff':
      return 'audio/dsd'
    case 'mka':
      return 'audio/x-matroska'
    case 'webm':
      return 'audio/webm'
    default:
      return 'application/octet-stream'
  }
}

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
