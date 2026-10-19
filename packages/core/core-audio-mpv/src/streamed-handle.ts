/**
 * The media-element streaming handle for `ctx.audio`.
 *
 * Moved here from `core-audio-webaudio` when that package was removed: the
 * MPV service drives its element path through this class, so the stall/seek
 * semantics live next to their only remaining consumer instead of in a
 * package whose engine no longer exists.
 */

import type { AudioSourceHandle, Disposable } from '@BBeBee/protocol'
import type { AudioLogger } from './shared.js'
export interface MediaElementLike {
  src: string
  /**
   * The CORS mode the element loads in.
   *
   * Load-bearing, not cosmetic: an element wrapped by
   * `createMediaElementSource` and fetched cross-origin without CORS makes
   * the node output silence, so a remote track "plays" with no sound.
   */
  crossOrigin?: string | null
  currentTime: number
  duration: number
  paused: boolean
  seeking?: boolean
  error?: { code?: number; message?: string } | null
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}
const STALL_EVENTS = ['waiting', 'stalled'] as const
const RECOVER_EVENTS = ['playing', 'canplaythrough'] as const

/**
 * The streaming handle: the MPV service reaches the element path through
 * this class, so stall/seek semantics are defined once, next to their
 * consumer.
 */
export class StreamedHandle implements AudioSourceHandle {
  readonly node: AudioNode

  private readonly endedListeners = new Set<() => void>()
  private readonly onEndedNative = () => {
    this.logger?.debug?.('mpv: [streamed] playback ended')
    this.pendingSeekSeconds = undefined
    for (const listener of this.endedListeners) listener()
  }

  private readonly stallListeners = new Set<(stalled: boolean) => void>()
  private stalled = false
  /** Set once the element has actually produced sound (`playing`/`canplaythrough`). */
  private started = false
  private readonly onStallNative = () => {
    if ((this.element as { error?: unknown }).error) return
    this.setStalled(true)
  }
  private readonly onRecoverNative = () => {
    /*
     * The element's own clock is authoritative as soon as it can play,
     * unless an explicit seek is still in flight (element.seeking).
     *
     * A `play(atMs)` issued before metadata is stored by the element as its
     * *default playback start position*, and that path does not fire `seeked`
     * — so a pending marker recorded there would never clear. `attach` plays
     * every streamed track with `play(0)`, which is exactly that call, and the
     * position then reported 0 for the whole track while the audio played.
     */
    if (!this.element.seeking) {
      this.pendingSeekSeconds = undefined
    }
    this.started = true
    this.setStalled(false)
  }
  private readonly onSeekedNative = () => {
    this.pendingSeekSeconds = undefined
  }
  private readonly onErrorNative = () => {
    this.logger?.error?.('mpv: [streamed] playback error', this.element.error)
    this.setStalled(false)
    /*
     * A fatal element error after the track has begun sounding is a network
     * failure, not a natural end. Reporting it as `ended` made the player
     * record the track as completed and skip ahead — the "position suddenly
     * jumps to 0:00 with no sound" report — and the next track, facing the
     * same broken network, sat silent at 0:00 too. An underrun is what the
     * protocol can express: the player's stall watchdog turns this into a
     * retryable network error at the frozen position instead.
     */
    if (this.started) {
      this.pendingSeekSeconds = undefined
      this.setStalled(true)
      return
    }
    this.onEndedNative()
  }

  private pendingSeekSeconds?: number

  constructor(
    private readonly element: MediaElementLike,
    node: AudioNode,
    private readonly logger?: AudioLogger,
    private readonly ensureRunning?: () => void,
  ) {
    this.node = node
    this.logger?.debug?.('mpv: [streamed] handle created (src: %s)', element.src)
    element.addEventListener('ended', this.onEndedNative)
    element.addEventListener('seeked', this.onSeekedNative)
    element.addEventListener('error', this.onErrorNative)
    for (const type of STALL_EVENTS) element.addEventListener(type, this.onStallNative)
    for (const type of RECOVER_EVENTS) element.addEventListener(type, this.onRecoverNative)
  }

  /**
   * Only an actual change is published.
   *
   * An element under a slow network sends `waiting` repeatedly, and a player
   * that took each one as a fresh stall would restart its recovery timeout on
   * every one of them — turning "gave up after 30 seconds" into "never gives
   * up".
   */
  private setStalled(stalled: boolean): void {
    if (this.stalled === stalled) return
    this.stalled = stalled
    if (stalled) {
      this.logger?.warn?.('mpv: [streamed] playback stalled')
    } else {
      this.logger?.info?.('mpv: [streamed] playback recovered from stall')
    }
    for (const listener of [...this.stallListeners]) listener(stalled)
  }

  get durationMs(): number {
    const seconds = this.element.duration
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
  }

  get positionMs(): number {
    if (this.pendingSeekSeconds !== undefined) {
      return Math.round(this.pendingSeekSeconds * 1000)
    }
    return Math.round(this.element.currentTime * 1000)
  }

  seek(atMs: number): void {
    const seconds = Math.max(0, atMs / 1000)
    this.logger?.debug?.('mpv: [streamed] seek to %dms', atMs)
    /*
     * Only a seek that moves the element can be pending.
     *
     * Setting `currentTime` to where the element already is fires no
     * `seeked` event, so recording the target as pending would never clear
     * it — and `positionMs` would report that target for the whole track.
     * A fresh element is at 0, so `play(0)` is precisely the case that used
     * to stick: the progress bar sat at zero while the audio played.
     */
    if (seconds !== this.element.currentTime) {
      this.pendingSeekSeconds = seconds
      this.element.currentTime = seconds
    }
  }

  play(atMs?: number): void {
    // Same reasoning as the buffered handle: a suspended context wraps the
    // element in silence, and the element's own `play()` would resolve while
    // producing nothing.
    this.ensureRunning?.()
    if (atMs !== undefined) {
      this.seek(atMs)
    }
    this.logger?.debug?.('mpv: [streamed] play (atMs: %s)', atMs)
    const res = this.element.play()
    if (res && typeof (res as Promise<void>).catch === 'function') {
      ;(res as Promise<void>).catch((err: Error) => {
        this.logger?.warn?.('mpv: [streamed] play() rejected: %s', err.message)
        this.setStalled(false)
        if (err.name === 'NotSupportedError' || (this.element as { error?: unknown }).error) {
          this.onEndedNative()
        }
      })
    }
  }

  pause(): void {
    this.logger?.debug?.('mpv: [streamed] pause (position: %dms)', this.positionMs)
    this.element.pause()
  }

  stop(): void {
    this.logger?.debug?.('mpv: [streamed] stop')
    this.pendingSeekSeconds = undefined
    this.element.pause()
    this.element.currentTime = 0
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => void this.endedListeners.delete(cb)
  }

  onStalled(cb: (stalled: boolean) => void): Disposable {
    this.stallListeners.add(cb)
    return () => void this.stallListeners.delete(cb)
  }

  dispose(): void {
    this.logger?.debug?.('mpv: [streamed] handle disposed')
    this.pendingSeekSeconds = undefined
    this.element.removeEventListener('ended', this.onEndedNative)
    this.element.removeEventListener('seeked', this.onSeekedNative)
    this.element.removeEventListener('error', this.onErrorNative)
    for (const type of STALL_EVENTS) this.element.removeEventListener(type, this.onStallNative)
    for (const type of RECOVER_EVENTS) this.element.removeEventListener(type, this.onRecoverNative)
    this.endedListeners.clear()
    this.stallListeners.clear()
    this.element.pause()
    try {
      this.element.src = ''
    } catch {
      // ignore in environments where setting src throws
    }
    this.node.disconnect()
  }
}



export function defaultMediaElementFactory(): (() => MediaElementLike) | undefined {
  const Ctor = (globalThis as { Audio?: new () => MediaElementLike }).Audio
  return Ctor ? () => new Ctor() : undefined
}
