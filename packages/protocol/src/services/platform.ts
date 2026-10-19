/**
 * The remaining platform services: paths, device, crypto, codec, shell, ws,
 * notify, background, mediaSession, i18n.
 * See docs/04-core-services.md §3, §7–§15.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable, Uri, WellKnownDir } from '../common.js'

/* ── ctx.ws ─────────────────────────────────────────────────────────────── */

export interface WsConnection {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  /** CONNECTING | OPEN | CLOSING | CLOSED */
  readonly readyState: 0 | 1 | 2 | 3
}

export interface WsOptions {
  protocols?: string[]
  headers?: Record<string, string>
  onMessage?: (data: string | Uint8Array) => void
  onClose?: (code: number, reason: string) => void
  onError?: (err: Error) => void
}

export interface WsService {
  connect(url: string, opts?: WsOptions): WsConnection
}

/* ── ctx.paths ──────────────────────────────────────────────────────────── */

export interface PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  /** Undefined where the platform has no shared music folder (iOS). */
  readonly music?: Uri
  pluginData(pluginId: string): Uri
  get(kind: WellKnownDir): Uri | undefined
}

/* ── ctx.device ─────────────────────────────────────────────────────────── */

export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux'
export type FormFactor = 'phone' | 'tablet' | 'desktop'
export type NetworkType = 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown'

export interface NetworkState {
  online: boolean
  type: NetworkType
  /** Drives the download policy engine. */
  metered: boolean
}

export type MediaKey = 'play-pause' | 'next' | 'previous' | 'stop'

export interface DeviceService {
  readonly platform: Platform
  readonly formFactor: FormFactor
  readonly appVersion: string
  readonly locale: string

  network(): Promise<NetworkState>
  onNetworkChange(cb: (s: NetworkState) => void): Disposable
  battery(): Promise<{ level: number; charging: boolean } | undefined>

  /** Desktop only. Resolves to a no-op disposer on mobile. */
  onMediaKey(cb: (key: MediaKey) => void): Disposable
  registerHotkey(accelerator: string, cb: () => void): Disposable
}

/* ── ctx.crypto ─────────────────────────────────────────────────────────── */

export type DigestAlgorithm = 'sha1' | 'sha256' | 'md5'

export interface CryptoService {
  randomBytes(n: number): Uint8Array
  randomUUID(): string
  digest(algo: DigestAlgorithm, data: Uint8Array | string): Promise<Uint8Array>
  hmac(
    algo: 'sha1' | 'sha256',
    key: Uint8Array | string,
    data: Uint8Array | string,
  ): Promise<Uint8Array>
  /** Verify a large download without buffering it. */
  digestStream(algo: 'sha256', stream: ReadableStream<Uint8Array>): Promise<Uint8Array>
  /** AES-GCM, used for the envelope-encrypted cookie jar on mobile. */
  encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>
  decrypt(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array>
}

/* ── ctx.codec ──────────────────────────────────────────────────────────── */

export interface AudioMetadata {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  trackNo?: number
  discNo?: number
  year?: number
  genre?: string[]
  durationMs?: number
  bitrateKbps?: number
  sampleRate?: number
  channels?: number
  bitDepth?: number
  codec?: string
  replayGainTrack?: number
  replayGainAlbum?: number
  isrc?: string
  musicbrainzTrackId?: string
  lyrics?: string
  tagTypes?: string[]
  hasArtwork: boolean
}

export interface DecodedAudio {
  sampleRate: number
  channels: number
  pcm: Float32Array[]
}

export interface TranscodeOptions {
  inputUri: Uri
  outputUri: Uri
  targetFormat: string
  bitrate?: string
  sampleRate?: number
  channels?: number
  bitDepth?: number
  vbr?: boolean
  vbrQuality?: number
  volumeGainDb?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
  startTimeSeconds?: number
  endTimeSeconds?: number
  signal?: AbortSignal
  onProgress?: (progress: number, currentTimeSeconds: number) => void
}

export interface TranscodeResult {
  ok: boolean
  error?: string
  outputSize?: number
  durationMs?: number
}

export interface CodecService {
  /** Read tags without decoding audio. Must not read the whole file. */
  readMetadata(uri: Uri): Promise<AudioMetadata>
  /**
   * Batch version of {@link readMetadata}: parse multiple files in one call.
   * Used to amortize IPC overhead when the service is bridged. Each entry is
   * either `{ metadata }` or `{ error }` — one file failing does not fail
   * the batch.
   */
  readMetadataBatch?(uris: Uri[]): Promise<Array<{ metadata?: AudioMetadata; error?: string }>>
  readArtwork(uri: Uri): Promise<Uint8Array | undefined>
  /**
   * Batch artwork extraction: one call for many files, amortizing IPC
   * overhead when bridged. Returns the cover bytes per URI (undefined for
   * files with no embedded cover), in input order.
   */
  readArtworkBatch?(uris: Uri[]): Promise<Array<Uint8Array | undefined>>
  /**
   * Read tags and embedded artwork in a single parse. Optional: platforms
   * without it fall back to `readMetadata` + `readArtwork` (two parses).
   * The signal aborts in-flight reads (true cancellation, not just a race).
   */
  readMetadataWithArtwork?(uri: Uri, signal?: AbortSignal): Promise<{ metadata: AudioMetadata; artwork?: Uint8Array }>
  decode(data: Uint8Array | Uri): Promise<DecodedAudio>
  probeDuration(uri: Uri): Promise<number>
  /** Varies by platform and OS version — FLAC/ALAC/Opus/DSD coverage is not uniform. */
  supportedFormats(): string[]
  /** Transcode an audio file into another format. */
  transcode?(options: TranscodeOptions): Promise<TranscodeResult>
  /** Query available audio encoders and format support on this system. */
  getEncoderCapabilities?(): Promise<{
    supportedInputFormats: string[]
    supportedOutputFormats: string[]
    encoders: Record<string, { name: string; description: string; available: boolean }>
  }>
}

/* ── ctx.shell ──────────────────────────────────────────────────────────── */

export type AuthSessionResult = { url: string } | { cancelled: true }

export interface ShellService {
  openExternal(url: string): Promise<void>
  /** No-op on mobile. */
  revealInFileManager(uri: Uri): Promise<void>
  share(content: { uri?: Uri; text?: string; title?: string }): Promise<void>
  /** Opens a browser and resolves on redirect. Makes OAuth PKCE one call. */
  openAuthSession(url: string, redirectUri: string): Promise<AuthSessionResult>
}

/* ── ctx.notify ─────────────────────────────────────────────────────────── */

export interface NotifyService {
  show(n: {
    id?: string
    title: string
    body?: string
    iconUri?: Uri
    silent?: boolean
  }): Promise<string>
  dismiss(id: string): Promise<void>
  onActivated(cb: (id: string) => void): Disposable
  requestPermission(): Promise<'granted' | 'denied'>
}

/* ── ctx.background ─────────────────────────────────────────────────────── */

export interface BackgroundService {
  /** True when work may continue with the app not in the foreground. */
  canRunInBackground(): boolean
  /** Keep the process alive for foreground-ish work. Release promptly. */
  acquireWakeLock(reason: string): Promise<Disposable>
  /**
   * Register deferrable periodic work.
   *
   * On mobile this is the OS scheduler: `intervalMinutes` is a *hint*, and a
   * run may be hours late or skipped entirely.
   */
  schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable>
  /** Fires before the host suspends. Checkpoint here. */
  onWillSuspend(cb: () => void | Promise<void>): Disposable
}

/* ── ctx.mediaSession ───────────────────────────────────────────────────── */

export interface NowPlaying {
  title: string
  artist?: string
  album?: string
  /** Must be a local Uri on mobile; remote artwork is cached first. */
  artworkUri?: Uri
  /**
   * A cover URL a browser media session can render: `http(s)`, `data:` or
   * `blob:` only.
   *
   * The counterpart to `artworkUri`, because the two OS surfaces need
   * different things. An Android notification can read a local file and
   * cannot reach a URL only the renderer holds; Chromium's `MediaMetadata`
   * refuses every other scheme — `file:` included — and logs a warning on
   * each assignment. A caller publishes whichever it has; each implementation
   * renders the one it can and ignores the other.
   */
  artworkUrl?: string
  durationMs?: number
  positionMs?: number
  playbackRate?: number
}

export type TransportCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'seek-relative'; deltaMs: number }
  | { type: 'rate'; loved: boolean }

export interface MediaSessionService {
  update(np: NowPlaying): void
  setPlaybackState(state: 'playing' | 'paused' | 'stopped'): void
  onCommand(cb: (cmd: TransportCommand) => void): Disposable
  /** Which commands the OS surface will actually display. */
  setSupportedCommands(types: TransportCommand['type'][]): void
  clear(): void
}

/* ── ctx.i18n ───────────────────────────────────────────────────────────── */

export interface I18nService {
  readonly locale: string
  t(key: string, params?: Record<string, string | number>): string
  /** Plugins ship their own catalogues; disposed with the plugin. */
  register(namespace: string, catalogues: Record<string, Record<string, string>>): Disposable
  onLocaleChange(cb: (locale: string) => void): Disposable
}

declare module 'cordis' {
  interface Context {
    ws: WsService
    paths: PathsService
    device: DeviceService
    crypto: CryptoService
    codec: CodecService
    shell: ShellService
    notify: NotifyService
    background: BackgroundService
    mediaSession: MediaSessionService
    i18n: I18nService
  }
}
