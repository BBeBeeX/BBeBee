/**
 * `ctx.lyrics` — lyric retrieval, caching, synchronization and unified state.
 *
 * Coordinates lyric documents from sources, SQLite cache, and local files,
 * serving both the lyrics panel and the desktop floating lyrics.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  LyricSearchQuery,
  LyricSourcesService,
  Lyrics,
  LyricsService,
  LyricsState,
  TransportState,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { findActiveLyricIndex, parseLrc, type ParsedLyrics } from '@BBeBee/toolkit'

export interface LyricsConfig {
  /** In-memory cache size limit for lyrics documents. */
  cacheSize?: number
  /** Negative cache TTL in ms for tracks without lyrics. Defaults to 24 hours (86_400_000 ms). */
  negativeCacheTtlMs?: number
}

const DEFAULT_CACHE_SIZE = 100
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

/**
 * Clean track title noise (such as "(2021 Remastered)", "[Live]", "(feat. ...)", etc.)
 * to maximize match probability on external lyric databases.
 */
export function cleanTrackTitle(title: string): string {
  if (!title) return ''
  return title
    .replace(
      /\s*(?:\(|\[)(?:(?:19|20)\d\d\s+)?(?:remaster(?:ed)?.*|live.*|explicit.*|deluxe.*|bonus(?:\s+track)?.*|anniversary.*|edit.*|mix.*|version.*|feat\.?.*)(?:\s+(?:19|20)\d\d)?(?:\)|\])\s*$/gi,
      '',
    )
    .replace(
      /\s*-\s*(?:(?:19|20)\d\d\s+)?(?:remaster(?:ed)?.*|live.*|deluxe.*|bonus(?:\s+track)?.*|anniversary.*|edit.*|mix.*|version.*)(?:\s+(?:19|20)\d\d)?\s*$/gi,
      '',
    )
    .trim()
}

export class LyricsPlugin extends Service implements LyricsService {
  static inject = ['player', 'db', 'sources']

  private readonly ownCtx: Context
  private readonly memoryCache = new Map<string, Lyrics>()
  private readonly parsedCache = new Map<string, ParsedLyrics>()
  private readonly negativeCache = new Map<string, number>()
  private readonly inFlightFetches = new Map<string, Promise<Lyrics | undefined>>()
  private readonly lastSearchedMeta = new Map<string, { title?: string; artist?: string }>()
  private readonly lastResolvedSourceType = new Map<string, LyricsState['sourceType']>()
  private readonly cacheSize: number
  private readonly negativeCacheTtlMs: number
  private currentGeneration = 0
  private lastActiveIndex = -1
  private ticker?: ReturnType<typeof setInterval>

  private currentState: LyricsState = {
    status: 'idle',
    offsetMs: 0,
  }
  private lyricSourcesService?: LyricSourcesService

  constructor(ctx: Context, config: LyricsConfig = {}) {
    super(ctx, 'lyrics')
    this.ownCtx = ctx
    this.cacheSize = config.cacheSize ?? DEFAULT_CACHE_SIZE
    this.negativeCacheTtlMs = config.negativeCacheTtlMs ?? DEFAULT_NEGATIVE_CACHE_TTL_MS

    this.ownCtx.inject(['lyricSources'], (scoped: Context) => {
      this.lyricSourcesService = scoped.lyricSources
      if (
        this.currentState.trackUrn &&
        (this.currentState.status === 'no-lyrics' ||
          this.currentState.status === 'error' ||
          !this.currentState.lyrics)
      ) {
        void this.retry()
      }
      return () => {
        this.lyricSourcesService = undefined
      }
    })
  }

  private getLyricSourcesService(): LyricSourcesService | undefined {
    return (
      this.lyricSourcesService ??
      ((this.ownCtx as unknown as { reflect?: { get(key: string, required?: boolean): unknown } })
        .reflect?.get?.('lyricSources', false) as LyricSourcesService | undefined)
    )
  }

  /**
   * Determine whether the given track's audio source supports third-party lyric sources.
   * - Local files: true (no built-in online lyrics, supports external lyric sources).
   * - Audio source documents: respects `needsLyricSource` if set, otherwise defaults to `!ruleLyric`.
   * - Unregistered/unknown: true.
   */
  doesTrackSourceSupportLyricSources(trackUrn: string): boolean {
    const parsedUrn = tryParseUrn(trackUrn)
    if (!parsedUrn) return true

    if (parsedUrn.sourceId === 'local') {
      return true
    }

    const sourceRecord = this.ownCtx.sources?.source
      ? this.ownCtx.sources.source(parsedUrn.sourceId)
      : undefined

    if (sourceRecord) {
      if (sourceRecord.needsLyricSource !== undefined) {
        return Boolean(sourceRecord.needsLyricSource)
      }
      return !sourceRecord.doc?.ruleLyric
    }

    return true
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-lyrics: initialized')

    // Contribute the lyrics panel view to the now-playing.panel slot
    this.ownCtx.inject(['ui'], (scoped: Context) =>
      scoped.effect(function* () {
        scoped.logger.debug('lyrics: contributing now-playing.panel slot')
        yield scoped.ui.contribute({
          kind: 'slot',
          id: 'lyrics.panel',
          slot: 'now-playing.panel',
          order: 10,
        })
      }, 'lyrics-ui-contributions'),
    )

    // Handle initial track state if player is already loaded
    const initialUrn = this.ownCtx.player?.state?.trackUrn
    if (initialUrn) {
      void this.handleTrackChanged(initialUrn)
    }

    // Listen to track changes from player
    const offTrackChanged = this.ownCtx.on(
      'player/track-changed',
      (trackUrn: string | undefined) => {
        void this.handleTrackChanged(trackUrn)
      },
    )

    // Listen to player transport state changes (loading, stopped, metadata updates, etc.)
    const offStateChanged = this.ownCtx.on('player/state-changed', (transport: TransportState) => {
      if (transport.status === 'loading' && !this.currentState.trackUrn) {
        this.updateState({ status: 'loading-song' })
      } else if (transport.status === 'idle' && !transport.trackUrn) {
        this.updateState({ status: 'idle', trackUrn: undefined, lyrics: undefined, error: undefined })
      } else if (
        transport.trackUrn &&
        transport.trackUrn === this.currentState.trackUrn &&
        transport.nowPlaying?.title &&
        !this.currentState.lyrics &&
        this.currentState.status !== 'loading-lyrics' &&
        !this.inFlightFetches.has(transport.trackUrn)
      ) {
        // Only trigger if title/artist has genuinely changed from what was already searched
        const lastMeta = this.lastSearchedMeta.get(transport.trackUrn)
        const isNewMetadata =
          !lastMeta ||
          lastMeta.title !== transport.nowPlaying.title ||
          (transport.nowPlaying.artist && lastMeta.artist !== transport.nowPlaying.artist)

        if (isNewMetadata) {
          this.lastSearchedMeta.set(transport.trackUrn, {
            title: transport.nowPlaying.title,
            artist: transport.nowPlaying.artist,
          })
          const gen = ++this.currentGeneration
          void this.fetchAndApplyLyrics(transport.trackUrn, gen, transport.nowPlaying)
        }
      }
    })

    // Listen to audio source policy changes (needsLyricSource toggled in settings)
    const offSourceChanged = this.ownCtx.on('source/changed', (sourceId: string, fields: string[]) => {
      if (fields?.includes('needsLyricSource') && this.currentState.trackUrn) {
        const parsed = tryParseUrn(this.currentState.trackUrn)
        if (parsed?.sourceId === sourceId) {
          void this.retry()
        }
      }
    })

    // Listen to third-party lyric sources list changes (added, removed, toggled in settings)
    const offLyricSourcesChanged = this.ownCtx.on('lyric-sources/changed', () => {
      if (
        this.currentState.trackUrn &&
        (this.currentState.status === 'no-lyrics' ||
          this.currentState.status === 'error' ||
          !this.currentState.lyrics)
      ) {
        void this.retry()
      }
    })

    // Listen to 1Hz position ticks from player for synchronization
    const offPosition = this.ownCtx.on('player/position', (positionMs: number) => {
      this.syncActiveIndex(positionMs)
    })

    return () => {
      this.ownCtx.logger.info('plugin-lyrics: disposing')
      if (this.ticker) clearInterval(this.ticker)
      offTrackChanged()
      offStateChanged()
      offSourceChanged()
      offLyricSourcesChanged()
      offPosition()
    }
  }

  get state(): Readonly<LyricsState> {
    return this.currentState
  }

  private updateState(patch: Partial<LyricsState>): void {
    this.currentState = { ...this.currentState, ...patch }
    this.ownCtx.emit('lyrics/changed', this.currentState)
  }

  private async handleTrackChanged(
    trackUrn: string | undefined,
    presetMetadata?: { title?: string; artist?: string; durationMs?: number },
  ): Promise<void> {
    const gen = ++this.currentGeneration
    this.lastActiveIndex = -1
    this.ownCtx.emit('lyrics/active-changed', -1)

    if (!trackUrn) {
      this.updateState({
        status: 'idle',
        trackUrn: undefined,
        lyrics: undefined,
        error: undefined,
        supportsLyricSource: undefined,
        sourceType: undefined,
        offsetMs: 0,
      })
      return
    }

    if (presetMetadata?.title) {
      this.lastSearchedMeta.set(trackUrn, {
        title: presetMetadata.title,
        artist: presetMetadata.artist,
      })
    } else {
      this.lastSearchedMeta.delete(trackUrn)
    }

    const supportsLyricSource = this.doesTrackSourceSupportLyricSources(trackUrn)

    this.updateState({
      status: 'loading-lyrics',
      trackUrn,
      lyrics: undefined,
      supportsLyricSource,
      sourceType: undefined,
      error: undefined,
      offsetMs: 0,
    })

    await this.fetchAndApplyLyrics(trackUrn, gen, presetMetadata)
  }

  private async fetchAndApplyLyrics(
    trackUrn: string,
    gen: number,
    presetMetadata?: { title?: string; artist?: string; durationMs?: number },
  ): Promise<void> {
    const supportsLyricSource = this.doesTrackSourceSupportLyricSources(trackUrn)
    try {
      const lyrics = await this.getLyricsForTrack(trackUrn, presetMetadata)

      // Guard against race conditions if track has changed while fetching
      if (gen !== this.currentGeneration) return

      if (!lyrics || !lyrics.content.trim()) {
        this.updateState({
          status: 'no-lyrics',
          trackUrn,
          lyrics: undefined,
          supportsLyricSource,
          sourceType: undefined,
          error: undefined,
        })
        return
      }

      const resolvedSourceType =
        this.lastResolvedSourceType.get(trackUrn) ??
        (supportsLyricSource && this.getLyricSourcesService() ? 'lyric-source' : 'audio-provider')

      this.updateState({
        status: 'ready',
        trackUrn,
        lyrics,
        supportsLyricSource,
        sourceType: resolvedSourceType,
        error: undefined,
        offsetMs: lyrics.offsetMs ?? 0,
      })

      // Immediately calculate and emit active lyric index for current playback position
      const currentPos = this.ownCtx.player?.state?.positionMs ?? 0
      this.syncActiveIndex(currentPos)
    } catch (err) {
      if (gen !== this.currentGeneration) return

      const message = err instanceof Error ? err.message : String(err)
      this.ownCtx.logger.warn(`lyrics: failed to fetch lyrics for ${trackUrn}: ${message}`)
      this.updateState({
        status: 'error',
        trackUrn,
        lyrics: undefined,
        supportsLyricSource,
        sourceType: undefined,
        error: message,
      })
    }
  }

  async getLyricsForTrack(
    trackUrn: string,
    presetMetadata?: { title?: string; artist?: string; durationMs?: number },
  ): Promise<Lyrics | undefined> {
    const existing = this.inFlightFetches.get(trackUrn)
    if (existing) {
      return existing
    }

    const fetchPromise = this.executeFetchLyrics(trackUrn, presetMetadata)
    this.inFlightFetches.set(trackUrn, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      this.inFlightFetches.delete(trackUrn)
    }
  }

  private async executeFetchLyrics(
    trackUrn: string,
    presetMetadata?: { title?: string; artist?: string; durationMs?: number },
  ): Promise<Lyrics | undefined> {
    // If new metadata is supplied, invalidate any stale negative cache
    if (presetMetadata?.title) {
      this.negativeCache.delete(trackUrn)
      if (this.ownCtx.db) {
        void this.ownCtx.db
          .exec('DELETE FROM lyrics WHERE track_urn = ? AND format = ?', [trackUrn, 'none'])
          .catch(() => undefined)
      }
    }

    // 1. In-memory positive cache
    if (this.memoryCache.has(trackUrn)) {
      this.lastResolvedSourceType.set(trackUrn, 'cache')
      return this.memoryCache.get(trackUrn)
    }

    // 1.5. In-memory negative cache (empty lyrics within TTL)
    const negExpiresAt = this.negativeCache.get(trackUrn)
    if (negExpiresAt !== undefined) {
      if (Date.now() < negExpiresAt) {
        return undefined
      }
      this.negativeCache.delete(trackUrn)
    }

    // 2. Persistent SQLite cache
    if (this.ownCtx.db) {
      try {
        const rows = await this.ownCtx.db.query<{
          format: string
          content: string
          synced: number
          offset_ms: number
          language: string
          fetched_at?: number
        }>(
          'SELECT format, content, synced, offset_ms, language, fetched_at FROM lyrics WHERE track_urn = ? ORDER BY is_preferred DESC, fetched_at DESC LIMIT 1',
          [trackUrn],
        )
        if (rows.length > 0 && rows[0]) {
          const row = rows[0]
          // Check for negative cache marker in DB
          if (row.format === 'none' || !row.content) {
            const age = Date.now() - (row.fetched_at ?? 0)
            if (age < this.negativeCacheTtlMs) {
              this.rememberNegative(trackUrn, (row.fetched_at ?? Date.now()) + this.negativeCacheTtlMs)
              return undefined
            } else {
              // Expired negative cache in DB — prune and fall through to re-fetch
              void this.ownCtx.db
                .exec('DELETE FROM lyrics WHERE track_urn = ? AND format = ?', [trackUrn, 'none'])
                .catch(() => undefined)
            }
          } else {
            const lyrics: Lyrics = {
              format: row.format as Lyrics['format'],
              content: row.content,
              synced: row.synced === 1,
              offsetMs: row.offset_ms,
              language: row.language || undefined,
            }
            this.lastResolvedSourceType.set(trackUrn, 'cache')
            this.remember(trackUrn, lyrics)
            return lyrics
          }
        }
      } catch (e) {
        this.ownCtx.logger.debug(`lyrics: db lookup failed for ${trackUrn}: ${String(e)}`)
      }
    }

    // 3. Online media provider resolution & third-party lyric sources
    const parsedUrn = tryParseUrn(trackUrn)
    const supportsLyricSource = this.doesTrackSourceSupportLyricSources(trackUrn)
    const lyricSourcesSvc = this.getLyricSourcesService()

    let genuineSearchPerformed = false

    let providerError: unknown

    // Priority 1: Online media provider from audio source (e.g. Subsonic server / embedded lyrics)
    if (this.ownCtx.sources && parsedUrn) {
      const provider = this.ownCtx.sources.forUrn(trackUrn)
      if (provider?.getLyrics) {
        genuineSearchPerformed = true
        try {
          const fetched = await provider.getLyrics(parsedUrn.id)
          if (fetched && fetched.content && fetched.content.trim()) {
            this.lastResolvedSourceType.set(trackUrn, 'audio-provider')
            this.remember(trackUrn, fetched)
            await this.persistLyrics(trackUrn, fetched)
            return fetched
          }
        } catch (err) {
          providerError = err
          this.ownCtx.logger.warn(`lyrics: provider.getLyrics failed for ${trackUrn}: ${String(err)}`)
        }
      }
    }

    // Priority 2: Fallback to third-party lyric sources if audio source allows it and had no lyrics
    if (supportsLyricSource && lyricSourcesSvc) {
      const query = await this.resolveTrackQuery(trackUrn, presetMetadata)
      const isGenuineTitle = Boolean(query.title && query.title !== trackUrn && query.title !== parsedUrn?.id)
      if (isGenuineTitle) {
        genuineSearchPerformed = true
      }
      try {
        const fetched = await lyricSourcesSvc.searchLyrics(query)
        if (fetched && fetched.content && fetched.content.trim()) {
          this.lastResolvedSourceType.set(trackUrn, 'lyric-source')
          this.remember(trackUrn, fetched)
          await this.persistLyrics(trackUrn, fetched)
          return fetched
        }
      } catch (err) {
        this.ownCtx.logger.warn(`lyrics: lyricSources.searchLyrics failed for ${trackUrn}: ${String(err)}`)
      }
    }

    if (providerError) {
      throw providerError
    }

    // Only persist negative cache if we actually had genuine track metadata to search with.
    // If title was unresolved or a raw ID, do not poison negative cache so later metadata updates can succeed.
    if (genuineSearchPerformed) {
      this.rememberNegative(trackUrn, Date.now() + this.negativeCacheTtlMs)
      await this.persistNegativeCache(trackUrn)
    }

    return undefined
  }

  private async resolveTrackQuery(
    trackUrn: string,
    presetMetadata?: { title?: string; artist?: string; durationMs?: number },
  ): Promise<LyricSearchQuery> {
    let title: string | undefined = presetMetadata?.title
    let artist: string | undefined = presetMetadata?.artist
    let duration = presetMetadata?.durationMs ?? 0

    // 1. Direct SQLite lookup from tracks table (fastest & strictly keyed by trackUrn)
    if ((!title || !artist) && this.ownCtx.db) {
      try {
        const rows =
          typeof this.ownCtx.db.get === 'function'
            ? [
                await this.ownCtx.db.get<{
                  title: string
                  artist?: string
                  duration_ms?: number
                }>(
                  `SELECT t.title, t.duration_ms,
                          (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                            WHERE ta.track_urn = t.urn ORDER BY ta.ordinal ASC LIMIT 1) AS artist
                     FROM tracks t WHERE t.urn = ?`,
                  [trackUrn],
                ),
              ].filter(Boolean)
            : await this.ownCtx.db.query<{
                title: string
                artist?: string
                duration_ms?: number
              }>(
                `SELECT t.title, t.duration_ms,
                        (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                          WHERE ta.track_urn = t.urn ORDER BY ta.ordinal ASC LIMIT 1) AS artist
                   FROM tracks t WHERE t.urn = ?`,
                [trackUrn],
              )
        const row = rows[0] as { title?: string; artist?: string; duration_ms?: number } | undefined
        if (row?.title && !row.title.startsWith('BBeBee:')) {
          if (!title) title = row.title
          if (!artist) artist = row.artist ?? ''
          if (!duration && row.duration_ms) duration = row.duration_ms
        }
      } catch {
        // ignore
      }
    }

    // 2. Fallback: sources catalog query (strictly keyed by trackUrn)
    if ((!title || !artist) && this.ownCtx.sources) {
      try {
        const tracks = await this.ownCtx.sources.getTracks([trackUrn])
        if (tracks[0]?.title) {
          if (!title) title = tracks[0].title
          if (!artist) artist = tracks[0].artists?.map((a) => a.name).join(', ') ?? ''
          if (!duration && tracks[0].durationMs) duration = tracks[0].durationMs
        } else {
          const provider = this.ownCtx.sources.forUrn?.(trackUrn)
          const parsed = tryParseUrn(trackUrn)
          if (provider?.getTrack && parsed) {
            const track = await provider.getTrack(parsed.id)
            if (track?.title) {
              if (!title) title = track.title
              if (!artist) artist = track.artists?.map((a) => a.name).join(', ') ?? ''
              if (!duration && track.durationMs) duration = track.durationMs
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Fallback: Player transport state only if currently playing this exact track
    const playerState = this.ownCtx.player?.state
    if (!title && playerState?.trackUrn === trackUrn && playerState.nowPlaying?.title) {
      title = playerState.nowPlaying.title
      artist = playerState.nowPlaying.artist ?? ''
      duration = playerState.durationMs || 0
    }

    if (!title) {
      const parsed = tryParseUrn(trackUrn)
      title = parsed?.id ?? trackUrn
    }

    // Clean up filename patterns like "Artist - Title.mp3" or "Title.flac"
    if (title) {
      title = title.replace(/\.(mp3|flac|wav|m4a|ogg|aac|opus)$/i, '')
      if (!artist && title.includes(' - ')) {
        const parts = title.split(' - ')
        if (parts.length >= 2 && parts[0] && parts[1]) {
          artist = parts[0].trim()
          title = parts.slice(1).join(' - ').trim()
        }
      }
      title = cleanTrackTitle(title) || title
    }

    return {
      title: title.trim(),
      artist: (artist ?? '').trim(),
      duration,
    }
  }

  private remember(urn: string, lyrics: Lyrics): void {
    this.negativeCache.delete(urn)
    if (this.memoryCache.size >= this.cacheSize) {
      const oldestKey = this.memoryCache.keys().next().value
      if (oldestKey) {
        this.memoryCache.delete(oldestKey)
        this.parsedCache.delete(oldestKey)
      }
    }
    this.memoryCache.set(urn, lyrics)
  }

  private rememberNegative(urn: string, expiresAt: number): void {
    if (this.negativeCache.size >= this.cacheSize) {
      const oldestKey = this.negativeCache.keys().next().value
      if (oldestKey) {
        this.negativeCache.delete(oldestKey)
      }
    }
    this.negativeCache.set(urn, expiresAt)
  }

  private async persistLyrics(trackUrn: string, lyrics: Lyrics): Promise<void> {
    if (!this.ownCtx.db) return
    try {
      const parsedUrn = tryParseUrn(trackUrn)
      const sourceId = parsedUrn?.sourceId ?? 'default'
      await this.ownCtx.db.exec(
        `INSERT OR REPLACE INTO lyrics (track_urn, source_id, format, content, synced, offset_ms, language, is_preferred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackUrn,
          sourceId,
          lyrics.format,
          lyrics.content,
          lyrics.synced ? 1 : 0,
          lyrics.offsetMs ?? 0,
          lyrics.language ?? '',
          1,
          Date.now(),
        ],
      )
    } catch (e) {
      this.ownCtx.logger.debug(`lyrics: db persist failed for ${trackUrn}: ${String(e)}`)
    }
  }

  private async persistNegativeCache(trackUrn: string): Promise<void> {
    if (!this.ownCtx.db) return
    try {
      const parsedUrn = tryParseUrn(trackUrn)
      const sourceId = parsedUrn?.sourceId ?? 'default'
      await this.ownCtx.db.exec(
        `INSERT OR REPLACE INTO lyrics (track_urn, source_id, format, content, synced, offset_ms, language, is_preferred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackUrn,
          sourceId,
          'none',
          '',
          0,
          0,
          '',
          0,
          Date.now(),
        ],
      )
    } catch (e) {
      this.ownCtx.logger.debug(`lyrics: db negative cache persist failed for ${trackUrn}: ${String(e)}`)
    }
  }

  setOffset(offsetMs: number): void {
    this.updateState({ offsetMs })
    const trackUrn = this.currentState.trackUrn
    if (trackUrn) {
      const cached = this.memoryCache.get(trackUrn)
      if (cached) {
        cached.offsetMs = offsetMs
      }
      if (this.ownCtx.db) {
        void this.ownCtx.db
          .exec('UPDATE lyrics SET offset_ms = ? WHERE track_urn = ?', [offsetMs, trackUrn])
          .catch(() => undefined)
      }
    }
  }

  async clearCache(trackUrn?: string): Promise<void> {
    if (trackUrn) {
      this.memoryCache.delete(trackUrn)
      this.parsedCache.delete(trackUrn)
      this.negativeCache.delete(trackUrn)
      this.lastResolvedSourceType.delete(trackUrn)
      if (this.ownCtx.db) {
        try {
          await this.ownCtx.db.exec('DELETE FROM lyrics WHERE track_urn = ?', [trackUrn])
        } catch (e) {
          this.ownCtx.logger.debug(`lyrics: failed to clear cache for ${trackUrn}: ${String(e)}`)
        }
      }
    } else {
      this.memoryCache.clear()
      this.parsedCache.clear()
      this.negativeCache.clear()
      this.lastResolvedSourceType.clear()
      if (this.ownCtx.db) {
        try {
          await this.ownCtx.db.exec('DELETE FROM lyrics')
        } catch (e) {
          this.ownCtx.logger.debug(`lyrics: failed to clear all lyrics cache: ${String(e)}`)
        }
      }
    }
  }

  async retry(): Promise<void> {
    const urn = this.currentState.trackUrn
    if (urn) {
      this.memoryCache.delete(urn)
      this.parsedCache.delete(urn)
      this.negativeCache.delete(urn)
      this.lastResolvedSourceType.delete(urn)
      if (this.ownCtx.db) {
        await this.ownCtx.db
          .exec('DELETE FROM lyrics WHERE track_urn = ? AND format = ?', [urn, 'none'])
          .catch(() => undefined)
      }
      await this.handleTrackChanged(urn)
    }
  }

  private syncActiveIndex(positionMs: number): void {
    if (this.currentState.status !== 'ready' || !this.currentState.lyrics) {
      if (this.lastActiveIndex !== -1) {
        this.lastActiveIndex = -1
        this.ownCtx.emit('lyrics/active-changed', -1)
      }
      return
    }

    const urn = this.currentState.trackUrn ?? ''
    let parsed = this.parsedCache.get(urn)
    if (!parsed) {
      parsed = parseLrc(this.currentState.lyrics.content, { offsetMs: this.currentState.offsetMs })
      this.parsedCache.set(urn, parsed)
    }

    if (!parsed.synced || parsed.lines.length === 0) {
      if (this.lastActiveIndex !== -1) {
        this.lastActiveIndex = -1
        this.ownCtx.emit('lyrics/active-changed', -1)
      }
      return
    }

    const nextIndex = findActiveLyricIndex(parsed.lines, positionMs, this.currentState.offsetMs)
    if (nextIndex !== this.lastActiveIndex) {
      this.lastActiveIndex = nextIndex
      this.ownCtx.emit('lyrics/active-changed', nextIndex)
    }
  }
}

export const name = 'plugin-lyrics'

export async function apply(ctx: Context, config?: LyricsConfig) {
  ctx.logger.info('plugin-lyrics: loaded')
  const fiber = await ctx.plugin(LyricsPlugin, config)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
