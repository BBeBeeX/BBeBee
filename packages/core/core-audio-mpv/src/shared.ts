/**
 * Implementation shared by the two `ctx.audio` engines.
 *
 * `core-audio-mpv` is built on this package — the `StreamedHandle`
 * arrangement, the same pattern as `core-http-rn` ← `core-http-node`. Whatever
 * must not drift between the engines lives here once: device enumeration and
 * label hygiene, the context rebuild at a track's native rate, the
 * statechange→interruption translation, and the resume kick a suspended
 * context needs before a source can sound.
 */

import type { InterruptionEvent, OutputDevice } from '@BBeBee/protocol'

export interface AudioLogger {
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

/** One call into the desktop main process (`window.BBeBeeBridge.call`). */
export type BridgeCall = (service: string, method: string, args: unknown[]) => Promise<unknown>

/**
 * The bridge behind the optional config seam.
 *
 * Engines take `bridgeCall` in their config so tests can mock it; in a real
 * renderer the preload script injects the global this falls back to.
 */
export function resolveBridgeCall(configured?: BridgeCall): BridgeCall | undefined {
  if (configured) return configured
  if (typeof window !== 'undefined') {
    return (window as unknown as { BBeBeeBridge?: { call?: BridgeCall } }).BBeBeeBridge?.call
  }
  return undefined
}

/**
 * The slice of the context that carries its lifecycle.
 *
 * Declared structurally because not every realm provides it — the fake engine
 * in tests has all of it, but a context without these members is one that
 * simply cannot be interrupted or stuck.
 */
interface ContextLifecycle {
  readonly state?: string
  resume?: () => Promise<void>
  addEventListener?: (type: 'statechange', listener: () => void) => void
  removeEventListener?: (type: 'statechange', listener: () => void) => void
}

/**
 * Kick a suspended or interrupted context before a source starts on it.
 *
 * The user pressing play *is* the user gesture every policy needs, so the
 * resume is safe to attempt here; a refusal is logged, never thrown — a host
 * that won't resume is not a reason to fail the call. A suspended context
 * otherwise wraps the source in silence: its own `play()` resolves while
 * producing nothing.
 */
export function ensureAudioContextRunning(context: BaseAudioContext, logger?: AudioLogger): void {
  const lifecycle = context as BaseAudioContext & ContextLifecycle
  if ((lifecycle.state === 'suspended' || lifecycle.state === 'interrupted') && lifecycle.resume) {
    logger?.warn?.('audio: play() on a %s context — resuming', lifecycle.state)
    void lifecycle.resume().catch((err: unknown) => {
      logger?.warn?.('audio: context.resume() failed: %s', String(err))
    })
  }
}

/** Close a context, swallowing whatever a realm without `close` throws. */
export function closeContextQuietly(context: unknown): void {
  try {
    const closable = context as { close?: () => Promise<void> }
    if (typeof closable.close === 'function') {
      void closable.close().catch(() => undefined)
    }
  } catch {
    // ignore
  }
}

/**
 * Chromium's `setSinkId` takes Chromium ids only — an OS id here is rejected.
 * `''` is the machine default.
 */
export function sanitizeSinkId(id: string): string {
  const targetId = id === 'default' ? '' : id
  if (targetId && (targetId.includes('\\') || targetId.includes('{') || targetId.startsWith('hw:'))) {
    return ''
  }
  return targetId
}

/**
 * Map a `bbebee-file://` URI to the URL form the current webview can load.
 *
 * The desktop host owns the platform-specific mapping
 * (`window.BBeBee.files.toServableUrl`): on Windows the custom scheme is served
 * over `http://bbebee-file.localhost` because WebView2 cannot resolve custom
 * schemes natively. This read is structural (same pattern as
 * `resolveBridgeCall`) and degrades to the identity mapping when the host
 * surface is absent, so it is safe in tests and non-desktop renderers.
 */
export function servableFileUrl(uri: string): string {
  try {
    const fn = (
      globalThis as unknown as { window?: { BBeBee?: { files?: { toServableUrl?: unknown } } } }
    ).window?.BBeBee?.files?.toServableUrl
    if (typeof fn === 'function') return (fn as (u: string) => string)(uri)
  } catch {
    // Host surface unavailable — fall through to the identity mapping.
  }
  return uri
}

export interface RebuiltAudioGraph {
  context: BaseAudioContext
  chainInput: GainNode
  master: GainNode
}

/**
 * Build a replacement graph at `targetRate`.
 *
 * Returns `undefined` when the realm refused the rate — the caller keeps the
 * current graph and logs. The new graph is wired `chainInput → master →
 * destination` and the master starts at the caller's current level so a
 * rebuild is not audible; the caller then swaps its fields, notifies graph
 * consumers, and retires the old context.
 */
export function rebuildGraphAtRate(opts: {
  create: (options?: AudioContextOptions) => BaseAudioContext
  targetRate: number
  mutedAt?: number
  targetVolume: number
}): RebuiltAudioGraph | undefined {
  try {
    const context = opts.create({ sampleRate: opts.targetRate })
    const chainInput = context.createGain()
    const master = context.createGain()
    master.gain.value = opts.mutedAt !== undefined ? 0 : opts.targetVolume
    chainInput.connect(master)
    master.connect(context.destination)
    return { context, chainInput, master }
  } catch {
    return undefined
  }
}

/**
 * The context's own state transitions, translated into log lines and — where
 * the shell opted in — interruption events.
 *
 * This is the observability the silent pauses lacked: a context the OS left
 * `suspended` used to stop playback with no line anywhere, because no player
 * code ran. Now the transition itself is the record.
 *
 * The observer follows the context across a rate rebuild: `attach` again with
 * the new context, or a rebuilt engine goes blind to suspensions.
 */
export class ContextInterruptionObserver {
  /** Whether the context was ever seen `running`. */
  private sawRunning = false
  /** An interruption published from context state and not yet recovered. */
  private contextInterrupted = false
  private listener?: () => void
  private context?: BaseAudioContext & ContextLifecycle

  constructor(
    private readonly opts: {
      logger?: AudioLogger
      /**
       * Whether state transitions publish interruption events, not just log
       * lines.
       *
       * Desktop opts in: it has no other interruption surface, and Chromium
       * reports device loss and post-sleep recovery through `state`. Mobile
       * keeps it off: the shell wires `AudioManager`'s events, which carry the
       * OS's `shouldResume`; the raw state transitions would fire a second,
       * less informed copy of every interruption.
       */
      emitInterruptions: boolean
      onInterruption: (e: InterruptionEvent) => void
    },
  ) {}

  attach(context: BaseAudioContext): void {
    this.detach()
    const lifecycle = context as BaseAudioContext & ContextLifecycle
    // A context created already running never transitions *to* running, so
    // the initial state is read once here — otherwise the first suspension
    // would not qualify as an interruption.
    if (lifecycle.state === 'running') this.sawRunning = true
    if (typeof lifecycle.addEventListener === 'function') {
      const listener = () => this.observe()
      this.listener = listener
      this.context = lifecycle
      lifecycle.addEventListener('statechange', listener)
    }
  }

  detach(): void {
    if (this.listener && this.context && typeof this.context.removeEventListener === 'function') {
      this.context.removeEventListener('statechange', this.listener)
    }
    this.listener = undefined
    this.context = undefined
  }

  private observe(): void {
    const lifecycle = this.context
    if (!lifecycle) return
    const state = lifecycle.state
    switch (state) {
      case 'running':
        this.opts.logger?.info?.('audio: context state -> running')
        this.sawRunning = true
        if (this.opts.emitInterruptions && this.contextInterrupted) {
          this.contextInterrupted = false
          // `shouldResume: false`: the shell cannot know whether the OS
          // considers the disruption over, so the user decides. Pressing
          // play resumes the context on the way (`ensureAudioContextRunning`).
          this.opts.onInterruption({ type: 'ended', shouldResume: false })
        }
        break
      case 'interrupted':
      case 'suspended':
        this.opts.logger?.warn?.('audio: context state -> %s', state)
        if (this.opts.emitInterruptions && !this.contextInterrupted && this.sawRunning) {
          this.contextInterrupted = true
          this.opts.onInterruption({ type: 'began', shouldResume: false })
        }
        break
      case 'closed':
        this.opts.logger?.warn?.('audio: context state -> closed')
        break
      default:
        // A realm with no `state` at all — nothing to observe.
        break
    }
  }
}

/* ── The bridge probe ───────────────────────────────────────────────────── */

export interface AudioProbeInfo {
  sampleRate?: number
  channels?: number
  bitDepth?: number
  durationMs?: number
}

/** What ffmpeg reports about a stream before anything is decoded. */
export async function probeViaBridge(
  bridge: BridgeCall,
  src: string,
  headers?: Record<string, string>,
): Promise<AudioProbeInfo> {
  return (await bridge('audio', 'probe', [src, { headers }])) as AudioProbeInfo
}

/* ── Output devices ─────────────────────────────────────────────────────── */

/**
 * Translate a Chromium `deviceId` into the native OS device the bridge knows.
 *
 * Chromium and the OS number devices differently (Chromium ids vs MMDevice
 * ids), so the match goes through the user-visible label. A miss keeps the
 * id as-is: the bridge then does its own best effort, and `setSinkId` below
 * still gets the id Chromium understands.
 */
export async function resolveNativeOutputDevice(opts: {
  id: string
  bridge: BridgeCall
  logger?: AudioLogger
}): Promise<{ nativeId: string; label?: string }> {
  if (opts.id === 'default') {
    try {
      const fetched = (await opts.bridge('audio', 'getOutputDevices', [])) as OutputDevice[]
      const def = Array.isArray(fetched) ? fetched.find((f) => f.isDefault) : undefined
      if (def) return { nativeId: def.id, label: def.label }
    } catch (err) {
      opts.logger?.warn?.('audio: failed to resolve the default native device: %s', String(err))
    }
    return { nativeId: 'default' }
  }

  try {
    const fetched = (await opts.bridge('audio', 'getOutputDevices', [])) as OutputDevice[]
    if (!Array.isArray(fetched) || fetched.length === 0) return { nativeId: opts.id }

    const media = (
      globalThis as {
        navigator?: {
          mediaDevices?: {
            enumerateDevices?: () => Promise<Array<{ deviceId: string; kind: string; label: string }>>
          }
        }
      }
    ).navigator?.mediaDevices
    if (!media?.enumerateDevices) return { nativeId: opts.id }

    const raw = await media.enumerateDevices()
    const matchedOut = raw.find((r) => r.deviceId === opts.id)
    if (!matchedOut?.label) return { nativeId: opts.id }

    const cleanOut = normalizeBaseLabel(matchedOut.label)
    const foundNative = fetched.find((f) => {
      const cleanF = normalizeBaseLabel(f.label)
      return cleanF === cleanOut || cleanF.includes(cleanOut) || cleanOut.includes(cleanF)
    })
    if (foundNative?.id) return { nativeId: foundNative.id, label: foundNative.label }
  } catch (err) {
    opts.logger?.warn?.('audio: failed to resolve native device ID: %s', String(err))
  }
  return { nativeId: opts.id }
}

function isGenericPlaceholder(label: string): boolean {
  if (!label) return true
  const trimmed = label.trim()
  return (
    trimmed === '' ||
    trimmed === 'Audio output device' ||
    trimmed.startsWith('Audio output device (') ||
    trimmed === 'System default audio device (System Default)' ||
    trimmed === 'System default audio device' ||
    trimmed === 'System default audio endpoint (WASAPI Exclusive)' ||
    trimmed === 'Default audio endpoint (WASAPI Exclusive)' ||
    trimmed === 'System default audio output (System Default)' ||
    trimmed === 'Default audio device' ||
    trimmed === 'Default Audio Device' ||
    trimmed === 'Audio Output Device'
  )
}

function normalizeBaseLabel(l: string): string {
  return (l || '')
    .toLowerCase()
    .replace(/\s*(\(virtual\)|\[virtual\])\s*$/g, '')
    .replace(/^(default\s*[-–:]\s*|system default\s*[-–:]\s*)/i, '')
    .replace(/\s*\((system default|default)\)$/i, '')
    .trim()
}

function cleanAndTagDeviceLabel(
  rawLabel: string,
  id?: string,
  isVirtualHint?: boolean,
): { label: string; isVirtual: boolean } {
  let label = (rawLabel || '')
    .replace(/^(default\s*[-–:]\s*|system default\s*[-–:]\s*)/i, '')
    .replace(/\s*\((System Default|Default)\)$/i, '')
    .trim()

  if (isGenericPlaceholder(label)) {
    label = ''
  }

  const isVirtual = Boolean(
    isVirtualHint ||
      /voicemeeter|vb-audio|vbaudio|virtual|todesk|steam streaming|sonar|null sink|null-sink|null_sink|loopback|blackhole|soundflower|obs|easyeffects|pulseeffects|scream|discord/i.test(
        `${label} ${id || ''}`,
      ),
  )

  label = label.replace(/\s*(\(Virtual\)|\[Virtual\])\s*$/g, '').trim()
  if (isVirtual && label && !label.endsWith('(Virtual)')) {
    label = `${label} (Virtual)`
  }

  return { label, isVirtual }
}

let mediaDeviceLabelsUnlocked = false

/**
 * Chromium hides `enumerateDevices` labels behind a capture permission; a
 * one-shot `getUserMedia` unlocks them for the session.
 */
async function unlockMediaDeviceLabels(logger?: AudioLogger): Promise<void> {
  if (mediaDeviceLabelsUnlocked) {
    logger?.debug?.('audio: unlockMediaDeviceLabels skipped, already unlocked')
    return
  }
  const nav = (
    globalThis as unknown as {
      navigator?: {
        permissions?: { query?: (q: { name: string }) => Promise<{ state: string }> }
        mediaDevices?: {
          getUserMedia?: (c: { audio: boolean }) => Promise<{ getTracks: () => Array<{ stop: () => void }> }>
        }
      }
    }
  ).navigator
  if (!nav?.mediaDevices) {
    logger?.debug?.('audio: navigator.mediaDevices not available to unlock labels')
    return
  }

  try {
    if (typeof nav.permissions?.query === 'function') {
      const status = await nav.permissions.query({ name: 'speaker-selection' }).catch(() => null)
      logger?.debug?.('audio: speaker-selection status: %s', status?.state)
      if (status?.state === 'granted') {
        mediaDeviceLabelsUnlocked = true
        logger?.info?.('audio: speaker-selection permission is granted, device labels unlocked')
        return
      }
    }

    if (typeof nav.mediaDevices.getUserMedia === 'function') {
      const stream = await nav.mediaDevices.getUserMedia({ audio: true })
      const tracks = stream.getTracks()
      for (const track of tracks) {
        try {
          track.stop()
        } catch {
          // ignore
        }
      }
      mediaDeviceLabelsUnlocked = true
      logger?.info?.('audio: getUserMedia succeeded (%d tracks stopped), device labels unlocked', tracks.length)
    }
  } catch (err) {
    logger?.warn?.('audio: unlockMediaDeviceLabels failed: %s', String(err))
  }
}

/**
 * Every output device both engines show, with the bridge's native metadata
 * folded in.
 *
 * Chromium ids are the only ids a caller may act on — native OS ids are used
 * solely to enrich labels and virtual-card detection, never returned as `id`.
 */
export async function enumerateOutputDevices(opts: {
  logger?: AudioLogger
  bridgeCall?: BridgeCall
}): Promise<OutputDevice[]> {
  await unlockMediaDeviceLabels(opts.logger)

  const devices: OutputDevice[] = []
  const media = (
    globalThis as {
      navigator?: {
        mediaDevices?: { enumerateDevices?: () => Promise<Array<{ deviceId: string; kind: string; label: string }>> }
      }
    }
  ).navigator?.mediaDevices

  let rawOutputs: Array<{ deviceId: string; kind: string; label: string }> = []
  if (media?.enumerateDevices) {
    try {
      const raw = await media.enumerateDevices()
      rawOutputs = raw.filter((d) => d.kind === 'audiooutput')
      opts.logger?.info?.(
        'audio: enumerateDevices() returned %d total devices (%d audiooutput)',
        raw.length,
        rawOutputs.length,
      )
    } catch (err) {
      opts.logger?.warn?.('audio: enumerateDevices() failed: %s', String(err))
    }
  } else {
    opts.logger?.debug?.('audio: navigator.mediaDevices.enumerateDevices is not available')
  }

  let bridgeDevices: OutputDevice[] = []
  if (opts.bridgeCall) {
    try {
      const fetched = (await opts.bridgeCall('audio', 'getOutputDevices', [])) as OutputDevice[]
      if (Array.isArray(fetched) && fetched.length > 0) {
        bridgeDevices = fetched
        opts.logger?.info?.('audio: bridge getOutputDevices returned %d devices', fetched.length)
      } else {
        opts.logger?.debug?.('audio: bridge getOutputDevices returned empty or non-array')
      }
    } catch (err) {
      opts.logger?.warn?.('audio: bridge getOutputDevices failed: %s', String(err))
    }
  }

  for (let i = 0; i < rawOutputs.length; i++) {
    const out = rawOutputs[i]!
    let label = out.label
    let matchReason = 'none'

    // Match with bridgeDevices solely for metadata (label & virtual card detection)
    let matchedBridge: OutputDevice | undefined
    if (bridgeDevices.length > 0) {
      if (!isGenericPlaceholder(label)) {
        const cleanL = normalizeBaseLabel(label)
        matchedBridge = bridgeDevices.find((b) => {
          const cleanB = normalizeBaseLabel(b.label)
          return cleanB === cleanL || cleanB.includes(cleanL) || cleanL.includes(cleanB)
        })
        if (matchedBridge) matchReason = `label match ("${cleanL}" ~ "${matchedBridge.label}")`
      }
      if (!matchedBridge) {
        if (out.deviceId === 'default') {
          matchedBridge = bridgeDevices.find((b) => b.isDefault) ?? bridgeDevices[0]
          matchReason = 'default device fallback'
        } else if (i < bridgeDevices.length) {
          matchedBridge = bridgeDevices[i]
          matchReason = `index match [${i}]`
        }
      }
    }

    if (isGenericPlaceholder(label) && matchedBridge?.label && !isGenericPlaceholder(matchedBridge.label)) {
      opts.logger?.debug?.(
        'audio: replacing generic label "%s" (deviceId=%s) with native label "%s" via %s',
        label,
        out.deviceId,
        matchedBridge.label,
        matchReason,
      )
      label = matchedBridge.label
    }

    const { label: cleanLabel, isVirtual } = cleanAndTagDeviceLabel(
      label,
      out.deviceId,
      matchedBridge?.isVirtual,
    )

    const finalLabel = !isGenericPlaceholder(cleanLabel)
      ? cleanLabel
      : (matchedBridge?.label && !isGenericPlaceholder(matchedBridge.label) ? matchedBridge.label : 'Audio output device')

    opts.logger?.debug?.(
      'audio: processed device[%d]: id="%s", final="%s", isVirtual=%s',
      i,
      out.deviceId,
      finalLabel,
      isVirtual,
    )

    // CRITICAL: WebAudio devices MUST use Chromium's deviceId, never native OS IDs!
    devices.push({
      id: out.deviceId,
      label: finalLabel,
      isDefault: out.deviceId === 'default',
      isVirtual,
    })
  }

  if (devices.length > 0) return devices

  // Fallback only if enumerateDevices returned nothing (e.g. headless unit tests)
  if (bridgeDevices.length > 0) {
    const fallbackLabel = cleanAndTagDeviceLabel(bridgeDevices[0]!.label).label || 'Audio output device'
    opts.logger?.warn?.('audio: fallback to bridge devices (1 device): %s', fallbackLabel)
    return [
      {
        id: 'default',
        label: fallbackLabel,
        isDefault: true,
        isVirtual: Boolean(bridgeDevices[0]!.isVirtual),
      },
    ]
  }

  opts.logger?.warn?.('audio: default fallback (no devices discovered anywhere)')
  return [{ id: 'default', label: 'Audio output device', isDefault: true, isVirtual: false }]
}
