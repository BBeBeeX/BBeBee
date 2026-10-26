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

import { Appearance, Platform } from 'react-native'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { AudioContext, AudioManager } from 'react-native-audio-api'
import { File, Paths } from 'expo-file-system'
import { createApp, createShellGrantResolver, type App } from '@BBeBee/kernel'
import {
  isCriticalServiceKey,
  PLUGIN_MANAGER_ID,
  type AppSettings,
  type PluginManifest,
} from '@BBeBee/protocol'
import { MOBILE_LAYOUT_MODE_KEY, isMobileLayoutMode, type MobileLayoutMode } from './layout.js'
import { PathsExpo } from '@bbebee/core-paths-mobile'
import { FsExpo } from '@bbebee/core-fs-mobile'
import { StoreFs } from '@bbebee/core-store-fs'
import { DbExpo } from '@bbebee/core-db-mobile'
import { SecretsExpo } from '@bbebee/core-secrets-mobile'
import { DeviceExpo } from '@bbebee/core-device-mobile'
import { BackgroundExpo } from '@bbebee/core-background-mobile'
import { MediaSessionRn } from '@bbebee/core-media-session-mobile'
import { HapticsExpo } from '@bbebee/core-haptics-mobile'
import { QuickActionsExpo } from '@bbebee/core-quick-actions-mobile'
import { LifecycleExpo } from '@bbebee/core-lifecycle-mobile'
import { LiveActivityIos } from '@bbebee/core-live-activity-mobile'
import { JsSandboxMobile } from '@bbebee/core-js-mobile'
import { CodecRn } from '@bbebee/core-codec-mobile'
import { HttpRn } from '@bbebee/core-http-mobile'
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

import { BOOTSTRAP_SERVICES, INITIAL_ENABLED } from './plugins'

/*
 * The native audio-engine binding, if this build carries it: installs
 * `globalThis.bbebeeMobileMpv` for the audio service to probe. Must run (as
 * an import side effect) before `MobileAudioService` mounts; a build without
 * the native module degrades to the simulation bridge inside the adapter.
 */
import '../modules/audio-engine/index.js'

/**
 * Metro defines this in every bundle; it is `false` in a release build.
 *
 * Declared locally rather than pulled from a global types package so this file
 * does not depend on which React Native types happen to be in scope.
 */
declare const __DEV__: boolean

/*
 * Hermes' `TextDecoder` is UTF-8-only. Two tag paths need more: a Latin-1
 * ID3v2.3 tag written by an old ripper (music-metadata decodes it as
 * latin1) and the codec's GBK mojibake recovery — on a Chinese music
 * library that is the difference between track names and noise. Install the
 * full WHATWG implementation once, before anything reads a tag. Pure JS;
 * the encoding tables cost ~1 MB of bundle, which is the price of old
 * Chinese tags not arriving as mojibake.
 *
 * ⚠️ `text-encoding` *forwards to a pre-existing global* when one exists:
 * its module exports `global['TextDecoder']`, and installs its own only if
 * that slot is empty. On Hermes the slot holds the UTF-8-only native class,
 * so a plain import would re-export the native class and defeat the whole
 * point. The globals are therefore blanked *before* the module evaluates —
 * which is also why both requires are dynamic: a static import would run at
 * bundle init, before this function has had its chance.
 */
declare const require: (id: string) => unknown

function installFullTextDecoding(): void {
  try {
    new TextDecoder('gbk')
    return // The runtime already carries the full encoding table.
  } catch {
    // Fall through and install the polyfill.
  }
  const g = globalThis as {
    TextDecoder?: unknown
    TextEncoder?: unknown
    'encoding-indexes'?: unknown
  }
  const indexes = require('text-encoding/lib/encoding-indexes.js') as {
    'encoding-indexes'?: unknown
  }
  // The tables module only auto-attaches under Node; Metro never runs that
  // path, so hand them over explicitly.
  g['encoding-indexes'] ??= indexes['encoding-indexes']
  g['TextDecoder'] = undefined
  g['TextEncoder'] = undefined
  require('text-encoding')
}
installFullTextDecoding()

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
  ScrollView,
  /*
   * The OS light/dark answer, for the theme layer: without it, appearance
   * mode 'system' degrades to dark even when the phone is set to light.
   * `plugin-theme-ui-mobile`'s palette drive reads it back and subscribes to
   * its change events, so the scheme follows the OS toggle live.
   *
   * Adapted rather than passed raw: RN's `getColorScheme` also types
   * `undefined` into its answer, and the kit's `AppearanceLike` contract
   * (deliberately narrower) promises `null` for "unset".
   */
  Appearance: {
    // RN also answers 'unspecified'; the kit's contract narrows that to null.
    getColorScheme: () => {
      const scheme = Appearance.getColorScheme()
      return scheme === 'light' ? 'light' : scheme === 'dark' ? 'dark' : null
    },
    addChangeListener: (listener) =>
      Appearance.addChangeListener((prefs) => {
        // Same narrowing on the change stream.
        listener({ colorScheme: prefs.colorScheme === 'light' ? 'light' : prefs.colorScheme === 'dark' ? 'dark' : null })
      }),
  },
})

/**
 * The audio session, started before the graph.
 *
 * `setAudioSessionActivity(true)` is what buys background time: iOS keeps the
 * process scheduled for `UIBackgroundModes: audio`, and Android's media
 * notification holds a foreground service. `ctx.background` reports
 * `canRunInBackground()` from this rather than hardcoding it, so the two
 * cannot disagree (docs/11 §4.3). Its counterpart — deactivation on
 * teardown — is the disposer in the `inject(['audio'])` wiring below.
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

// =============================================================================
// Pre-boot store read & plugin enablement
// =============================================================================

interface PreloadedStore {
  storeData?: Record<string, unknown>
  /** The persisted audio exclusive-mode flag, for the audio service's seed. */
  audioExclusive?: boolean
}

/**
 * Read `store.json` before the app starts — the mobile counterpart of
 * desktop's `preloadPreferences`.
 *
 * Three consumers, one disk read: `StoreFs` is seeded via `initialData` (so
 * its first `get` does not race the plugin graph), `computeEnabledPlugins`
 * needs the persisted plugin-manager records *before* the config is built —
 * a plugin the user disabled must not start, not even for the span of one
 * boot — and the audio service's exclusive-mode seed comes from the settings
 * document. Read through `expo-file-system` directly rather than `FsExpo`:
 * the service needs a live context, and this is exactly the one job the
 * composition root is allowed to do by hand. Same file, same key layout as
 * desktop — `StoreFs` namespacing puts every plugin's keys under its
 * manifest id.
 */
async function preloadStore(): Promise<PreloadedStore> {
  try {
    const uri = `${Paths.document.uri.replace(/\/$/, '')}/store.json`
    const file = new File(uri)
    if (!file.exists) return {}
    const raw = await file.text()
    if (typeof raw !== 'string' || !raw) return {}
    const data = JSON.parse(raw) as Record<string, unknown>
    const result: PreloadedStore = { storeData: data }
    // The settings plugin's own namespace, then the bare legacy key — the
    // same lookup order desktop's preload uses.
    const prefs = (
      data['@bbebee/plugin-settings:preferences'] ?? data['preferences']
    ) as { audioExclusive?: boolean } | undefined
    if (typeof prefs?.audioExclusive === 'boolean') result.audioExclusive = prefs.audioExclusive
    return result
  } catch (err) {
    console.warn('[boot] failed to preload store:', err)
    return {}
  }
}

/**
 * Map a legacy `@BBeBee/` plugin id to its current `@bbebee/` form, so
 * persisted records written before the manifest-id rename still apply.
 * Same rule as desktop's boot and `core-store-fs`'s namespace migration;
 * new ids pass through.
 */
function currentPluginId(id: string): string {
  return id.startsWith('@BBeBee/') ? `@bbebee/${id.slice('@BBeBee/'.length)}` : id
}

/**
 * Which provider wins a service key claimed by more than one plugin.
 *
 * Mirrors `resolveActiveProviders` in `apps/desktop/renderer/dynamic-loader.ts`
 * — duplicated rather than shared because that module also carries the Vite
 * glob registry, which Metro must never see. Mobile has no external installs
 * today, so `npmInstalledIds` is always empty here and the built-in provider
 * wins; the shape is kept identical so a future mobile installer flips the
 * semantics in one place.
 */
function resolveActiveProviders(
  providersByKey: ReadonlyMap<string, readonly string[]>,
  selection: Readonly<Record<string, string>> | undefined,
  npmInstalledIds: ReadonlySet<string>,
  isCriticalKey: (key: string) => boolean,
): Map<string, string> {
  const active = new Map<string, string>()
  for (const [key, providers] of providersByKey) {
    if (providers.length < 2 || isCriticalKey(key)) continue
    const chosen = selection?.[key]
    const winner =
      chosen && providers.includes(chosen)
        ? chosen
        : (providers.find((id) => !npmInstalledIds.has(id)) ?? providers[0]!)
    active.set(key, winner)
  }
  return active
}

/**
 * Compute effective plugin enablement (initial + user overrides + provider
 * arbitration) — the mobile mirror of desktop's `computeEnabledPlugins`.
 *
 * Overrides are the `enabled` map plugin-manager persists under its own
 * store namespace (`@bbebee/plugin-manager:enabled`), written by
 * `setEnabled`. Arbitration holds off every provider of a contended
 * non-critical service key except the user's chosen (or the built-in) one —
 * Cordis refuses duplicate service registrations, so without this a second
 * provider would wedge the graph at boot.
 */
function computeEnabledPlugins(
  storeData: Record<string, unknown> | undefined,
  manifests: Record<string, PluginManifest>,
): typeof INITIAL_ENABLED {
  const effective = { ...INITIAL_ENABLED }
  const rawOverrides = (
    storeData?.['@bbebee/plugin-manager:enabled'] ??
    storeData?.['plugin-manager:enabled']
  ) as Record<string, boolean> | undefined
  // Remap legacy override keys to the renamed ids (new keys win on clash).
  const overrides = rawOverrides
    ? Object.fromEntries(
        Object.entries(rawOverrides).map(([id, enabled]) => [currentPluginId(id), enabled]),
      )
    : undefined

  if (overrides) {
    for (const [id, enabled] of Object.entries(overrides)) {
      if (enabled === false && effective[id]) {
        effective[id] = { ...effective[id], enabled: false }
      } else if (enabled === true) {
        effective[id] = { ...(effective[id] ?? {}), enabled: true }
      }
    }
  }

  // Provider arbitration: a non-critical key with several providers may only
  // start ONE of them. Judged against the whole generated registry (not just
  // the enablement map) so a disabled provider still counts as a contender
  // the way desktop's does.
  const providersByKey = new Map<string, string[]>()
  for (const m of Object.values(manifests)) {
    if (!m.entry?.main) continue
    for (const key of m.contributes?.services ?? []) {
      const arr = providersByKey.get(key) ?? []
      arr.push(m.id)
      providersByKey.set(key, arr)
    }
  }
  if ([...providersByKey.values()].some((ps) => ps.length > 1)) {
    const rawSelection = storeData?.['@bbebee/plugin-manager:service-providers'] as
      | Record<string, string>
      | undefined
    const selection = rawSelection
      ? Object.fromEntries(
          Object.entries(rawSelection).map(([key, provider]) => [key, currentPluginId(provider)]),
        )
      : undefined
    const active = resolveActiveProviders(providersByKey, selection, new Set(), isCriticalServiceKey)
    for (const [key, providers] of providersByKey) {
      const winner = active.get(key)
      if (!winner) continue
      for (const id of providers) {
        if (id !== winner && effective[id] && effective[id].enabled !== false) {
          effective[id] = { ...effective[id], enabled: false }
        }
      }
    }
  }
  return effective
}

/** The manifests behind the generated registry, keyed by plugin id. */
function bundledManifests(): Record<string, PluginManifest> {
  return Object.fromEntries(
    Object.entries(bundled)
      .map(([id, entry]) => [id, entry.manifest] as const)
      .filter((entry): entry is [string, PluginManifest] => Boolean(entry[1])),
  )
}

export async function boot(): Promise<App> {
  // The persisted store, read once before anything else: it seeds `StoreFs`
  // and decides which plugins the first boot starts at all.
  const prefs = await preloadStore()
  const manifests = bundledManifests()
  const enabledPlugins = computeEnabledPlugins(prefs.storeData, manifests)

  const app = createApp({
    target: Platform.OS === 'ios' ? 'ios' : 'android',
    bootstrap: [
      PathsExpo,
      FsExpo,
      [StoreFs, { initialData: prefs.storeData }],
      DbExpo,
      // The keychain. Cookie jars are envelope-encrypted under a key that
      // lives here, so it comes before `HttpRn` (docs/04 §2.1).
      SecretsExpo,

      // `appVersion` reads the native bundle through expo-application inside
      // the service; overriding it here would pin every build to a lie.
      DeviceExpo,
      BackgroundExpo,
      MediaSessionRn,

      /*
       * The system-integration services: haptic feedback, the home-screen
       * quick actions (long-press icon), the AppState/splash lifecycle, and
       * the iOS Live Activity / Dynamic Island surface. Bootstrap entries
       * rather than registry ones for the same reason as the services above
       * them: `plugin-player`'s optional `liveActivity` inject and the
       * quick-action → navigation wiring sit on these keys, and a fiber
       * PENDING behind a disabled provider is invisible from the UI.
       */
      HapticsExpo,
      QuickActionsExpo,
      LifecycleExpo,
      LiveActivityIos,

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
      // The script sandbox — ctx.js for the source runtime, since Hermes has
      // neither WebAssembly nor eval for the desktop QuickJS build.
      JsSandboxMobile,
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
          // Applied at engine mount (desktop seeds its wrapper the same way),
          // so bit-perfect exclusive output is in force from the first load,
          // not from the first settings change.
          ...(prefs.audioExclusive !== undefined
            ? { initialAudioExclusive: prefs.audioExclusive }
            : {}),
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
    config: { plugins: enabledPlugins },
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
   * The configured settings, applied once they exist and kept in step from
   * then on. The mobile slice of desktop's `wireSettingsSync`: the header and
   * the audio-output preferences have the same meaning on both shells, while
   * `closeToTray`, `glass.window`, `proxy` and `audioOutputEngine` are
   * desktop-only concepts (a tray, window material, an OS proxy and a second
   * engine do not exist on this platform — mobile's `switchEngine` is a
   * documented no-op). Same contract as desktop: an empty value restores the
   * built-in default, and a source document's own `header` rule still wins.
   * ⚠️ `http`/`audio` must be in the inject list — the scoped proxy refuses
   * anything not listed, and a throw in a `settings/changed` listener aborts
   * the synchronous emit for everyone after it.
   */
  app.ctx.inject(['settings', 'http', 'audio'], (scoped) => {
    const sync = (s: AppSettings | undefined) => {
      if (!s) return
      if (s.userAgent !== undefined) scoped.http?.setUserAgent?.(s.userAgent)
      if (s.audioOutputDeviceId) {
        void scoped.audio?.setOutputDevice?.(s.audioOutputDeviceId).catch((err) => {
          app.ctx.logger.warn(`boot: applying audio output device failed: ${String(err)}`)
        })
      }
      if (s.audioExclusive !== undefined) {
        void scoped.audio?.setAudioExclusive?.(s.audioExclusive).catch((err) => {
          app.ctx.logger.warn(`boot: applying audio exclusive mode failed: ${String(err)}`)
        })
      }
    }
    void scoped.settings.get().then(sync)
    scoped.on('settings/changed', sync)
  })

  /*
   * The plugin manifests, handed to plugin-manager through the same channel
   * desktop's `wirePluginManager` uses. Without this the service knows no
   * plugins: `list()` is empty, the enable/disable records it persists cannot
   * be aimed at anything, and the deferred-load pass in `App.tsx` could not
   * honour a user's disabled choice. No lifecycle bridge and no installer
   * here — mobile has no dynamic plugin loading (docs/plugins/loading.md §6).
   */
  app.ctx.inject(['plugin-manager'], (scoped) => {
    const pm = (scoped as unknown as { 'plugin-manager'?: { registerManifests(m: Record<string, PluginManifest>): void } })[
      'plugin-manager'
    ]
    pm?.registerManifests(manifests)
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
      /*
       * And the session's other half, on the way out: deactivate what
       * `startAudioSession` claimed — release the OS audio session, and stop
       * letting `canRunInBackground()` speak for a background budget nothing
       * will spend anymore (docs/11 §4.3). This scope ends when the `audio`
       * service is disposed, and only `app.stop()`'s bootstrap unwind ever
       * disposes a bootstrap service, so here "the service died" *is* "the
       * app is tearing down" — this disposer is the composition root's
       * teardown hook. (Cordis 4 has no root 'dispose' event, and `stop()`
       * never disposes the root context, so there is nothing else to hook.)
       * Both calls guarded: a build without the native module must not throw
       * during shutdown, and the background service may already be unwound by
       * the time this runs — degrading silently is the correct failure. The
       * honest caveat: the OS usually kills a mobile process before any of
       * this executes. The clean shutdown is for tests, embedded hosts and a
       * graceful stop — not the common exit.
       */
      try {
        void AudioManager.setAudioSessionActivity(false).catch(() => undefined)
      } catch {
        /* not linked in this build */
      }
      try {
        const background = app.ctx.background as BackgroundExpo | undefined
        background?.setSessionActive(false)
      } catch {
        /* already gone */
      }
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
