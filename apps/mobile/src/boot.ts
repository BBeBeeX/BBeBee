/**
 * The mobile bootstrap — the **composition root**.
 *
 * One of docs/02 §1's three deliberate exceptions to the layer model, named by
 * path in `eslint.config.js`: the only files allowed to call `createApp` and
 * to import a Layer 2 `core-*` package directly. Wiring, not business
 * function — everything else under `apps/` is plain Layer 4.
 *
 * Compare with `apps/desktop/renderer/boot.ts`: the plugin registry is
 * generated from the same manifests and the config is the same list, and only
 * the core-service registrations differ. That is ADR-3 and the layer model
 * working (docs/02 §3).
 *
 * This file is also the *only* place `react-native` is imported outside a view
 * package: the kit takes its primitives from here, so nothing below the shell
 * has to know what it is rendering into (docs/08 §1).
 */

import { Platform } from 'react-native'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { AudioContext, AudioManager } from 'react-native-audio-api'
import { createApp, createShellGrantResolver, type App } from '@BBeBee/kernel'
import { PLUGIN_MANAGER_ID, type AppSettings } from '@BBeBee/protocol'
import { MOBILE_LAYOUT_MODE_KEY, isMobileLayoutMode, type MobileLayoutMode } from './layout.js'
import { PathsExpo } from '@bbebee/core-paths-expo'
import { FsExpo } from '@bbebee/core-fs-expo'
import { StoreFs } from '@bbebee/core-store-fs'
import { DbExpo } from '@bbebee/core-db-expo'
import { SecretsExpo } from '@bbebee/core-secrets-expo'
import { DeviceExpo } from '@bbebee/core-device-expo'
import { BackgroundExpo } from '@bbebee/core-background-expo'
import { MediaSessionRn } from '@bbebee/core-media-session-rn'
import { CodecRn } from '@bbebee/core-codec-rn'
import { HttpRn } from '@bbebee/core-http-rn'
import { AudioMpv } from '@bbebee/core-audio-mpv'
import {
  MobileAudioService,
  createMobileMpvBridge,
  type MobileAudioConfig,
} from './mobile-audio.js'
import { configureNative } from '@BBeBee/ui-kit-mobile'

export { MobileAudioService, createMobileMpvBridge, type MobileAudioConfig }

import { bundled } from '../generated/plugins'
/*
 * The logs layer (Layer 3). Imported here rather than enabled through the
 * registry because it has to be *running* before the feature plugins whose
 * first lines it exists to capture — see the bootstrap array below.
 */
import logBuffer from '@bbebee/plugin-log-buffer'
import logConsole from '@bbebee/plugin-log-console'
import logFile from '@bbebee/plugin-log-file'

import { BOOTSTRAP_SERVICES, ENABLED } from './plugins'

/**
 * Metro defines this in every bundle; it is `false` in a release build.
 *
 * Declared locally rather than pulled from a global types package so this file
 * does not depend on which React Native types happen to be in scope.
 */
declare const __DEV__: boolean

/**
 * Whether the mobile app is running in debug mode.
 *
 * Enabled by default in development (`__DEV__`), and always off in release
 * builds. Can be explicitly overridden in dev via `EXPO_PUBLIC_DEBUG=0`,
 * `DEBUG=0`, `BBEBEE_DEBUG=0`, or global flag `__DEBUG__`.
 */
export function isDebug(): boolean {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return false
  if (typeof (globalThis as unknown as { __DEBUG__?: boolean }).__DEBUG__ === 'boolean') {
    return (globalThis as unknown as { __DEBUG__?: boolean }).__DEBUG__ === true
  }
  const envDebug =
    typeof process !== 'undefined' && process.env
      ? process.env['EXPO_PUBLIC_DEBUG'] ?? process.env['DEBUG'] ?? process.env['BBEBEE_DEBUG']
      : undefined
  if (envDebug === '0' || envDebug === 'false') return false
  if (envDebug !== undefined && envDebug !== '') return true
  return typeof __DEV__ !== 'undefined' ? __DEV__ : true
}

/**
 * Hand the kit its primitives, once, before anything renders.
 *
 * `ui-kit-mobile` deliberately does not import `react-native` itself — that is
 * what lets it be unit-tested off-device — so a shell that forgets this call
 * gets host elements named `View` and `Text` and an obviously wrong screen
 * (docs/08 §6).
 */
configureNative({
  View,
  Text,
  Pressable,
  Image,
  Modal,
  FlashList,
  ActivityIndicator,
  TextInput,
})

/**
 * The audio session, started before the graph.
 *
 * `setAudioSessionActivity(true)` is what buys background time: iOS keeps the
 * process scheduled for `UIBackgroundModes: audio`, and Android's media
 * notification holds a foreground service. `ctx.background` reports
 * `canRunInBackground()` from this rather than hardcoding it, so the two
 * cannot disagree (docs/11 §4.3).
 */
async function startAudioSession(background: BackgroundExpo): Promise<void> {
  try {
    AudioManager.observeAudioInterruptions(true)
    await AudioManager.setAudioSessionActivity(true)
    background.setSessionActive(true)
  } catch {
    // A build without the native module, or a refused session. Playback will
    // fail later with a message about audio; the app still starts.
    background.setSessionActive(false)
  }
}

export async function boot(): Promise<App> {
  const app = createApp({
    target: Platform.OS === 'ios' ? 'ios' : 'android',
    bootstrap: [
      PathsExpo,
      FsExpo,
      StoreFs,
      DbExpo,
      // The keychain. Cookie jars are envelope-encrypted under a key that
      // lives here, so it comes before `HttpRn` (docs/04 §2.1).
      SecretsExpo,

      [DeviceExpo, { appVersion: '0.0.0' }],
      BackgroundExpo,
      MediaSessionRn,

      /*
       * The M1 platform floor.
       *
       * Bootstrap entries rather than registry ones, for the same reason as on
       * desktop: `plugin-player` injects `audio`, `plugin-local-scanner`
       * injects `codec` and `plugin-source-runtime` injects `http`. A required
       * dependency reachable through the same config allowlist as its
       * dependent can be switched off from the wrong end, and the symptom is a
       * fiber sitting PENDING with no obvious cause.
       */
      CodecRn,
      HttpRn,
      /*
       * `ctx.audio` — the mobile audio engine:
       * @bbebee/core-audio-mpv over the in-process libmpv JNI/JSI bridge.
       */
      [
        MobileAudioService,
        {
          mpvPlugin: AudioMpv,
          createContext: () => new AudioContext(),
        },
      ],

      /*
       * The logs layer — Layer 3, and it sits here for the reason the layer
       * exists: after the core services it writes through, before every
       * feature plugin whose lines it must not miss (docs/09 §1).
       *
       * Identical to desktop's, down to the split docs/04 §16 describes: the
       * buffer always, because the in-app log viewer and a crash report read
       * from it; the console only in development, where someone is watching
       * it; the file only in a shipped build, where nobody is and the log has
       * to survive being closed.
       */
      [logBuffer, {}],
      ...(isDebug()
        ? ([[logConsole, { level: 3, debug: true }]] as const)
        : ([[logFile, { level: 2 }]] as const)),
    ],
    registry: bundled,
    config: { plugins: ENABLED },
    // Capability grants live in the db DbExpo provides; the kernel
    // resolves them after bootstrap and before every dynamic load, so
    // the loader's gate sees the user's recorded approvals (W1). Mobile
    // has no dynamic installs today — every bundled plugin is builtin
    // and exempt — but the gate must not silently depend on that.
    //
    // Same composed resolver as desktop (shared from the kernel, so
    // the two shells cannot drift): the ledger plus plugin-manager's
    // settings-derived download hosts, re-derived at every
    // resolution. A running plugin-manager keeps the grants its
    // fiber was created with, so a network-settings change takes
    // gate effect at its next load (in practice the next launch).
    resolveGrants: createShellGrantResolver({
      managerManifestCapabilities: bundled[PLUGIN_MANAGER_ID]?.manifest.capabilities,
    }),
  })
  await app.start()

  /*
   * Every core service this shell claims to provide must actually be there.
   *
   * ⚠️ The check whose absence let this shell ship as M0 for a whole milestone:
   * it bootstrapped four services and the M0 demo plugin while every M1 package sat
   * built, tested and unreferenced. A fiber waiting forever for a service that
   * will never arrive is indistinguishable from one that is merely slow, so the
   * only place to catch it is here, where what was registered is known.
   */
  await app.ready([...BOOTSTRAP_SERVICES], { timeoutMs: 15_000 })

  /*
   * The configured `User-Agent`, applied once settings exist and kept in step
   * from then on. Same contract as desktop: the header goes out on the next
   * request, an empty value restores the built-in default, and a source
   * document's own `header` rule still wins. ⚠️ `http` must be in the inject
   * list — the scoped proxy refuses anything not listed, and a throw in a
   * `settings/changed` listener aborts the synchronous emit for everyone after
   * it.
   */
  app.ctx.inject(['settings', 'http'], (scoped) => {
    const syncUserAgent = (s: AppSettings | undefined) => {
      if (s?.userAgent !== undefined) scoped.http?.setUserAgent?.(s.userAgent)
    }
    void scoped.settings.get().then(syncUserAgent)
    scoped.on('settings/changed', syncUserAgent)
  })

  /*
   * The layout-mode row in Settings (auto / tablet / dual screen).
   *
   * A composition-root contribution because the mobile shell owns the
   * behaviour — the same rule as every platform setting with no feature
   * plugin (docs/ui/architecture.md §2). The row reads and writes
   * `ctx.store` directly through `getValues`/`onFieldChange`: the settings
   * document is deliberately NOT a second home for this value, and the
   * shell's own rail/pane buttons write the same key — two affordances, one
   * source of truth.
   *
   * `getValues` is synchronous by contract, so the closure keeps the current
   * mode in `current`: seeded by the async store read at boot, updated by
   * every write. Both paths emit `ui/changed` — the shell re-reads the key
   * on that signal, so a change made here applies live, not on next launch.
   */
  app.ctx.inject(['ui', 'store', 'i18n'], (scoped) => {
    let current: MobileLayoutMode = 'auto'
    void scoped.store
      .get<MobileLayoutMode>(MOBILE_LAYOUT_MODE_KEY)
      .then((stored) => {
        if (isMobileLayoutMode(stored)) {
          current = stored
          scoped.emit('ui/changed')
        }
      })
      .catch(() => {})

    return scoped.effect(function* () {
      yield scoped.ui.contribute({
        kind: 'settings',
        id: 'mobile.layoutMode',
        section: 'general',
        title: 'app:common.app.layoutMode',
        description: 'app:common.app.layoutModeDescription',
        order: 60,
        fields: [
          {
            key: MOBILE_LAYOUT_MODE_KEY,
            label: 'app:common.app.layoutMode',
            type: 'select',
            optionsAsync: async () => [
              { value: 'auto', label: scoped.i18n.t('app:common.app.layoutModeAuto') },
              { value: 'tablet', label: scoped.i18n.t('app:common.app.layoutModeTablet') },
              { value: 'foldable', label: scoped.i18n.t('app:common.app.layoutModeFoldable') },
            ],
          },
        ],
        getValues: () => ({ [MOBILE_LAYOUT_MODE_KEY]: current }),
        onFieldChange: (key, value) => {
          if (key !== MOBILE_LAYOUT_MODE_KEY || !isMobileLayoutMode(value)) return
          current = value
          void scoped.store
            .set(MOBILE_LAYOUT_MODE_KEY, value)
            .then(() => {
              // The store write is silent; layout is UI, so the registry's
              // own change signal is what tells the shell to re-read it.
              scoped.emit('ui/changed')
            })
            .catch(() => {})
        },
      })
    }, 'mobile-layout-mode-setting')
  })

  /*
   * The OS's own audio events, published into `ctx.audio`.
   *
   * `observeAudioInterruptions(true)` below only *enables* the native
   * observation — until something subscribes here, the events it produces
   * fall on the floor: a phone call, an alarm or another app taking audio
   * focus pauses the engine with the transport still claiming `playing`, and
   * not one log line anywhere (docs/05 §5).
   *
   * Desktop needs none of this: there the `AudioContext`'s own state
   * transitions carry the same news, via `emitContextInterruptions` — which
   * stays off here, because these OS events are the informed source and a
   * second one would publish every interruption twice.
   */
  app.ctx.inject(['audio'], (scoped) => {
    const audio = scoped.audio
    const offInterruption = AudioManager.addSystemEventListener('interruption', (event) => {
      // RNAA's payload is the protocol's `InterruptionEvent` verbatim.
      audio.emitInterruption(event)
    })
    const offRouteChange = AudioManager.addSystemEventListener('routeChange', (event) => {
      const reason = RNAA_ROUTE_REASONS[event.reason]
      if (reason) {
        audio.emitRouteChange({ reason })
      } else {
        // 'CategoryChange', 'WakeFromSleep', … — real events, but ones the
        // transport has no policy for; naming them keeps them from looking
        // like a lost `device-removed`.
        app.ctx.logger.debug(`boot: audio route change ignored (${event.reason})`)
      }
    })
    return () => {
      offInterruption?.remove()
      offRouteChange?.remove()
    }
  })

  await startAudioSession(app.ctx.background as BackgroundExpo)
  return app
}

/**
 * RNAA route reasons that map onto the transport's three. The rest have no
 * policy in `ctx.player`, so they are logged and dropped rather than forced
 * into a shape that would say something untrue.
 */
const RNAA_ROUTE_REASONS: Record<string, 'device-removed' | 'device-added' | 'override'> = {
  OldDeviceUnavailable: 'device-removed',
  NewDeviceAvailable: 'device-added',
  Override: 'override',
}
