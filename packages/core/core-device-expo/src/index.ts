/**
 * `ctx.device` on iOS and Android.
 *
 * The counterpart of `core-device-tauri`, and deliberately the same shape:
 * what the network is doing, what the battery is doing, and which keys the
 * user pressed. The last of those is a desktop concept, so it is a no-op
 * disposer here rather than a thrown error — a plugin asking for a media key
 * on a phone should get "nothing will happen", not a crash (docs/04 §11).
 *
 * ⚠️ Everything degrades rather than throws. A build without `expo-battery`
 * linked still answers `battery()` with `undefined`; a device that will not
 * report its connection type still answers `network()`. A missing OS
 * capability must cost a feature, never a boot.
 *
 * See docs/04 §11 and docs/11 §4.3.
 */

import { Platform as RNPlatform, NativeModules } from 'react-native'
import * as Network from 'expo-network'
import * as Battery from 'expo-battery'
import * as Application from 'expo-application'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  DeviceService,
  Disposable,
  FormFactor,
  MediaKey,
  NetworkState,
  Platform,
} from '@BBeBee/protocol'

export interface DeviceExpoConfig {
  /** Overrides the version read from the native bundle. Tests, mostly. */
  appVersion?: string
  /** Overrides the locale derived from the OS. */
  locale?: string
  /** `phone` unless the shell knows better. iPads report `tablet`. */
  formFactor?: FormFactor
}

/**
 * Expo's connection types, as the protocol names them.
 *
 * Mapped explicitly rather than lowercased, so a new member upstream shows up
 * as `unknown` — which is honest — instead of as a string nothing branches on.
 */
function toNetworkType(type: Network.NetworkStateType | undefined | null): NetworkState['type'] {
  switch (type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi'
    case Network.NetworkStateType.CELLULAR:
      return 'cellular'
    case Network.NetworkStateType.ETHERNET:
      return 'ethernet'
    case Network.NetworkStateType.NONE:
      return 'none'
    default:
      return 'unknown'
  }
}

/**
 * The OS locale, without a dependency for it.
 *
 * `expo-localization` would be another native module for one string that both
 * platforms already expose to JS. Falls back to `en` rather than throwing,
 * because a missing locale is a formatting inconvenience and not a reason to
 * fail to start.
 */
function osLocale(): string {
  try {
    const settings = NativeModules['SettingsManager']?.settings as
      | { AppleLocale?: string; AppleLanguages?: string[] }
      | undefined
    if (RNPlatform.OS === 'ios') {
      const raw = settings?.AppleLocale ?? settings?.AppleLanguages?.[0]
      if (raw) return raw.replace('_', '-')
    } else {
      const raw = NativeModules['I18nManager']?.localeIdentifier as string | undefined
      if (raw) return raw.replace('_', '-')
    }
  } catch {
    /* a bare JS runtime in a test has no native modules */
  }
  return 'en'
}

export class DeviceExpo extends Service implements DeviceService {
  readonly platform: Platform
  readonly formFactor: FormFactor
  readonly appVersion: string
  readonly locale: string

  private readonly networkListeners = new Set<(s: NetworkState) => void>()
  private networkSubscription?: { remove(): void }

  constructor(ctx: Context, config: DeviceExpoConfig = {}) {
    super(ctx, 'device')
    this.platform = RNPlatform.OS === 'ios' ? 'ios' : 'android'
    this.formFactor = config.formFactor ?? 'phone'
    this.appVersion = config.appVersion ?? Application.nativeApplicationVersion ?? '0.0.0'
    this.locale = config.locale ?? osLocale()
  }

  async network(): Promise<NetworkState> {
    try {
      const state = await Network.getNetworkStateAsync()
      const type = toNetworkType(state.type)
      return {
        online: state.isInternetReachable ?? state.isConnected ?? false,
        type,
        /*
         * `metered` is what the download policies branch on (docs/11 §4.3),
         * and neither platform reports it directly. Cellular is metered;
         * everything else is assumed not to be. That is wrong for a tethered
         * hotspot and right the rest of the time, and erring towards "not
         * metered" would spend someone's data plan.
         */
        metered: type === 'cellular',
      }
    } catch {
      // A permissions refusal or a module that is not linked. "Unknown and
      // online" keeps the app usable; claiming offline would not.
      return { online: true, type: 'unknown', metered: false }
    }
  }

  onNetworkChange(cb: (s: NetworkState) => void): Disposable {
    this.networkListeners.add(cb)
    // Subscribed once for all listeners: the OS event is a broadcast, and one
    // native subscription per caller is a native leak per caller.
    this.networkSubscription ??= Network.addNetworkStateListener(() => {
      void this.network().then((state) => {
        for (const listener of [...this.networkListeners]) listener(state)
      })
    })

    return () => {
      this.networkListeners.delete(cb)
      if (this.networkListeners.size === 0) {
        this.networkSubscription?.remove()
        this.networkSubscription = undefined
      }
    }
  }

  async battery(): Promise<{ level: number; charging: boolean } | undefined> {
    try {
      const [level, state] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
      ])
      return {
        level,
        charging:
          state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
      }
    } catch {
      // A simulator, or a device that will not say. `undefined` is the
      // contract for "no answer", and every caller already handles it.
      return undefined
    }
  }

  /**
   * ⚠️ Desktop only, by the contract.
   *
   * Media *keys* are the desktop surface; the mobile equivalent is the lock
   * screen, which is `ctx.mediaSession`'s job and reaches `ctx.player` through
   * `onCommand`. Returning a no-op disposer rather than throwing is what the
   * contract asks for — a plugin written once for both targets calls this on
   * both, and a throw would make that plugin platform-specific again.
   */
  onMediaKey(_cb: (key: MediaKey) => void): Disposable {
    return () => {}
  }

  /** Same reasoning: there are no system-wide accelerators on a phone. */
  registerHotkey(_accelerator: string, _cb: () => void): Disposable {
    return () => {}
  }

  async [Service.init]() {
    return () => {
      this.networkSubscription?.remove()
      this.networkSubscription = undefined
      this.networkListeners.clear()
    }
  }
}

export const name = 'core-device-expo'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.device` is usable.
 */
export async function apply(ctx: Context, config: DeviceExpoConfig = {}) {
  ctx.logger.info('core-device-expo: loaded')
  const fiber = await ctx.plugin(DeviceExpo, config)
  return () => void fiber.dispose()
}

export default { name, apply }
