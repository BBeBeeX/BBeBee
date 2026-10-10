/**
 * `ctx.lyricSources` — third-party lyric source provider registry and sandboxed search.
 *
 * Coordinates external lyric sources that execute inside an isolated sandbox,
 * receiving ONLY { title, artist, duration } and normalizing results into the
 * application's unified Lyrics standard.
 */

import type {} from 'cordis'
import type { Lyrics } from '../entities/library.js'

/**
 * Minimal, sanitized search query passed to sandboxed lyric sources.
 *
 * In accordance with security privacy invariants, sandboxed lyric sources
 * have NO access to arbitrary local files, track URNs, credentials, or parent DOM.
 */
export interface LyricSearchQuery {
  /** Track title / song name. */
  title: string
  /** Track artist / singer name. */
  artist: string
  /** Total track duration in milliseconds. */
  duration: number
}

/**
 * Definition of an imported third-party lyric source.
 */
export interface LyricSourceDefinition {
  /** Unique identifier of the lyric source. */
  id: string
  /** Human-readable display name. */
  name: string
  /** Short description shown in settings and source management. */
  description?: string
  /** Semantic version string (e.g. '1.0.0'). */
  version?: string
  /** Author or developer name. */
  author?: string
  /** Whether this lyric source is currently active in the search chain. */
  enabled: boolean
  /** Sorting priority index (lower number = higher priority). */
  sortOrder: number
  /**
   * Sandboxed JavaScript source code.
   * Receives `{ title, artist, duration, httpFetch }` and returns LRC text or structured lyrics.
   */
  script: string
  /** Optional custom configuration parameters. */
  config?: Record<string, unknown>
  /** Whitelisted hostnames for outgoing HTTP requests. */
  allowedHosts?: string[]
}

export interface LyricSourceTestResult {
  ok: boolean
  lyrics?: Lyrics
  error?: string
  durationMs?: number
}

export interface LyricSourcesService {
  /** Get all registered lyric sources in current priority order. */
  getSources(): readonly LyricSourceDefinition[]
  /** Get a single lyric source by its unique ID. */
  getSource(id: string): LyricSourceDefinition | undefined
  /** Register or update a lyric source definition. */
  registerSource(def: LyricSourceDefinition): Promise<void>
  /** Remove a lyric source by ID. Returns true if removed. */
  removeSource(id: string): Promise<boolean>
  /** Toggle whether a lyric source is enabled. */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** Update custom configuration parameters for a lyric source. */
  updateSourceConfig(id: string, config: Record<string, unknown>): Promise<void>
  /** Reorder lyric source priorities by passing an ordered list of IDs. */
  reorder(ids: string[]): Promise<void>
  /**
   * Search lyrics across all enabled lyric sources in priority order.
   * Returns the first valid normalized `Lyrics` result, or undefined if none match.
   */
  searchLyrics(query: LyricSearchQuery): Promise<Lyrics | undefined>
  /** Test a specific lyric source with a test query. */
  testSource(id: string, query: LyricSearchQuery): Promise<LyricSourceTestResult>
}

declare module 'cordis' {
  interface Context {
    lyricSources: LyricSourcesService
  }
}
