/**
 * `plugin-download` — the managed download queue.
 *
 * The mechanism is the one docs/05 §2 draws and docs/07 §4.5 and §4.8 name:
 * a downloaded stream is a **`media_bindings` row** (`origin: 'download'`),
 * the work is a **`download_tasks` row** driven by one worker, and the player
 * learns about the result through the `player/before-resolve` waterfall. A hit
 * answers with `kind: 'local'` and the audio engine opens a file instead of a
 * socket; a miss calls the rest of the chain.
 *
 * Only files the user asked to keep live here. The automatic media cache —
 * covers and streams played once — is `plugin-cache`'s, in `cache_entries`,
 * and it is evictable. Separating them is what keeps this plugin's one
 * question answerable: *what did the user download?*
 *
 * Three properties are the design:
 *
 *  - **The player never learns this exists.** It already knows how to play a
 *    local file — that is how the scanner's tracks work — so disabling this
 *    plugin leaves playback streaming exactly as before, and no branch
 *    anywhere says "is this downloaded?" (docs/06 §12).
 *  - **A task is checkpointed per chunk, and resumed conditionally.** The
 *    partial file plus `bytes_done` resume with a `Range` request carrying
 *    `If-Range: <etag>` — so a remote file that changed since the partial was
 *    written restarts instead of splicing (docs/07 §4.8).
 *  - **The policy is honoured before and during a transfer.** `wifi_only` and
 *    `charging_only` hold queued tasks and pause running ones when the device
 *    state stops satisfying them, re-checking when the network changes and on
 *    a timer while a charger is the only thing missing.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { formatUrn, parseUrn, tryParseUrn, uriContains } from '@BBeBee/protocol'
import type {
  ArtistCredit,
  ArtworkRef,
  DownloadHold,
  DownloadPolicy,
  DownloadState,
  DownloadTask,
  DownloadTrackMeta,
  DownloadsService,
  EnqueueItem,
  SqlValue,
  StreamHandle,
  StreamPrefs,
  StreamQuality,
  Uri,
  UrnKind,
} from '@BBeBee/protocol'
import { embedAudioTags, sanitizeFileName, stableId } from '@BBeBee/toolkit'
import { DOWNLOADS_VIEWS } from './views.js'

export interface DownloadsConfig {
  /**
   * Run transfers at all.
   *
   * `false` stops the queue: no track is fetched, and nothing already queued
   * starts. Downloads that already exist still play and can still be deleted —
   * "stop downloading" is not "forget what I have".
   */
  enabled?: boolean
  /** Quality asked of the source when the task does not name one. */
  quality?: StreamQuality
  /**
   * How often a `charging_only` hold re-checks the battery.
   *
   * The device contract has a change event for the network and none for the
   * charger, so a held queue polls. Configurable because tests should not
   * wait thirty seconds to see it.
   */
  gateRecheckMs?: number
}

const DEFAULTS: Required<DownloadsConfig> = {
  enabled: true,
  quality: 'lossless',
  gateRecheckMs: 30_000,
}

/** The built-in policy row, seeded on first run and edited by `setPolicy`. */
const POLICY_ID = 'dp_default'

/**
 * How long after serving a file a `player/error` still counts as "this
 * download is broken". A decode failure arrives in seconds; an unrelated
 * error arriving minutes later is not about the file.
 */
const INVALIDATION_WINDOW_MS = 120_000

/** Progress reaches the event bus at this rate, not once per chunk. */
const PROGRESS_EMIT_MS = 200

/** The DB checkpoint cadence. A kill costs at most this much progress. */
const PROGRESS_CHECKPOINT_MS = 1000

/** Columns this plugin reads back out of `download_tasks`. */
interface TaskRow {
  id: string
  track_urn: string
  target_uri: Uri
  state: string
  quality: string | null
  bytes_done: number
  bytes_total: number | null
  etag: string | null
  attempts: number
  last_error: string | null
  binding_id: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
  title: string | null
  artist: string | null
}

function toTask(
  row: TaskRow,
  kept: boolean,
  hold: DownloadHold | undefined,
  metaOverride?: DownloadTrackMeta,
): DownloadTask {
  const state = row.state as DownloadState
  const title = metaOverride?.title || row.title || row.track_urn
  const artist = metaOverride?.artist || row.artist || undefined
  return {
    id: row.id,
    trackUrn: row.track_urn,
    title,
    ...(artist ? { artist } : {}),
    state,
    ...(row.quality ? { quality: row.quality as StreamQuality } : {}),
    bytesDone: row.bytes_done,
    ...(row.bytes_total !== null ? { bytesTotal: row.bytes_total } : {}),
    ...(row.last_error ? { error: row.last_error } : {}),
    ...(row.binding_id ? { bindingId: row.binding_id } : {}),
    kept,
    ...(hold && (state === 'queued' || state === 'paused') ? { blocked: hold } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
  }
}

/** The columns a task read selects, with the track's display name. */
const TASK_COLUMNS = `
  d.id, d.track_urn, d.target_uri, d.state, d.quality, d.bytes_done, d.bytes_total,
  d.etag, d.attempts, d.last_error, d.binding_id, d.created_at, d.updated_at, d.finished_at,
  tr.title AS title,
  (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
    WHERE ta.track_urn = d.track_urn ORDER BY ta.ordinal LIMIT 1) AS artist`

export function extractArtistFromRaw(raw: unknown): string | undefined {
  if (!raw) return undefined
  let obj: unknown = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return undefined
    }
  }
  if (!obj || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>

  if (typeof rec.artist === 'string' && rec.artist.trim()) return rec.artist.trim()
  if (typeof rec.singer === 'string' && rec.singer.trim()) return rec.singer.trim()
  if (typeof rec.singer_name === 'string' && rec.singer_name.trim()) return rec.singer_name.trim()
  if (typeof rec.author === 'string' && rec.author.trim()) return rec.author.trim()
  if (typeof rec.uploader === 'string' && rec.uploader.trim()) return rec.uploader.trim()
  if (typeof rec.up === 'string' && rec.up.trim()) return rec.up.trim()
  if (rec.owner && typeof rec.owner === 'object') {
    const owner = rec.owner as Record<string, unknown>
    if (typeof owner.name === 'string' && owner.name.trim()) return owner.name.trim()
  }

  const arr = rec.ar || rec.artists || rec.singers || (Array.isArray(rec.artist) ? rec.artist : undefined)
  if (Array.isArray(arr) && arr.length > 0) {
    const names = arr
      .map((item: unknown) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object') {
          const itemRec = item as Record<string, unknown>
          const n = itemRec.name || itemRec.title || itemRec.artist || itemRec.singer
          if (typeof n === 'string') return n.trim()
        }
        return ''
      })
      .filter(Boolean)
    if (names.length > 0) return names.join(', ')
  }

  if (rec.song && typeof rec.song === 'object') {
    const fromSong = extractArtistFromRaw(rec.song)
    if (fromSong) return fromSong
  }
  if (rec.track && typeof rec.track === 'object') {
    const fromTrack = extractArtistFromRaw(rec.track)
    if (fromTrack) return fromTrack
  }

  return undefined
}

export function extractArtworkUrlFromRaw(raw: unknown): string | undefined {
  if (!raw) return undefined
  let obj: unknown = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return undefined
    }
  }
  if (!obj || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  const album = rec.album && typeof rec.album === 'object' ? (rec.album as Record<string, unknown>) : undefined

  const rawUrl =
    (typeof rec.picUrl === 'string' && rec.picUrl) ||
    (typeof rec.pic_url === 'string' && rec.pic_url) ||
    (typeof rec.artwork === 'string' && rec.artwork) ||
    (typeof rec.artworkUrl === 'string' && rec.artworkUrl) ||
    (typeof rec.artwork_url === 'string' && rec.artwork_url) ||
    (typeof rec.cover === 'string' && rec.cover) ||
    (typeof rec.coverUrl === 'string' && rec.coverUrl) ||
    (typeof rec.cover_url === 'string' && rec.cover_url) ||
    (typeof rec.coverWebUrl === 'string' && rec.coverWebUrl) ||
    (typeof rec.img === 'string' && rec.img) ||
    (typeof rec.imgUrl === 'string' && rec.imgUrl) ||
    (typeof rec.img_url === 'string' && rec.img_url) ||
    (typeof rec.pic === 'string' && rec.pic) ||
    (typeof rec.pic_str === 'string' && rec.pic_str) ||
    (typeof rec.thumbnail === 'string' && rec.thumbnail) ||
    (typeof album?.picUrl === 'string' && album.picUrl) ||
    (typeof album?.pic_url === 'string' && album.pic_url) ||
    (typeof album?.cover === 'string' && album.cover) ||
    (typeof album?.coverUrl === 'string' && album.coverUrl) ||
    (typeof album?.cover_url === 'string' && album.cover_url) ||
    (typeof album?.artwork === 'string' && album.artwork) ||
    undefined

  return rawUrl?.trim() || undefined
}

export function buildCoverHeaders(
  coverUrl: string,
  streamHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  }
  const referer = streamHeaders?.['referer'] || streamHeaders?.['Referer']
  if (referer) {
    headers['Referer'] = referer
  } else {
    try {
      const parsed = new URL(coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl)
      if (parsed.hostname.includes('126.net') || parsed.hostname.includes('163.com')) {
        headers['Referer'] = 'https://music.163.com/'
      } else if (
        parsed.hostname.includes('qq.com') ||
        parsed.hostname.includes('gtimg.cn') ||
        parsed.hostname.includes('qpic.cn')
      ) {
        headers['Referer'] = 'https://y.qq.com/'
      } else if (parsed.hostname.includes('kugou.com')) {
        headers['Referer'] = 'https://www.kugou.com/'
      } else if (parsed.hostname.includes('kuwo.cn')) {
        headers['Referer'] = 'https://www.kuwo.cn/'
      } else if (
        parsed.hostname.includes('bilibili.com') ||
        parsed.hostname.includes('hdslb.com')
      ) {
        headers['Referer'] = 'https://www.bilibili.com/'
      }
    } catch {
      // ignore
    }
  }
  return headers
}

export function isUrl(s: string | null | undefined): s is string {
  if (!s) return false
  const str = s.trim()
  return (
    str.startsWith('http://') ||
    str.startsWith('https://') ||
    str.startsWith('//') ||
    str.startsWith('data:') ||
    str.startsWith('file:') ||
    str.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(str)
  )
}

export function normalizeEnqueueItem(rawInput: EnqueueItem): { urn: string; meta?: DownloadTrackMeta } {
  if (typeof rawInput === 'string') {
    const s = rawInput.trim()
    return { urn: s }
  }
  if (!rawInput || typeof rawInput !== 'object') {
    return { urn: String(rawInput ?? '') }
  }

  // 1. Unwrap wrapped track or item (e.g. { track: Track }, { item: Track }, { row: { track: Track } })
  let item = rawInput as unknown as Record<string, unknown>
  if (item.track && typeof item.track === 'object') {
    item = item.track as Record<string, unknown>
  } else if (item.item && typeof item.item === 'object') {
    item = item.item as Record<string, unknown>
  } else if (item.row && typeof item.row === 'object' && (item.row as Record<string, unknown>).track) {
    item = (item.row as Record<string, unknown>).track as Record<string, unknown>
  }

  // 2. Extract and format URN as a valid string
  let resolvedUrn: string | undefined
  const rawUrn = item.urn ?? item.trackUrn ?? item.track_urn

  if (typeof rawUrn === 'string' && rawUrn.trim() && rawUrn.trim() !== '[object Object]') {
    resolvedUrn = rawUrn.trim()
  } else if (rawUrn && typeof rawUrn === 'object') {
    const uObj = rawUrn as Record<string, unknown>
    if (typeof uObj.urn === 'string' && uObj.urn.trim() && uObj.urn.trim() !== '[object Object]') {
      resolvedUrn = uObj.urn.trim()
    } else if (uObj.sourceId && (uObj.id || uObj.trackId || uObj.songId)) {
      const sId = String(uObj.sourceId).trim()
      const idVal = String(uObj.id ?? uObj.trackId ?? uObj.songId).trim()
      const kindVal = (uObj.kind as UrnKind) || 'track'
      try {
        resolvedUrn = formatUrn({ sourceId: sId, kind: kindVal, id: idVal })
      } catch {
        resolvedUrn = `BBeBee:${sId}:track:${idVal}`
      }
    }
  }

  // Fallback: construct from item.sourceId and item.id / item.trackId / item.songId / item.mid / item.remoteId
  if (!resolvedUrn) {
    const sId =
      typeof item.sourceId === 'string' && item.sourceId.trim()
        ? item.sourceId.trim()
        : typeof item.source === 'string' && item.source.trim()
          ? item.source.trim()
          : 'unknown'
    const idVal = item.id ?? item.trackId ?? item.songId ?? item.mid ?? item.remoteId ?? item.key
    if (idVal !== undefined && idVal !== null && String(idVal).trim() && String(idVal) !== '[object Object]') {
      try {
        resolvedUrn = formatUrn({ sourceId: sId, kind: 'track', id: String(idVal).trim() })
      } catch {
        resolvedUrn = `BBeBee:${sId}:track:${String(idVal).trim()}`
      }
    }
  }

  // Final fallback if no URN could be resolved
  if (!resolvedUrn || resolvedUrn === '[object Object]') {
    const fallbackId = stableId(JSON.stringify(item))
    resolvedUrn = `BBeBee:unknown:track:${fallbackId}`
  }

  // 3. Extract metadata fields
  const title =
    (typeof item.title === 'string' && item.title.trim() ? item.title.trim() : undefined) ??
    (typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined) ??
    (typeof item.songName === 'string' && item.songName.trim() ? item.songName.trim() : undefined) ??
    (typeof item.trackName === 'string' && item.trackName.trim() ? item.trackName.trim() : undefined)

  let artist = typeof item.artist === 'string' && item.artist.trim() ? item.artist.trim() : undefined
  if (!artist && 'artists' in item && Array.isArray(item.artists) && item.artists.length > 0) {
    artist = item.artists
      .map((a: unknown) => {
        if (typeof a === 'string') return a.trim()
        if (a && typeof a === 'object' && 'name' in a && typeof (a as { name?: unknown }).name === 'string') {
          return (a as { name: string }).name.trim()
        }
        return ''
      })
      .filter(Boolean)
      .join(', ')
  }
  const raw = item.raw
  if (!artist && raw) {
    artist = extractArtistFromRaw(raw)
  }
  if (!artist) {
    artist = extractArtistFromRaw(item)
  }

  const artRef = item.artwork as ArtworkRef | undefined
  let artworkUrl =
    (typeof item.artworkUrl === 'string' && item.artworkUrl.trim() ? item.artworkUrl.trim() : undefined) ??
    artRef?.sourceUrl ??
    (isUrl(artRef?.id) ? artRef.id : undefined)
  if (!artworkUrl && raw) {
    artworkUrl = extractArtworkUrlFromRaw(raw)
  }
  if (!artworkUrl) {
    artworkUrl = extractArtworkUrlFromRaw(item)
  }

  const rawAlbum = item.album
  let albumTitle = typeof item.albumTitle === 'string' && item.albumTitle.trim() ? item.albumTitle.trim() : undefined
  if (!albumTitle && typeof rawAlbum === 'string' && rawAlbum.trim()) {
    albumTitle = rawAlbum.trim()
  } else if (
    !albumTitle &&
    rawAlbum &&
    typeof rawAlbum === 'object' &&
    'title' in rawAlbum &&
    typeof (rawAlbum as { title?: unknown }).title === 'string'
  ) {
    albumTitle = (rawAlbum as { title: string }).title.trim()
  }

  const albumUrn =
    (typeof item.albumUrn === 'string' && item.albumUrn.trim() ? item.albumUrn.trim() : undefined) ??
    (rawAlbum &&
    typeof rawAlbum === 'object' &&
    'urn' in rawAlbum &&
    typeof (rawAlbum as { urn?: unknown }).urn === 'string'
      ? (rawAlbum as { urn: string }).urn
      : undefined)

  const meta: DownloadTrackMeta = {
    urn: resolvedUrn,
    title,
    artist: artist || undefined,
    artists: item.artists as readonly ArtistCredit[] | undefined,
    albumTitle,
    albumUrn,
    year: typeof item.year === 'number' ? item.year : undefined,
    trackNo: typeof item.trackNo === 'number' ? item.trackNo : undefined,
    artwork: artRef,
    artworkUrl: artworkUrl || undefined,
    artworkLocalUri: typeof item.artworkLocalUri === 'string' ? item.artworkLocalUri : undefined,
    raw,
  }
  return { urn: resolvedUrn, meta }
}

export class Downloads extends Service implements DownloadsService {
  static inject = ['fs', 'db', 'paths', 'http', 'sources']

  private readonly config: Required<DownloadsConfig>
  /**
   * The plugin's own context, captured at construction.
   *
   * ⚠️ Not `this.ctx` at call time: inside a method reached through the
   * service proxy Cordis shadows `this.ctx` to the *caller's* context, and the
   * capability gate would then run against the caller's grants. See the note
   * in `plugin-player`.
   */
  private readonly ownCtx: Context
  private list: DownloadTask[] = []
  private readonly trackMetaOverrides = new Map<string, DownloadTrackMeta>()
  /** Every open task's target file, keyed by task id. */
  private readonly targets = new Map<string, Uri>()
  /** The etag each partial file was written against, keyed by task id. */
  private readonly etags = new Map<string, string>()
  private readonly controllers = new Map<
    string,
    { controller: AbortController; intent: 'pause' | 'cancel'; lastEmit: number }
  >()
  private running?: string
  /** Where downloads land. Never evicted, never swept. */
  private keptDir!: Uri
  private policyValue: DownloadPolicy = {
    id: POLICY_ID,
    name: 'Default',
    enabled: true,
    wifiOnly: false,
    chargingOnly: false,
    quality: DEFAULTS.quality,
  }
  /** The device service's scoped context, when the build has one. */
  private deviceCtx?: Context
  /** What is holding the queue right now, if anything. */
  private hold?: DownloadHold
  /**
   * Tasks a policy hold paused.
   *
   * A user-paused task must stay paused when the network comes back; a task
   * *this* plugin paused because the connection became metered should pick up
   * where it left off. The set is what tells them apart.
   */
  private readonly heldPaused = new Set<string>()
  private gateTimer?: ReturnType<typeof setTimeout>
  private lastServed?: { urn: string; at: number }
  private disposed = false

  constructor(ctx: Context, config: DownloadsConfig = {}) {
    super(ctx, 'downloads')
    this.ownCtx = ctx
    this.config = {
      enabled: config.enabled ?? DEFAULTS.enabled,
      quality: config.quality ?? DEFAULTS.quality,
      gateRecheckMs: config.gateRecheckMs ?? DEFAULTS.gateRecheckMs,
    }
    this.policy.quality = this.config.quality
  }

  async [Service.init]() {
    this.keptDir = this.ownCtx.fs.join(this.ownCtx.paths.downloads, 'BBeBee')
    try {
      await this.ownCtx.fs.mkdir(this.keptDir, { recursive: true })
      // A build before `plugin-cache` wrote playback copies into the cache
      // directory and registered them here. That is no longer this plugin's
      // job, so those rows and files are dropped: the next play streams and
      // `plugin-cache` caches it, with its own eviction policy.
      await this.forgetLegacyCache()
    } catch (error) {
      this.ownCtx.logger.warn(`download: could not prepare the downloads directory: ${String(error)}`)
    }

    await this.loadPolicy()
    await this.reconcile()
    await this.refresh()

    // Descriptor, not a component: both shells bind a view to this id, and a
    // build with one shell still lists the page (docs/08 §3).
    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.ui.contribute({
        kind: 'route',
        id: DOWNLOADS_VIEWS.page,
        path: '/downloads',
        title: 'Downloads',
        icon: 'download',
        placement: ['tray'],
        order: 30,
      }),
    )

    // Optional, like the sandbox in the runtime: a build without a device
    // service simply has no network or battery to ask, and no hold to apply.
    this.ownCtx.inject(['device'], (scoped) => {
      this.deviceCtx = scoped
      const off = scoped.device.onNetworkChange(() => void this.refreshGate())
      return () => {
        off()
        this.deviceCtx = undefined
      }
    })

    this.ownCtx.inject(['settings'], (scoped) => {
      const initial = scoped.settings.getSync()
      if (initial.downloadWifiOnly !== undefined && initial.downloadWifiOnly !== this.policyValue.wifiOnly) {
        void this.setPolicy({ wifiOnly: initial.downloadWifiOnly })
      }
      const off = scoped.settings.onSettingsChange((s) => {
        if (s.downloadWifiOnly !== undefined && s.downloadWifiOnly !== this.policyValue.wifiOnly) {
          void this.setPolicy({ wifiOnly: s.downloadWifiOnly })
        }
      })
      return () => off()
    })

    // Prepended: a download hit is a local file read, and there is no reason
    // to run a network-oriented listener (failover, a future re-auth) before it.
    const offResolve = this.ownCtx.on(
      'player/before-resolve',
      (urn: string, prefs: StreamPrefs, next: () => Promise<StreamHandle>) =>
        this.resolve(urn, prefs, next),
      { prepend: true },
    )
    const offError = this.ownCtx.on('player/error', (_error, urn: string) =>
      this.invalidateServed(urn),
    )

    void this.refreshGate()
    return () => {
      offResolve()
      offError()
      this.disposed = true
      if (this.gateTimer) clearTimeout(this.gateTimer)
      for (const record of this.controllers.values()) {
        record.intent = 'cancel'
        record.controller.abort()
      }
      this.controllers.clear()
    }
  }

  get tasks(): readonly DownloadTask[] {
    return this.list
  }

  task(id: string): DownloadTask | undefined {
    return this.byId(id)
  }

  /* ── policy ────────────────────────────────────────────────────────── */

  get policy(): DownloadPolicy {
    return this.policyValue
  }

  async setPolicy(
    patch: Partial<Pick<DownloadPolicy, 'enabled' | 'wifiOnly' | 'chargingOnly'>>,
  ): Promise<void> {
    this.policyValue = { ...this.policyValue, ...patch }
    await this.ownCtx.db.exec(
      `UPDATE download_policies SET enabled = ?, wifi_only = ?, charging_only = ? WHERE id = ?`,
      [
        this.policyValue.enabled ? 1 : 0,
        this.policyValue.wifiOnly ? 1 : 0,
        this.policyValue.chargingOnly ? 1 : 0,
        POLICY_ID,
      ],
    )
    if (patch.wifiOnly !== undefined) {
      const settings = this.ownCtx.get('settings')
      if (settings) {
        void settings.update({ downloadWifiOnly: patch.wifiOnly })
      }
    }
    this.ownCtx.logger.info(
      `download: policy enabled=${this.policyValue.enabled} wifiOnly=${this.policyValue.wifiOnly} chargingOnly=${this.policyValue.chargingOnly}`,
    )
    this.emitChanged()
    await this.refreshGate()
  }

  private async loadPolicy(): Promise<void> {
    await this.ownCtx.db.exec(
      `INSERT INTO download_policies (id, name, enabled, scope_json, quality, wifi_only,
                                      max_bytes, charging_only, created_at)
       VALUES (?, 'Default', 1, '{}', ?, 0, NULL, 0, ?)
       ON CONFLICT(id) DO NOTHING`,
      [POLICY_ID, this.config.quality, Date.now()],
    )
    const row = await this.ownCtx.db.get<{
      name: string
      enabled: number
      quality: string
      wifi_only: number
      charging_only: number
    }>(
      `SELECT name, enabled, quality, wifi_only, charging_only FROM download_policies WHERE id = ?`,
      [POLICY_ID],
    )
    const settings = this.ownCtx.get('settings')
    const settingsWifiOnly = settings?.getSync?.()?.downloadWifiOnly
    const wifiOnly =
      settingsWifiOnly !== undefined ? settingsWifiOnly : row ? row.wifi_only === 1 : false

    this.policyValue = {
      id: POLICY_ID,
      name: row?.name ?? 'Default',
      enabled: row ? row.enabled === 1 : true,
      wifiOnly,
      chargingOnly: row ? row.charging_only === 1 : false,
      quality: (row?.quality as StreamQuality | undefined) ?? this.config.quality,
    }
  }

  /**
   * Whether the device state allows a transfer right now.
   *
   * Conservative on absent information: no device service, an unreadable
   * battery or a failed probe all mean "not held", because the alternative is
   * a queue that silently stops on a platform that cannot answer.
   */
  private async policyHold(): Promise<DownloadHold | undefined> {
    const policy = this.policyValue
    if (!policy.enabled || (!policy.wifiOnly && !policy.chargingOnly)) return undefined
    const device = this.deviceCtx?.device
    if (!device) return undefined
    try {
      if (policy.wifiOnly && (await device.network()).metered) return 'wifi'
      if (policy.chargingOnly) {
        const battery = await device.battery()
        if (battery && !battery.charging) return 'charging'
      }
    } catch (error) {
      this.ownCtx.logger.warn(`download: could not read the device state: ${String(error)}`)
    }
    return undefined
  }

  /**
   * Re-evaluate the hold, and act on a change.
   *
   * A running transfer that stops being allowed is **paused**, not cancelled:
   * the bytes stay for when the policy allows again, which is the whole reason
   * checkpoints exist. `download/progress` listeners see the pause through
   * `download/changed`.
   */
  private async refreshGate(): Promise<void> {
    const hold = await this.policyHold()
    const changed = hold !== this.hold
    const wasHolding = this.hold !== undefined
    this.hold = hold
    if (changed) {
      this.applyHold()
      this.emitChanged()
    }
    if (hold) {
      for (const task of [...this.list]) {
        if (task.state === 'running') {
          this.ownCtx.logger.info(`download: pausing ${task.trackUrn} — held by ${hold}`)
          this.heldPaused.add(task.id)
          await this.pause(task.id)
        }
      }
    } else if (wasHolding) {
      // The hold lifted: work this plugin paused resumes on its own, because
      // the user asked for these downloads and did not pause them.
      for (const id of [...this.heldPaused]) {
        this.heldPaused.delete(id)
        if (this.byId(id)?.state === 'paused') await this.resume(id)
      }
    }
    this.scheduleGateRecheck()
    if (!hold) this.startWorker()
  }

  /** Re-derive every task's `blocked` from the current hold. */
  private applyHold(): void {
    this.list = this.list.map((task) => {
      const blocked = this.holdFor(task.state)
      if (blocked === task.blocked) return task
      return { ...task, ...(blocked ? { blocked } : { blocked: undefined }) }
    })
  }

  private holdFor(state: DownloadState): DownloadHold | undefined {
    if (!this.hold) return undefined
    return state === 'queued' || state === 'paused' ? this.hold : undefined
  }

  private scheduleGateRecheck(): void {
    if (this.gateTimer) {
      clearTimeout(this.gateTimer)
      this.gateTimer = undefined
    }
    if (this.disposed || this.hold !== 'charging') return
    this.gateTimer = setTimeout(() => {
      this.gateTimer = undefined
      void this.refreshGate()
    }, this.config.gateRecheckMs)
  }

  /* ── queue operations ──────────────────────────────────────────────── */

  async enqueue(
    items: readonly EnqueueItem[],
    opts: { quality?: StreamQuality } = {},
  ): Promise<readonly DownloadTask[]> {
    const queued: DownloadTask[] = []
    for (const item of items) {
      if (!item) continue
      const { urn, meta } = normalizeEnqueueItem(item)
      if (typeof urn !== 'string' || !urn.trim() || urn === '[object Object]') {
        this.ownCtx.logger.warn(`download: skipping enqueue with invalid urn: ${String(urn)}`)
        continue
      }
      const safeUrn = urn.trim()
      if (meta) {
        this.trackMetaOverrides.set(safeUrn, meta)
        await this.ensureTrackRow(safeUrn, meta).catch((e: unknown) => {
          this.ownCtx.logger.warn(`download: ensureTrackRow failed for ${safeUrn}: ${String(e)}`)
        })
      }
      const task = await this.enqueueOne(safeUrn, opts.quality, meta)
      if (task) queued.push(task)
    }
    void this.refreshGate()
    return queued
  }

  /**
   * Queue one task, or return the active one.
   *
   * The partial unique index (`state != 'done'`) is the authority on "already
   * downloading this": two presses on a screen for a track already queued, or
   * an enqueue racing a retry, must not produce two writers on one path.
   */
  private async enqueueOne(
    urn: string,
    quality: StreamQuality | undefined,
    meta?: DownloadTrackMeta,
  ): Promise<DownloadTask | undefined> {
    if (typeof urn !== 'string' || !urn.trim() || urn === '[object Object]') {
      this.ownCtx.logger.warn(`download: enqueueOne called with invalid urn: ${String(urn)}`)
      return undefined
    }
    const existing = this.list.find((task) => task.trackUrn === urn && task.state !== 'done')
    if (existing) {
      if (meta?.title && (!existing.title || existing.title === existing.trackUrn)) {
        existing.title = meta.title
        this.patch(existing.id, { title: meta.title })
      }
      if (meta?.artist && !existing.artist) {
        existing.artist = meta.artist
        this.patch(existing.id, { artist: meta.artist })
      }
      return existing
    }

    const id = `dl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    const target = this.fileFor(urn, meta)
    const now = Date.now()
    try {
      await this.ownCtx.db.exec(
        `INSERT INTO download_tasks (id, track_urn, target_uri, state, quality, bytes_done,
                                     priority, attempts, policy_id, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, 0, 1, 0, ?, ?, ?)`,
        [id, urn, target, quality ?? this.policyValue.quality, POLICY_ID, now, now],
      )
    } catch (error) {
      // Lost a race against another enqueue for the same track. The task that
      // won is the answer; anything else is a real write failure.
      await this.refresh()
      const winner = this.list.find((task) => task.trackUrn === urn && task.state !== 'done')
      if (winner) return winner
      this.ownCtx.logger.warn(`download: could not queue ${urn}: ${String(error)}`)
      return undefined
    }

    await this.refresh()
    const created = this.byId(id)
    if (created) {
      if (meta?.title && (!created.title || created.title === created.trackUrn)) {
        created.title = meta.title
        this.patch(id, { title: meta.title })
      }
      if (meta?.artist && !created.artist) {
        created.artist = meta.artist
        this.patch(id, { artist: meta.artist })
      }
    }
    this.targets.set(id, target)
    this.ownCtx.logger.info(`download: queued ${urn}`)
    this.safeEmit(() => this.ownCtx.emit('download/queued', id))
    return this.byId(id)
  }

  async pause(id: string): Promise<void> {
    const task = this.byId(id)
    if (!task) return
    if (task.state === 'queued') {
      await this.setState(id, 'paused')
      return
    }
    if (task.state !== 'running') return

    // The file, not the last progress event, is the truth: a chunk may have
    // landed after the last callback, and a resume from the wrong offset
    // duplicates or skips bytes.
    const bytes = await this.actualBytes(id)
    this.ownCtx.logger.info(`download: pausing ${task.trackUrn} at ${bytes} byte(s)`)
    await this.updateRow(id, { bytes_done: bytes })
    this.patch(id, { bytesDone: bytes })
    await this.setState(id, 'paused')
    this.abort(id, 'pause')
  }

  async resume(id: string): Promise<void> {
    const task = this.byId(id)
    if (!task || task.state !== 'paused') return
    // The file, not the in-memory counter, is where the resume starts: a
    // write that landed after the last progress event would otherwise be
    // appended over.
    const bytes = await this.actualBytes(id)
    if (bytes !== task.bytesDone) {
      await this.updateRow(id, { bytes_done: bytes })
      this.patch(id, { bytesDone: bytes })
    }
    this.ownCtx.logger.info(`download: resuming ${task.trackUrn} from ${bytes} byte(s)`)
    await this.setState(id, 'queued')
    void this.refreshGate()
  }

  async retry(id: string): Promise<void> {
    const task = this.byId(id)
    if (!task || (task.state !== 'failed' && task.state !== 'canceled')) return
    const bytes = await this.actualBytes(id)
    await this.updateRow(id, { bytes_done: bytes, attempts: 0 })
    this.patch(id, { bytesDone: bytes })
    this.ownCtx.logger.info(`download: retrying ${task.trackUrn}`)
    await this.setState(id, 'queued')
    void this.refreshGate()
  }

  async cancel(id: string): Promise<void> {
    const task = this.byId(id)
    if (!task || task.state === 'done') return
    this.ownCtx.logger.info(`download: cancelling ${task.trackUrn}`)
    if (task.state === 'running') {
      await this.setState(id, 'canceled')
      this.abort(id, 'cancel')
      // The writer owns the file until it unwinds; `run` removes it then.
      return
    }
    await this.ownCtx.fs.remove(this.targetFor(id)).catch(() => undefined)
    await this.setState(id, 'canceled')
  }

  async remove(id: string): Promise<void> {
    const task = this.byId(id)
    if (!task) return
    this.ownCtx.logger.info(`download: removing task ${id} (${task.state})`)

    const target = this.targets.get(id)
    const binding = task.bindingId
      ? await this.ownCtx.db
          .get<{ uri: Uri }>('SELECT uri FROM media_bindings WHERE id = ?', [task.bindingId])
          .catch(() => undefined)
      : undefined

    if (task.state === 'running') this.abort(id, 'cancel')

    await this.ownCtx.db.transaction(async (tx) => {
      await tx.exec('DELETE FROM download_tasks WHERE id = ?', [id])
      if (task.bindingId) await tx.exec('DELETE FROM media_bindings WHERE id = ?', [task.bindingId])
    })

    // The row *is* what "this track is downloaded" means, so the bytes go with
    // it — otherwise the next play caches it again while the screen said it
    // was deleted.
    for (const uri of [binding?.uri, target]) {
      if (uri) await this.ownCtx.fs.remove(uri).catch(() => undefined)
    }

    this.list = this.list.filter((entry) => entry.id !== id)
    this.targets.delete(id)
    this.etags.delete(id)
    this.heldPaused.delete(id)
    this.emitChanged()
    this.startWorker()
  }

  async clearFinished(): Promise<void> {
    for (const task of [...this.list]) {
      // A canceled task is dead bookkeeping and goes. A finished download is
      // the user's file: only its own 🗑 deletes it.
      if (task.state === 'canceled') await this.remove(task.id)
    }
  }

  /* ── the waterfall ─────────────────────────────────────────────────── */

  /**
   * The `player/before-resolve` listener.
   *
   * A hit short-circuits: the waterfall's whole purpose is that the player
   * accepts either answer without knowing which one it got. A miss changes
   * nothing — `plugin-cache`, if it is loaded, is the next listener.
   */
  async resolve(
    urn: string,
    _prefs: StreamPrefs,
    next: () => Promise<StreamHandle>,
  ): Promise<StreamHandle> {
    const cached = await this.cachedHandle(urn)
    if (cached) return cached
    return next()
  }

  /**
   * Drop a download this plugin served, after the player failed to play it.
   *
   * Only the most recently served track is considered, and only for a short
   * window: a `player/error` for an unrelated track — or the same track hours
   * later, streaming again — must not delete a good file.
   */
  invalidateServed(urn: string): void {
    const served = this.lastServed
    if (!served || served.urn !== urn) return
    if (Date.now() - served.at > INVALIDATION_WINDOW_MS) return
    this.lastServed = undefined
    this.ownCtx.logger.warn(`download: downloaded copy of ${urn} failed to play; dropping it`)
    const task = this.list.find((entry) => entry.trackUrn === urn && entry.bindingId)
    if (task) {
      void this.remove(task.id).catch((error: unknown) => {
        this.ownCtx.logger.warn(`download: could not drop ${urn}: ${String(error)}`)
      })
      return
    }
    // No task owns the binding (a row written by an older build): drop the
    // binding directly so the next attempt streams.
    void this.ownCtx.db
      .exec('DELETE FROM media_bindings WHERE track_urn = ? AND origin = ?', [urn, 'download'])
      .catch(() => undefined)
  }

  /* ── reading the downloads ─────────────────────────────────────────── */

  /**
   * The local file for `urn`, or nothing when there is no kept download.
   *
   * Only `kept` bindings — the ones under `ctx.paths.downloads` — count. Any
   * other `origin: 'download'` row is the playback cache an older build wrote,
   * which `plugin-cache` owns now.
   */
  async cachedHandle(urn: string): Promise<StreamHandle | undefined> {
    let rows:
      | {
          id: string
          uri: Uri
          format: string | null
          bitrate_kbps: number | null
          sample_rate: number | null
          size_bytes: number | null
          quality: string | null
        }[]
      | undefined
    try {
      rows = await this.ownCtx.db.query(
        `SELECT id, uri, format, bitrate_kbps, sample_rate, size_bytes, quality
           FROM media_bindings
          WHERE track_urn = ? AND origin = 'download'
          ORDER BY verified_at DESC, created_at DESC
          LIMIT 8`,
        [urn],
      )
    } catch (error) {
      // A read that fails must not take playback down with it: the caller
      // still gets the remote stream, which is the pre-download status quo.
      this.ownCtx.logger.warn(`download: could not read the downloads for ${urn}: ${String(error)}`)
      return undefined
    }
    const row = rows?.find((entry) => this.isKept(entry.uri))
    if (!row) return undefined

    if (!(await this.ownCtx.fs.exists(row.uri).catch(() => false))) {
      // docs/07 §4.5: a binding whose file is missing is deleted rather than
      // left to fail at play time.
      await this.ownCtx.db
        .exec('DELETE FROM media_bindings WHERE id = ?', [row.id])
        .catch((error: unknown) => {
          this.ownCtx.logger.warn(`download: could not drop a stale binding: ${String(error)}`)
        })
      return undefined
    }

    // A play is the strongest "still wanted", and the Downloads screen reads
    // this back as the date the row was last verified.
    await this.ownCtx.db
      .exec('UPDATE media_bindings SET verified_at = ? WHERE id = ?', [Date.now(), row.id])
      .catch(() => undefined)

    this.lastServed = { urn, at: Date.now() }
    return {
      kind: 'local',
      target: await this.ownCtx.fs.toPlayableUri(row.uri),
      seekable: true,
      ...(row.format ? { codec: row.format } : {}),
      ...(row.bitrate_kbps ? { bitrateKbps: row.bitrate_kbps } : {}),
      ...(row.sample_rate ? { sampleRate: row.sample_rate } : {}),
      ...(row.size_bytes ? { byteLength: row.size_bytes } : {}),
      ...(row.quality ? { quality: row.quality as StreamQuality } : {}),
    }
  }

  /* ── the worker ────────────────────────────────────────────────────── */

  private startWorker(): void {
    if (!this.config.enabled || this.disposed || this.running || this.hold) return
    const next = this.list.find((task) => task.state === 'queued')
    if (!next) return
    this.running = next.id
    void this.run(next.id).finally(() => {
      this.running = undefined
      if (!this.disposed) this.startWorker()
    })
  }

  private async run(id: string): Promise<void> {
    const task = this.byId(id)
    if (!task) return
    const record: {
      controller: AbortController
      intent: 'pause' | 'cancel'
      lastEmit: number
    } = { controller: new AbortController(), intent: 'pause', lastEmit: 0 }
    this.controllers.set(id, record)
    await this.setState(id, 'running')

    // Pre-resolve track metadata if title is placeholder URN or artist is absent
    const override = this.trackMetaOverrides.get(task.trackUrn)
    const lookedUpMeta = await this.lookupTrackMetadata(task.trackUrn)
    const trackMeta = {
      ...lookedUpMeta,
      ...(override?.title ? { title: override.title } : {}),
      ...(override?.artist ? { artist: override.artist } : {}),
      ...(override?.albumTitle ? { album: override.albumTitle } : {}),
      ...(override?.year ? { year: override.year } : {}),
      ...(override?.trackNo ? { trackNo: override.trackNo } : {}),
      ...(override?.artworkUrl ? { artworkSourceUrl: override.artworkUrl } : {}),
      ...(override?.artworkLocalUri ? { artworkLocalUri: override.artworkLocalUri } : {}),
      ...(override?.raw ? { raw: override.raw } : {}),
    }
    if (override?.artists && !trackMeta.artist && override.artists.length > 0) {
      trackMeta.artist = override.artists
        .map((a) => (typeof a === 'string' ? a : a.name))
        .filter(Boolean)
        .join(', ')
    }

    if (override?.title) {
      task.title = override.title
    } else if (trackMeta.title && (!task.title || task.title === task.trackUrn)) {
      task.title = trackMeta.title
    }
    if (override?.artist) {
      task.artist = override.artist
    } else if (trackMeta.artist && !task.artist) {
      task.artist = trackMeta.artist
    }
    await this.ensureTrackRow(task.trackUrn, trackMeta)
    this.patch(id, { title: task.title, ...(task.artist ? { artist: task.artist } : {}) })

    this.safeEmit(() => this.ownCtx.emit('download/started', id, task.title))
    const i18n = this.ownCtx.get('i18n') as { t?(k: string, p?: Record<string, unknown>): string } | undefined
    const toastMsg = i18n?.t?.('download:download.downloadStarted', { title: task.title }) ?? `开始下载: ${task.title}`
    this.safeEmit(() => this.ownCtx.emit('ui/toast', { message: toastMsg, tone: 'info' }))

    try {
      const handle = await this.resolveFor(task)

      if (handle.kind === 'local') {
        // Already a file: nothing to fetch, and nothing to bind.
        await this.finish(id, undefined, handle.byteLength ?? task.bytesDone, handle)
        return
      }

      await this.ownCtx.fs.mkdir(this.keptDir, { recursive: true })

      const preferred = this.ownCtx.get('settings')?.getSync?.()?.downloadFormat
      const handleFormat = formatFor(handle)
      let format = handleFormat ?? 'mp3'
      if (preferred && preferred !== 'auto') {
        if (preferred === 'mp4') {
          format = 'mp4'
        } else if (preferred === 'flac') {
          format = 'flac'
        } else if (preferred === 'mp3') {
          format = 'mp3'
        } else {
          format = preferred
        }
      }
      const safeTitle = sanitizeFileName(task.title || task.trackUrn)
      let target = this.ownCtx.fs.join(this.keptDir, `${safeTitle}.${format}`)

      // Check if target name belongs to a different track in media_bindings
      const existing = await this.ownCtx.db
        .get<{ track_urn: string }>('SELECT track_urn FROM media_bindings WHERE uri = ?', [target])
        .catch(() => undefined)
      if (existing && existing.track_urn !== task.trackUrn) {
        const disambiguator = task.artist ? ` - ${sanitizeFileName(task.artist)}` : `_${task.id}`
        target = this.ownCtx.fs.join(this.keptDir, `${safeTitle}${disambiguator}.${format}`)
      }

      const prevTarget = this.targetFor(id)
      if (prevTarget !== target) {
        this.targets.set(id, target)
        await this.updateRow(id, { target_uri: target })
        this.patch(id, {})
      }

      /*
       * A resume is conditional on the remote file not having changed.
       *
       * `If-Range` is the standards-shaped way to say it: the server answers
       * 206 when the etag still matches and 200 when it does not, and
       * `ctx.http.download` treats a 200 as "truncate and write from zero".
       * Without it, a re-encoded file is spliced into the old bytes.
       */
      const headers = { ...(handle.headers ?? {}) }
      const etag = this.etags.get(id)
      if (task.bytesDone > 0 && etag) headers['if-range'] = etag

      let lastCheckpoint = 0
      const { bytes: downloadedBytes, etag: freshEtag } = await this.ownCtx.http.download({
        url: handle.target,
        headers,
        to: target,
        ...(task.bytesDone > 0 ? { resumeFrom: task.bytesDone } : {}),
        signal: record.controller.signal,
        onResponse: (info) => {
          // Recorded before a body byte lands, so an interrupted transfer
          // still knows which remote version its partial file belongs to.
          if (info.etag) void this.updateRow(id, { etag: info.etag })
          if (info.etag) this.etags.set(id, info.etag)
          if (info.total !== undefined) this.patch(id, { bytesTotal: info.total })
        },
        onProgress: (done, total) => {
          this.publishProgress(id, done, total)
          const now = Date.now()
          if (now - lastCheckpoint >= PROGRESS_CHECKPOINT_MS) {
            lastCheckpoint = now
            void this.checkpoint(id, done, total)
          }
        },
      })

      let bytes = downloadedBytes

      // A pause or a cancel landed while the transfer was finishing; the
      // state was already set by whoever asked, and the partial file is left
      // for a resume (pause) or removed by `cancel`.
      if (this.byId(id)?.state !== 'running') return

      if (freshEtag) this.etags.set(id, freshEtag)

      // Embed audio metadata tags
      try {
        const rawBytes = await this.ownCtx.fs.readBytes(target).catch(() => undefined)
        if (rawBytes) {
          const picture = await this.fetchCoverBytes(trackMeta, handle.headers)
          if (picture?.data?.length) {
            this.ownCtx.logger.info(
              `download: embedding cover (${picture.data.length} bytes) for ${task.trackUrn} into ${target}`,
            )
          } else {
            this.ownCtx.logger.warn(`download: no cover artwork found for ${task.trackUrn}`)
          }
          const tagged = embedAudioTags(rawBytes, format, {
            title: trackMeta?.title ?? task.title,
            artist: trackMeta?.artist ?? task.artist,
            album: trackMeta?.album ?? override?.albumTitle,
            year: trackMeta?.year,
            trackNo: trackMeta?.trackNo,
            comment: 'BBeBee',
            picture,
          })
          if (tagged !== rawBytes) {
            await this.ownCtx.fs.writeFile(target, tagged)
            bytes = tagged.byteLength
            this.ownCtx.logger.info(`download: audio tags embedded successfully into ${target} (${bytes} bytes)`)
          }
        }
      } catch (err) {
        this.ownCtx.logger.warn(`download: failed to embed audio tags: ${String(err)}`)
      }

      await this.finish(id, target, bytes, handle, format)
    } catch (error) {
      if (this.disposed || record.controller.signal.aborted) {
        if (record.intent === 'cancel') {
          await this.ownCtx.fs.remove(this.targetFor(id)).catch(() => undefined)
        }
        return
      }
      await this.fail(id, error)
    } finally {
      this.controllers.delete(id)
    }
  }

  private async resolveFor(task: DownloadTask): Promise<StreamHandle> {
    const provider = this.ownCtx.sources.forUrn(task.trackUrn)
    if (!provider) throw new Error(`no source owns ${task.trackUrn}`)
    const { id } = parseUrn(task.trackUrn)
    const settings = this.ownCtx.get('settings')
    const preferred = settings?.getSync?.()?.downloadFormat
    let acceptFormats: string[] = []
    let quality = task.quality ?? this.policyValue.quality
    if (preferred && preferred !== 'auto') {
      if (preferred === 'mp4') {
        acceptFormats = ['mp4', 'm4a']
      } else if (preferred === 'mp3') {
        acceptFormats = ['mp3']
        if (quality === 'lossless') {
          quality = 'high'
        }
      } else if (preferred === 'flac') {
        acceptFormats = ['flac']
        if (!task.quality) {
          quality = 'lossless'
        }
      } else {
        acceptFormats = [preferred]
      }
    }
    return provider.resolveStream(id, {
      quality,
      saveData: false,
      acceptFormats,
    })
  }

  /** A finished transfer becomes a binding, and the task records it. */
  private async finish(
    id: string,
    target: Uri | undefined,
    bytes: number,
    handle: StreamHandle,
    chosenFormat?: string,
  ): Promise<void> {
    const task = this.byId(id)
    if (!task) return
    let bindingId: string | undefined

    if (target && handle.kind === 'remote') {
      const binding = bindingIdOf(task.trackUrn)
      bindingId = binding
      const format = chosenFormat ?? formatFor(handle)
      const stale = await this.ownCtx.db.query<{ uri: Uri }>(
        `SELECT uri FROM media_bindings WHERE track_urn = ? AND origin = 'download'`,
        [task.trackUrn],
      )
      await this.ownCtx.db.transaction(async (tx) => {
        await tx.exec(`DELETE FROM media_bindings WHERE track_urn = ? AND origin = 'download'`, [
          task.trackUrn,
        ])
        await tx.exec(
          `INSERT INTO media_bindings (id, track_urn, uri, format, bitrate_kbps, sample_rate,
                                       size_bytes, origin, quality, verified_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'download', ?, ?, ?)`,
          [
            binding,
            task.trackUrn,
            target,
            format ?? null,
            handle.bitrateKbps ?? null,
            handle.sampleRate ?? null,
            bytes,
            handle.quality ?? null,
            Date.now(),
            task.createdAt,
          ],
        )
      })
      // Files first, rows first, doesn't matter much — but a stale row
      // replaced by one pointing at a new path leaves the old bytes behind
      // unless they are removed explicitly.
      for (const row of stale) {
        if (row.uri !== target) await this.ownCtx.fs.remove(row.uri).catch(() => undefined)
      }
      this.ownCtx.logger.info(
        `download: saved ${task.trackUrn} (${bytes} byte(s)${format ? ` as ${format}` : ''})`,
      )
    }

    this.publishProgress(id, bytes, bytes)
    await this.setState(id, 'done', {
      bytesDone: bytes,
      bytesTotal: bytes,
      error: undefined,
      ...(bindingId ? { bindingId } : {}),
    })
    if (bindingId) this.safeEmit(() => this.ownCtx.emit('download/completed', id, bindingId))
    const i18n = this.ownCtx.get('i18n') as { t?(k: string, p?: Record<string, unknown>): string } | undefined
    const toastCompleted = i18n?.t?.('download:download.downloadCompleted', { title: task.title }) ?? `下载完成: ${task.title}`
    this.safeEmit(() => this.ownCtx.emit('ui/toast', { message: toastCompleted, tone: 'ok' }))
  }

  private async fail(id: string, error: unknown): Promise<void> {
    const task = this.byId(id)
    if (!task) return
    const message = error instanceof Error ? error.message : String(error)
    const bytes = await this.actualBytes(id)
    this.ownCtx.logger.warn(`download: ${task.trackUrn} failed: ${message}`)
    await this.ownCtx.db
      .exec('UPDATE download_tasks SET attempts = attempts + 1 WHERE id = ?', [id])
      .catch(() => undefined)
    await this.updateRow(id, { bytes_done: bytes })
    this.patch(id, { bytesDone: bytes })
    await this.setState(id, 'failed', { error: message })
    this.safeEmit(() =>
      this.ownCtx.emit('download/failed', id, error instanceof Error ? error : new Error(message)),
    )
  }

  /* ── housekeeping ──────────────────────────────────────────────────── */

  /**
   * Reset what a kill left behind.
   *
   * docs/07 §4.8: a `running` task is a queued one after a restart. And a
   * `bytes_done` whose partial file is gone is worse than useless — resuming
   * from it would append a ranged response to an empty file — so the counter
   * is zeroed when the bytes are not there.
   */
  private async reconcile(): Promise<void> {
    const now = Date.now()
    await this.ownCtx.db.exec(
      `UPDATE download_tasks SET state = 'queued', updated_at = ? WHERE state = 'running'`,
      [now],
    )
    const open = await this.ownCtx.db.query<{ id: string; target_uri: Uri; bytes_done: number }>(
      `SELECT id, target_uri, bytes_done FROM download_tasks WHERE state != 'done' AND bytes_done > 0`,
    )
    for (const row of open) {
      if (await this.ownCtx.fs.exists(row.target_uri).catch(() => false)) continue
      await this.ownCtx.db.exec(
        `UPDATE download_tasks SET bytes_done = 0, updated_at = ? WHERE id = ?`,
        [now, row.id],
      )
      this.ownCtx.logger.info(`download: ${row.id} had no partial file; restarting from zero`)
    }
  }

  /**
   * Drop the playback cache a build before `plugin-cache` wrote.
   *
   * Those copies live under `ctx.paths.cache/media` and were registered here
   * as ordinary `origin: 'download'` bindings, with a `download_tasks` row
   * each. Keeping them would shadow `plugin-cache`'s listener for ever — the
   * prepended download hit answers first — so they are removed once, with
   * their tasks and files. A user's kept downloads (under the downloads
   * directory) are never touched.
   *
   * The played files are not re-downloaded: the next resolve streams, and
   * `plugin-cache` caches it again under its own roof.
   */
  private async forgetLegacyCache(): Promise<void> {
    const [bindings, tasks] = await Promise.all([
      this.ownCtx.db.query<{ id: string; uri: Uri }>(
        `SELECT id, uri FROM media_bindings WHERE origin = 'download'`,
      ),
      this.ownCtx.db.query<{ id: string; target_uri: Uri }>(
        `SELECT id, target_uri FROM download_tasks`,
      ),
    ])
    const legacyTasks = tasks.filter((row) => !this.isKept(row.target_uri))
    const legacyBindings = bindings.filter((row) => !this.isKept(row.uri))
    if (legacyTasks.length === 0 && legacyBindings.length === 0) return

    await this.ownCtx.db.transaction(async (tx) => {
      for (const row of legacyTasks) await tx.exec('DELETE FROM download_tasks WHERE id = ?', [row.id])
      for (const row of legacyBindings) {
        await tx.exec('DELETE FROM media_bindings WHERE id = ?', [row.id])
      }
    })
    for (const uri of [
      ...legacyBindings.map((row) => row.uri),
      ...legacyTasks.map((row) => row.target_uri),
    ]) {
      await this.ownCtx.fs.remove(uri).catch(() => undefined)
    }
    this.ownCtx.logger.info(
      `download: dropped ${legacyBindings.length} legacy cache entr(ies); plugin-cache owns playback copies now`,
    )
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  private async refresh(): Promise<void> {
    const rows = await this.ownCtx.db.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM download_tasks d
         LEFT JOIN tracks tr ON tr.urn = d.track_urn
        ORDER BY CASE d.state
                   WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2
                   WHEN 'failed' THEN 3 WHEN 'canceled' THEN 4 ELSE 5 END,
                 d.priority DESC,
                 d.created_at ASC`,
    )
    this.list = rows.map((row) =>
      toTask(row, this.isKept(row.target_uri), this.hold, this.trackMetaOverrides.get(row.track_urn)),
    )
    this.targets.clear()
    this.etags.clear()
    for (const row of rows) {
      this.targets.set(row.id, row.target_uri)
      if (row.etag) this.etags.set(row.id, row.etag)
    }
  }

  private byId(id: string): DownloadTask | undefined {
    return this.list.find((task) => task.id === id)
  }

  private targetFor(id: string): Uri {
    return this.targets.get(id) ?? this.ownCtx.fs.join(this.keptDir, id)
  }

  private isKept(uri: Uri): boolean {
    return uriContains(this.keptDir, uri)
  }

  private fileFor(urn: string, meta?: DownloadTrackMeta): Uri {
    const existing = this.list.find((t) => t.trackUrn === urn)
    const title = meta?.title || existing?.title
    const safe = title ? sanitizeFileName(title) : bindingIdOf(urn)
    return this.ownCtx.fs.join(this.keptDir, safe)
  }

  private async lookupTrackMetadata(urn: string): Promise<{
    title?: string
    artist?: string
    album?: string
    year?: number
    trackNo?: number
    artworkLocalUri?: string
    artworkSourceUrl?: string
    artworkId?: string
    rawJson?: string
  } | undefined> {
    let title: string | undefined
    let artist: string | undefined
    let album: string | undefined
    let year: number | undefined
    let trackNo: number | undefined
    let artworkLocalUri: string | undefined
    let artworkSourceUrl: string | undefined
    let artworkId: string | undefined
    let albumUrn: string | undefined
    let rawJson: string | undefined

    // 1. Try SQLite query
    try {
      const row = await this.ownCtx.db.get<{
        title: string
        year: number | null
        track_no: number | null
        album_title: string | null
        album_urn: string | null
        artist_name: string | null
        artwork_local_uri: string | null
        artwork_source_url: string | null
        artwork_id: string | null
        track_artwork_id: string | null
        album_artwork_id: string | null
        raw_json: string | null
      }>(
        `SELECT tr.title, tr.year, tr.track_no, tr.album_urn, tr.raw_json,
                al.title AS album_title,
                aw.local_uri AS artwork_local_uri,
                aw.source_url AS artwork_source_url,
                aw.id AS artwork_id,
                tr.artwork_id AS track_artwork_id,
                al.artwork_id AS album_artwork_id,
                (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                  WHERE ta.track_urn = tr.urn ORDER BY ta.ordinal LIMIT 1) AS artist_name
           FROM tracks tr
           LEFT JOIN albums al ON al.urn = tr.album_urn
           LEFT JOIN artworks aw ON aw.id = COALESCE(tr.artwork_id, al.artwork_id)
          WHERE tr.urn = ?`,
        [urn],
      )

      if (row) {
        title = row.title || undefined
        artist = row.artist_name || undefined
        album = row.album_title || undefined
        year = row.year ?? undefined
        trackNo = row.track_no ?? undefined
        artworkLocalUri = row.artwork_local_uri || undefined
        albumUrn = row.album_urn || undefined
        rawJson = row.raw_json || undefined

        if (!artist && rawJson) {
          artist = extractArtistFromRaw(rawJson)
        }

        if (isUrl(row.artwork_source_url)) {
          artworkSourceUrl = row.artwork_source_url
        } else if (isUrl(row.artwork_id)) {
          artworkSourceUrl = row.artwork_id
        } else if (isUrl(row.track_artwork_id)) {
          artworkSourceUrl = row.track_artwork_id
        } else if (isUrl(row.album_artwork_id)) {
          artworkSourceUrl = row.album_artwork_id
        }
        artworkId = row.artwork_id || row.track_artwork_id || row.album_artwork_id || undefined

        if (!artworkSourceUrl && rawJson) {
          const fromRaw = extractArtworkUrlFromRaw(rawJson)
          if (fromRaw && isUrl(fromRaw)) artworkSourceUrl = fromRaw
        }
      }
    } catch {
      // Ignore query errors
    }

    // 2. Fallback to active source provider if artwork, title or artist is missing
    if (!artist || !title || (!artworkSourceUrl && !artworkLocalUri)) {
      try {
        const provider = this.ownCtx.sources?.forUrn(urn)
        if (provider) {
          const { id } = parseUrn(urn)
          const track = await provider.getTrack(id).catch(() => undefined)
          if (track) {
            title = title ?? (track.title || undefined)
            if (!artist && track.artists?.length) {
              artist = track.artists.map((a) => a.name).filter(Boolean).join(', ')
            }
            if (!artist) {
              const rawFromTrack = (track as unknown as Record<string, unknown>)?.raw
              if (rawFromTrack) artist = extractArtistFromRaw(rawFromTrack)
            }
            album = album ?? (track.albumTitle || undefined)
            year = year ?? track.year
            trackNo = trackNo ?? track.trackNo
            albumUrn = albumUrn ?? track.albumUrn

            if (!artworkSourceUrl && !artworkLocalUri) {
              const art = track.artwork
              const artUrl = art?.sourceUrl || art?.id
              if (isUrl(artUrl)) {
                artworkSourceUrl = artUrl
                artworkId = art?.id
              }
            }
          }
        }
      } catch (err) {
        this.ownCtx.logger.warn(`download: provider.getTrack failed for ${urn}: ${String(err)}`)
      }
    }

    // 3. Fallback to album lookup if artwork is still missing
    if (!artworkSourceUrl && !artworkLocalUri && albumUrn) {
      try {
        const alRow = await this.ownCtx.db
          .get<{ source_url: string | null; local_uri: string | null; id: string | null }>(
            `SELECT aw.source_url, aw.local_uri, aw.id
               FROM albums al
               JOIN artworks aw ON aw.id = al.artwork_id
              WHERE al.urn = ?`,
            [albumUrn],
          )
          .catch(() => undefined)
        if (alRow) {
          if (alRow.local_uri) artworkLocalUri = alRow.local_uri
          if (isUrl(alRow.source_url)) artworkSourceUrl = alRow.source_url
          if (alRow.id) artworkId = alRow.id
        }
      } catch {
        // continue
      }
    }

    if (!artworkSourceUrl && !artworkLocalUri && albumUrn) {
      try {
        const sources = this.ownCtx.sources as unknown as {
          getAlbum?(albumUrn: string): Promise<{ artwork?: { id?: string; sourceUrl?: string } }>
        }
        if (sources && typeof sources.getAlbum === 'function') {
          const albumDetail = await sources.getAlbum(albumUrn).catch(() => undefined)
          const albumArt = albumDetail?.artwork?.sourceUrl || albumDetail?.artwork?.id
          if (isUrl(albumArt)) {
            artworkSourceUrl = albumArt
            artworkId = albumDetail?.artwork?.id
          }
        }
      } catch {
        // continue
      }
    }

    // 4. Fallback to track's artwork_id directly if artwork is still missing
    if (!artworkSourceUrl && !artworkLocalUri) {
      try {
        const trArtRow = await this.ownCtx.db
          .get<{ source_url: string | null; local_uri: string | null; id: string | null }>(
            `SELECT aw.source_url, aw.local_uri, aw.id
               FROM tracks tr
               JOIN artworks aw ON aw.id = tr.artwork_id
              WHERE tr.urn = ?`,
            [urn],
          )
          .catch(() => undefined)
        if (trArtRow) {
          if (trArtRow.local_uri) artworkLocalUri = trArtRow.local_uri
          if (isUrl(trArtRow.source_url)) artworkSourceUrl = trArtRow.source_url
          if (trArtRow.id) artworkId = trArtRow.id
        }
      } catch {
        // continue
      }
    }

    if (!title && !artist && !artworkSourceUrl && !artworkLocalUri && !rawJson) {
      return undefined
    }

    return {
      title,
      artist,
      album,
      year,
      trackNo,
      artworkLocalUri,
      artworkSourceUrl,
      artworkId,
      rawJson,
    }
  }

  private async fetchCoverBytes(
    trackMeta: {
      artworkLocalUri?: string
      artworkSourceUrl?: string
      artworkId?: string
      rawJson?: string
      raw?: unknown
    } | undefined,
    streamHeaders?: Record<string, string>,
  ): Promise<{ data: Uint8Array; mimeType?: string } | undefined> {
    if (!trackMeta) return undefined

    // 1. Check local artwork URI
    if (trackMeta.artworkLocalUri) {
      try {
        const bytes = await this.ownCtx.fs.readBytes(trackMeta.artworkLocalUri)
        if (bytes && bytes.length > 0) {
          return { data: bytes }
        }
      } catch (err) {
        this.ownCtx.logger.warn(`download: failed to read local artwork URI ${trackMeta.artworkLocalUri}: ${String(err)}`)
      }
    }

    // 2. Extract URL from artworkSourceUrl or rawJson or raw
    let url =
      trackMeta.artworkSourceUrl?.trim() ||
      extractArtworkUrlFromRaw(trackMeta.rawJson) ||
      extractArtworkUrlFromRaw(trackMeta.raw)
    if (!url) return undefined

    // Normalize protocol-relative URLs
    if (url.startsWith('//')) {
      url = 'https:' + url
    }

    // 3. Local file or file URI
    if (url.startsWith('file:') || url.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(url)) {
      try {
        const bytes = await this.ownCtx.fs.readBytes(url)
        if (bytes && bytes.length > 0) return { data: bytes }
      } catch (err) {
        this.ownCtx.logger.warn(`download: failed to read local artwork file ${url}: ${String(err)}`)
      }
    }

    // 4. Data URI
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/)
      if (match && match[2]) {
        try {
          const binary = atob(match[2])
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          return { data: bytes, mimeType: match[1] }
        } catch {
          return undefined
        }
      }
    }

    // 5. Try plugin-cache if available
    const cache = this.ownCtx.get('cache') as unknown as {
      artwork?(ref: ArtworkRef): Promise<Uri | undefined>
    } | undefined
    if (cache && typeof cache.artwork === 'function') {
      try {
        const ref: ArtworkRef = {
          id: trackMeta.artworkId || url,
          sourceUrl: url,
        }
        const cachedUri = await cache.artwork(ref)
        if (cachedUri) {
          const bytes = await this.ownCtx.fs.readBytes(cachedUri)
          if (bytes && bytes.length > 0) {
            return { data: bytes }
          }
        }
      } catch (err) {
        this.ownCtx.logger.warn(`download: cache.artwork error for ${url}: ${String(err)}`)
      }
    }

    // 6. Direct HTTP fetch with headers
    if (/^https?:\/\//i.test(url)) {
      const headers = buildCoverHeaders(url, streamHeaders)
      // Try ctx.http
      try {
        if (typeof this.ownCtx.http === 'function') {
          const res = await this.ownCtx.http({ url, headers })
          if (res.status === 200) {
            const bytes = await res.bytes()
            if (bytes && bytes.length > 0) {
              return { data: bytes, mimeType: res.headers['content-type'] }
            }
          }
        }
      } catch (err) {
        this.ownCtx.logger.warn(`download: ctx.http failed for cover ${url}: ${String(err)}`)
      }

      // Fallback to global fetch
      try {
        if (typeof globalThis.fetch === 'function') {
          const res = await globalThis.fetch(url, { headers })
          if (res.ok) {
            const arrBuf = await res.arrayBuffer()
            const bytes = new Uint8Array(arrBuf)
            if (bytes.length > 0) {
              return { data: bytes, mimeType: res.headers.get('content-type') ?? undefined }
            }
          }
        }
      } catch (err) {
        this.ownCtx.logger.warn(`download: global fetch failed for cover ${url}: ${String(err)}`)
      }
    }

    return undefined
  }

  private async ensureTrackRow(
    urn: string,
    meta?: {
      title?: string
      artist?: string
      artists?: readonly ArtistCredit[] | readonly { name: string; role?: string; urn?: string }[]
      album?: string
      albumTitle?: string
      albumUrn?: string
      year?: number
      trackNo?: number
      artwork?: ArtworkRef | { id?: string; sourceUrl?: string }
      artworkUrl?: string
      artworkSourceUrl?: string
      artworkLocalUri?: string
      artworkId?: string
      raw?: unknown
    },
  ): Promise<void> {
    if (typeof urn !== 'string' || !urn.trim() || urn === '[object Object]') return
    const parsed = tryParseUrn(urn) ?? {
      sourceId: 'unknown',
      kind: 'track' as const,
      id: urn,
    }
    const now = Date.now()
    try {
      const artworkUrl =
        meta?.artworkUrl ||
        meta?.artworkSourceUrl ||
        meta?.artwork?.sourceUrl ||
        (isUrl(meta?.artwork?.id) ? meta.artwork.id : undefined)
      let artworkId =
        meta?.artworkId ||
        (meta?.artwork?.id && !isUrl(meta?.artwork?.id) ? meta.artwork.id : undefined)

      if (artworkUrl) {
        artworkId = artworkId || `aw_${stableId(artworkUrl).slice(0, 16)}`
        await this.ownCtx.db
          .exec(
            `INSERT INTO artworks (id, source_url, local_uri, fetched_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               source_url = COALESCE(artworks.source_url, excluded.source_url),
               local_uri = COALESCE(artworks.local_uri, excluded.local_uri)`,
            [artworkId, artworkUrl, meta?.artworkLocalUri ?? null, now],
          )
          .catch((e: unknown) => this.ownCtx.logger.warn(`download: could not insert artwork: ${String(e)}`))
      }

      const rawJson = meta?.raw
        ? typeof meta.raw === 'string'
          ? meta.raw
          : JSON.stringify(meta.raw)
        : null

      await this.ownCtx.db.exec(
        `INSERT INTO tracks (urn, source_id, remote_id, title, year, track_no, artwork_id, raw_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(urn) DO UPDATE SET
           title = CASE
             WHEN excluded.title IS NOT NULL AND excluded.title != '' AND excluded.title != tracks.urn AND excluded.title != tracks.remote_id THEN excluded.title
             WHEN tracks.title IS NULL OR tracks.title = '' OR tracks.title = tracks.urn OR tracks.title = tracks.remote_id THEN excluded.title
             ELSE tracks.title
           END,
           year = COALESCE(excluded.year, tracks.year),
           track_no = COALESCE(excluded.track_no, tracks.track_no),
           artwork_id = COALESCE(excluded.artwork_id, tracks.artwork_id),
           raw_json = COALESCE(excluded.raw_json, tracks.raw_json)`,
        [
          urn,
          parsed.sourceId,
          parsed.id,
          meta?.title || parsed.id,
          meta?.year ?? null,
          meta?.trackNo ?? null,
          artworkId ?? null,
          rawJson,
          now,
        ],
      )

      const albumTitle = meta?.album || meta?.albumTitle
      if (albumTitle) {
        const albumUrn =
          meta?.albumUrn || `urn:bbebee:album:${parsed.sourceId}:${encodeURIComponent(albumTitle)}`
        await this.ownCtx.db
          .exec(
            `INSERT INTO albums (urn, source_id, remote_id, title, artwork_id, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(urn) DO UPDATE SET
               title = excluded.title,
               artwork_id = COALESCE(albums.artwork_id, excluded.artwork_id)`,
            [albumUrn, parsed.sourceId, albumTitle, albumTitle, artworkId ?? null, now],
          )
          .catch((e: unknown) => this.ownCtx.logger.warn(`download: could not insert album: ${String(e)}`))
        await this.ownCtx.db
          .exec(`UPDATE tracks SET album_urn = COALESCE(album_urn, ?) WHERE urn = ?`, [albumUrn, urn])
          .catch(() => undefined)
      }

      if (meta?.artists && Array.isArray(meta.artists) && meta.artists.length > 0) {
        for (let i = 0; i < meta.artists.length; i++) {
          const a = meta.artists[i]
          if (!a || typeof a !== 'object') continue
          const aObj = a as { name?: string; role?: string; urn?: string }
          if (!aObj.name) continue
          const artistUrn =
            aObj.urn || `urn:bbebee:artist:${parsed.sourceId}:${encodeURIComponent(aObj.name)}`
          await this.ownCtx.db
            .exec(
              `INSERT INTO artists (urn, source_id, remote_id, name, fetched_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(urn) DO UPDATE SET name = excluded.name`,
              [artistUrn, parsed.sourceId, aObj.name, aObj.name, now],
            )
            .catch(() => undefined)
          await this.ownCtx.db
            .exec(
              `INSERT INTO track_artists (track_urn, artist_urn, role, ordinal)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(track_urn, artist_urn, role) DO UPDATE SET ordinal = excluded.ordinal`,
              [urn, artistUrn, aObj.role || 'main', i],
            )
            .catch(() => undefined)
        }
      } else if (meta?.artist) {
        const hasArtist = await this.ownCtx.db
          .get<{ count: number }>('SELECT count(1) AS count FROM track_artists WHERE track_urn = ?', [urn])
          .catch(() => ({ count: 0 }))
        if (!hasArtist || hasArtist.count === 0) {
          const artistUrn = `urn:bbebee:artist:${parsed.sourceId}:${encodeURIComponent(meta.artist)}`
          await this.ownCtx.db
            .exec(
              `INSERT INTO artists (urn, source_id, remote_id, name, fetched_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(urn) DO UPDATE SET name = excluded.name`,
              [artistUrn, parsed.sourceId, meta.artist, meta.artist, now],
            )
            .catch((e: unknown) => this.ownCtx.logger.warn(`download: could not insert artist: ${String(e)}`))
          await this.ownCtx.db
            .exec(
              `INSERT INTO track_artists (track_urn, artist_urn, role, ordinal)
               VALUES (?, ?, 'main', 0)
               ON CONFLICT(track_urn, artist_urn, role) DO UPDATE SET ordinal = excluded.ordinal`,
              [urn, artistUrn],
            )
            .catch((e: unknown) => this.ownCtx.logger.warn(`download: could not insert track_artist: ${String(e)}`))
        }
      }
    } catch (err) {
      this.ownCtx.logger.warn(`download: could not ensure track row for ${urn}: ${String(err)}`)
    }
  }

  /** The partial file's actual size, which is what a resume must start from. */
  private async actualBytes(id: string): Promise<number> {
    const stat = await this.ownCtx.fs.stat(this.targetFor(id)).catch(() => undefined)
    return stat && !stat.isDirectory ? stat.size : 0
  }

  private patch(id: string, fields: Partial<DownloadTask>): void {
    this.list = this.list.map((task) => (task.id === id ? { ...task, ...fields } : task))
  }

  private async setState(
    id: string,
    state: DownloadState,
    extra: Partial<DownloadTask> = {},
  ): Promise<void> {
    const now = Date.now()
    const cleared = state === 'queued' || state === 'running' || state === 'done'
    this.patch(id, {
      state,
      ...extra,
      ...(cleared ? { error: undefined } : {}),
      blocked: this.holdFor(state),
      updatedAt: now,
      ...(state === 'done' || state === 'failed' || state === 'canceled' ? { finishedAt: now } : {}),
    })
    await this.updateRow(id, {
      state,
      ...(extra.bytesDone !== undefined ? { bytes_done: extra.bytesDone } : {}),
      ...(extra.bytesTotal !== undefined ? { bytes_total: extra.bytesTotal } : {}),
      ...(extra.bindingId !== undefined ? { binding_id: extra.bindingId } : {}),
      ...(extra.error !== undefined ? { last_error: extra.error } : {}),
      ...(cleared ? { last_error: null } : {}),
      ...(state === 'done' || state === 'failed' || state === 'canceled' ? { finished_at: now } : {}),
    })
    this.emitChanged()
  }

  private async updateRow(
    id: string,
    fields: Partial<
      Record<
        | 'state'
        | 'bytes_done'
        | 'bytes_total'
        | 'etag'
        | 'last_error'
        | 'binding_id'
        | 'finished_at'
        | 'attempts'
        | 'target_uri',
        SqlValue
      >
    >,
  ): Promise<void> {
    const entries = Object.entries(fields)
    if (entries.length === 0) return
    entries.push(['updated_at', Date.now()])
    await this.ownCtx.db
      .exec(
        `UPDATE download_tasks SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, value]) => value), id],
      )
      .catch((error: unknown) => {
        // A lost checkpoint costs resume distance, not correctness.
        this.ownCtx.logger.warn(`download: could not checkpoint ${id}: ${String(error)}`)
      })
  }

  private async checkpoint(id: string, done: number, total: number | undefined): Promise<void> {
    await this.updateRow(id, {
      bytes_done: done,
      ...(total !== undefined ? { bytes_total: total } : {}),
    })
  }

  private publishProgress(id: string, done: number, total: number | undefined): void {
    if (!this.byId(id)) return
    this.patch(id, { bytesDone: done, ...(total !== undefined ? { bytesTotal: total } : {}) })
    const record = this.controllers.get(id)
    if (!record) return
    const now = Date.now()
    if (now - record.lastEmit < PROGRESS_EMIT_MS) return
    record.lastEmit = now
    this.safeEmit(() => this.ownCtx.emit('download/progress', id, done, total))
  }

  private abort(id: string, intent: 'pause' | 'cancel'): void {
    const record = this.controllers.get(id)
    if (!record) return
    record.intent = intent
    record.controller.abort()
  }

  private emitChanged(): void {
    this.safeEmit(() => this.ownCtx.emit('download/changed'))
  }

  /**
   * Emit without letting a listener's failure reach the caller.
   *
   * Only for emits on a path that has already committed: the row is written
   * and the caller is owed its answer, so a subscriber throwing is a fault to
   * log, not one to propagate.
   */
  private safeEmit(emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.ownCtx.logger.warn(`download: an event listener threw: ${String(error)}`)
    }
  }
}

/** One binding id per track, stable across restarts. */
function bindingIdOf(urn: string): string {
  return `bd_${stableId('download', urn)}`
}

/** Container formats this app can name, and the spellings a source may use. */
const MIME_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
}

const URL_FORMATS = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'm4s', 'mp4',
])

/**
 * The file extension a stream should be cached under, where one can be told.
 *
 * Recorded on the binding as `format`, and used by a media element for a file
 * too large to decode in memory. `undefined` is an honest answer for a source
 * that names no codec and serves a URL with no extension — the buffer path
 * (the common case) decodes it anyway.
 */
export function formatFor(handle: StreamHandle): string | undefined {
  const codec = handle.codec?.toLowerCase() ?? ''
  if (codec.includes('flac')) return 'flac'
  if (codec.includes('mp4a') || codec.includes('aac')) return 'm4a'
  if (codec.includes('mpeg')) return 'mp3'
  if (codec.includes('opus')) return 'opus'
  if (codec.includes('vorbis')) return 'ogg'
  if (codec.includes('wav')) return 'wav'

  const byMime = handle.mimeType ? MIME_FORMATS[handle.mimeType.toLowerCase()] : undefined
  if (byMime) return byMime

  const path = handle.target.split('?')[0]?.split('#')[0] ?? ''
  const dot = path.lastIndexOf('.')
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  // An fMP4 segment is the audio of an MP4; `.m4s` is not a name a decoder
  // recognises on its own.
  if (extension === 'm4s' || extension === 'mp4') return 'm4a'
  return URL_FORMATS.has(extension) ? extension : undefined
}

export const name = 'plugin-download'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.downloads` is usable.
 */
export async function apply(ctx: Context, config: DownloadsConfig = {}) {
  ctx.logger.info('plugin-download: loaded')
  const fiber = await ctx.plugin(Downloads, config)
  return () => void fiber.dispose()
}

export default { name, apply }
