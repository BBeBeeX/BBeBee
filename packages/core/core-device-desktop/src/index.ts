/**
 * `ctx.device` on desktop.
 *
 * Three unrelated things the OS knows and a plugin must not ask it directly:
 * what the network is doing, what the battery is doing, and which keys the
 * user pressed. They live together because they share one property — a plugin
 * that needs them must not import platform SDKs.
 *
 * The split is by *where the answer lives*, not by taste. Network and battery
 * are renderer-side (Chromium exposes both); media keys and global hotkeys are
 * `main`-side, because a renderer cannot register a system-wide accelerator.
 *
 * ⚠️ Everything here degrades rather than throws. A renderer without
 * `navigator.connection` still answers `network()`; a host with no
 * `globalShortcut` still returns a disposer. A missing OS capability must cost
 * a feature, never a boot.
 *
 * See docs/04 §11 and docs/11 §4.3.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  Disposable,
  DeviceService,
  FormFactor,
  MediaKey,
  NetworkState,
  Platform,
} from '@BBeBee/protocol'
import { requireBridge } from '@bbebee/core-desktop-bridge'
import type { BridgeApi } from '@bbebee/core-desktop-bridge'

/** The slice of `navigator` used, structurally so tests can supply their own. */
export interface NavigatorLike {
  onLine?: boolean
  language?: string
  connection?: {
    type?: string
    effectiveType?: string
    saveData?: boolean
    addEventListener?(type: string, cb: () => void): void
    removeEventListener?(type: string, cb: () => void): void
  }
  getBattery?(): Promise<BatteryLike>
}

export interface BatteryLike {
  level: number
  charging: boolean
  addEventListener?(type: string, cb: () => void): void
  removeEventListener?(type: string, cb: () => void): void
}

/** The slice of the window used for online/offline. */
export interface EventTargetLike {
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

export interface DeviceTauriConfig {
  appVersion?: string
  platform?: Platform
  navigator?: NavigatorLike
  window?: EventTargetLike
  bridge?: BridgeApi
}

export class DeviceTauri extends Service implements DeviceService {
  readonly platform: Platform
  readonly formFactor: FormFactor = 'desktop'
  readonly appVersion: string

  private readonly nav?: NavigatorLike
  private readonly win?: EventTargetLike
  private readonly bridge?: BridgeApi

  private readonly networkListeners = new Set<(s: NetworkState) => void>()
  private readonly mediaKeyListeners = new Set<(k: MediaKey) => void>()
  private readonly hotkeys = new Map<string, Set<() => void>>()
  private offBridge?: () => void
  private teardown: (() => void)[] = []

  constructor(ctx: Context, config: DeviceTauriConfig = {}) {
    super(ctx, 'device')
    this.platform = config.platform ?? detectPlatform()
    this.appVersion = config.appVersion ?? '0.0.0'
    this.nav = config.navigator ?? (globalThis.navigator as NavigatorLike | undefined)
    this.win = config.window ?? (globalThis as unknown as EventTargetLike | undefined)
    this.bridge = config.bridge ?? tryBridge()
  }

  get locale(): string {
    return this.nav?.language ?? 'en'
  }

  async [Service.init]() {
    const notify = () => {
      void this.network().then((state) => {
        for (const cb of [...this.networkListeners]) cb(state)
      })
    }

    // `online`/`offline` cover the coarse transition; `connection.change`
    // covers metered↔unmetered, which is what `saveData` turns on.
    if (this.win?.addEventListener) {
      this.win.addEventListener('online', notify)
      this.win.addEventListener('offline', notify)
      this.teardown.push(() => {
        this.win?.removeEventListener('online', notify)
        this.win?.removeEventListener('offline', notify)
      })
    }
    const connection = this.nav?.connection
    if (connection?.addEventListener) {
      connection.addEventListener('change', notify)
      this.teardown.push(() => connection.removeEventListener?.('change', notify))
    }

    this.offBridge = this.bridge?.on((event) => {
      if (event.topic === 'media-key') {
        for (const cb of [...this.mediaKeyListeners]) cb(event.key)
        return
      }
      if (event.topic === 'hotkey') {
        for (const cb of [...(this.hotkeys.get(event.accelerator) ?? [])]) cb()
      }
    })

    return () => {
      for (const off of this.teardown) off()
      this.teardown = []
      this.offBridge?.()
      this.networkListeners.clear()
      this.mediaKeyListeners.clear()
      // Registered accelerators live in `main`; dropping the local map is not
      // enough, or the next launch finds them still taken.
      for (const accelerator of this.hotkeys.keys()) {
        void this.bridge?.call('system', 'unregisterHotkey', [accelerator]).catch(() => {})
      }
      this.hotkeys.clear()
    }
  }

  /**
   * What the network is doing.
   *
   * `metered` is the one field with real consequences — it becomes
   * `StreamPrefs.saveData` and gates downloads — so it is derived
   * conservatively: Chromium only reports `saveData` when the user asked for
   * data saving, and cellular on a desktop is rare but real.
   */
  async network(): Promise<NetworkState> {
    const online = this.nav?.onLine ?? true
    const connection = this.nav?.connection
    const type = normaliseType(connection?.type)
    return {
      online,
      type,
      metered: connection?.saveData === true || type === 'cellular',
    }
  }

  onNetworkChange(cb: (s: NetworkState) => void): Disposable {
    this.networkListeners.add(cb)
    return () => void this.networkListeners.delete(cb)
  }

  async battery(): Promise<{ level: number; charging: boolean } | undefined> {
    // Absent on most desktops and behind a flag in some builds. `undefined`
    // is a real answer here — "there is no battery" — not a failure.
    if (!this.nav?.getBattery) return undefined
    try {
      const battery = await this.nav.getBattery()
      return { level: battery.level, charging: battery.charging }
    } catch {
      return undefined
    }
  }

  onMediaKey(cb: (key: MediaKey) => void): Disposable {
    this.mediaKeyListeners.add(cb)
    void this.bridge?.call('system', 'watchMediaKeys', [true]).catch(() => {})
    return () => {
      this.mediaKeyListeners.delete(cb)
      if (this.mediaKeyListeners.size === 0) {
        void this.bridge?.call('system', 'watchMediaKeys', [false]).catch(() => {})
      }
    }
  }

  /**
   * Register a system-wide accelerator.
   *
   * Several callers may want one accelerator, so registration is refcounted:
   * `main` is told once, and only told to release when the last caller goes.
   * Without that, two plugins binding `MediaPlayPause` means the first
   * disposal silently unbinds the second.
   */
  registerHotkey(accelerator: string, cb: () => void): Disposable {
    let bucket = this.hotkeys.get(accelerator)
    if (!bucket) {
      bucket = new Set()
      this.hotkeys.set(accelerator, bucket)
      void this.bridge?.call('system', 'registerHotkey', [accelerator]).catch((error: unknown) => {
        // An accelerator another app already owns is a normal outcome, not an
        // error the caller can do anything about.
        this.ctx.logger.info(`device: could not register ${accelerator}: ${String(error)}`)
      })
    }
    bucket.add(cb)

    return () => {
      const current = this.hotkeys.get(accelerator)
      if (!current) return
      current.delete(cb)
      if (current.size > 0) return
      this.hotkeys.delete(accelerator)
      void this.bridge?.call('system', 'unregisterHotkey', [accelerator]).catch(() => {})
    }
  }
}

function normaliseType(type: string | undefined): NetworkState['type'] {
  switch (type) {
    case 'wifi':
    case 'cellular':
    case 'ethernet':
      return type
    case 'none':
      return 'none'
    default:
      return 'unknown'
  }
}

function detectPlatform(): Platform {
  const p = (globalThis as { process?: { platform?: string } }).process?.platform
  if (p === 'darwin') return 'macos'
  if (p === 'win32') return 'windows'
  return 'linux'
}

function tryBridge(): BridgeApi | undefined {
  try {
    return requireBridge()
  } catch {
    return undefined
  }
}

export const name = 'core-device-desktop'

export async function apply(ctx: Context, config: DeviceTauriConfig = {}) {
  ctx.logger.info('core-device-desktop: loaded')
  const fiber = await ctx.plugin(DeviceTauri, config)
  return () => void fiber.dispose()
}

export default { name, apply }
