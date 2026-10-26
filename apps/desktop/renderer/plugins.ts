/**
 * What the desktop shell runs — as data, importing nothing.
 *
 * Separate from `boot.ts` because `boot.ts` reaches for desktop host bindings and the
 * preload bridge, and this has to be readable by a test that does neither.
 * The registry is generated from the manifests; *this* is the allowlist, and
 * configuration is the allowlist: a package being bundled is not on its own
 * enough to run it (docs/03 §6.4).
 */

import type { AppConfig } from '@BBeBee/kernel'
import type { PluginManifest } from '@BBeBee/protocol'

/**
 * The services the bootstrap array provides.
 *
 * Load-bearing rather than documentation: `boot()` waits on exactly this list,
 * so a name here that nothing registers becomes a startup error that says
 * which service is missing — instead of a feature plugin sitting PENDING
 * forever behind a screen that renders empty for no visible reason.
 *
 * Keep it in step with the `bootstrap:` array in `boot.ts`. The conventions
 * test asserts every service a configured plugin injects is either in this
 * list or contributed by another configured plugin.
 */
export const BOOTSTRAP_SERVICES = [
  'paths',
  'fs',
  'store',
  'db',
  'device',
  'background',
  'mediaSession',
  'secrets',
  'js',
  'codec',
  'http',
  'audio',
  // Layer 3. `plugin-log-buffer` is a bootstrap entry like the services above
  // it, so the service it contributes is promised here rather than being
  // reached through the registry (docs/09 §1).
  'logBuffer',
] as const

/**
 * The shell's own service declaration — NOT a plugin.
 *
 * Some services reach `ctx` from the composition root itself (the
 * `bootstrap:` array in `boot.ts`) rather than from a plugin the registry
 * loads. Install-time service availability (plugin-manager) and the
 * manifest-completeness gate are judged against *manifests*, so a service
 * provided only by shell wiring would be invisible to both — refused at
 * install time on every machine despite being right there on `ctx`. This
 * declaration is where such a service is written down: `boot.ts` feeds it
 * to plugin-manager through the ordinary `registerManifests` channel, and
 * the gate in `manifest-standards.test.ts` counts it as coverage.
 *
 * Today `contributes.services` is **empty**, on purpose: every bootstrap
 * service is provided by a core package whose own manifest already
 * declares it (core-desktop-bridge declares `fs`/`db`/`paths`/`codec`,
 * core-store-fs declares `store`, and so on), and `DesktopAudioService` —
 * the one service class that lives in `boot.ts` itself — re-provides
 * `audio`, which core-audio-mpv's manifest declares. If a future change
 * wires a service directly in `boot.ts` (or another shell file) with no
 * providing package manifest behind it, its key MUST be added here, or
 * the completeness gate fails.
 *
 * `entry.main` is empty: that is the declaration-only marker. There is no
 * code to load — this record is never added to the app registry, and
 * plugin-manager does not list entry-less manifests as plugins.
 */
export const SHELL_MANIFEST: PluginManifest = {
  id: '@BBeBee/app-shell',
  name: '@BBeBee/app-shell',
  displayName: 'Desktop Shell',
  description:
    'The desktop composition root itself. Declares services the shell provides directly, outside any plugin manifest; not a loadable plugin.',
  version: '0.0.0',
  author: 'BBeBee Team',
  engines: { BBeBee: '^0.1.0' },
  enabled: true,
  dependencies: [],
  systemId: 'layer-5',
  moduleId: 'shell',
  entry: { main: '' },
  capabilities: [],
  contributes: { services: [] },
  effect: null,
}

export const ENABLED: NonNullable<AppConfig['plugins']> = {
  '@bbebee/plugin-theme': {},
  '@bbebee/plugin-theme-ui-desktop': {},
  '@bbebee/plugin-ui': {},
  /*
   * No `plugin-log-*` here, deliberately. The logs layer loads from the
   * `bootstrap:` array in `boot.ts`, which is what puts it between the core
   * services and the feature plugins — a transport in this list would start
   * alongside the features it is meant to be recording (docs/09 §1).
   */
  '@bbebee/plugin-inspector': {},
  '@bbebee/plugin-inspector-ui-desktop': {},
  '@bbebee/plugin-manager': { config: { platform: 'desktop' } },

  // ctx.i18n — interface language, resolved from settings.language ('zh'/'en'/'system')
  // with BCP 47 negotiation through ctx.device.locale. Loaded early because
  // view packages read it, but load order is inject-derived, not positional.
  '@bbebee/plugin-i18n': {},

  // M1's feature set. Load order is derived from `inject`, never declared
  // here: `plugin-player` waits for ctx.audio and ctx.sources, `plugin-source-*`
  // wait for ctx.sources, and none of them is sequenced (docs/02 §3).
  '@bbebee/plugin-sources': {},
  '@bbebee/plugin-sources-ui-desktop': {},
  // The album page, extracted from `plugin-sources`: route and view only, with
  // the reads still on `ctx.sources` (MD-3).
  '@bbebee/plugin-album': {},
  '@bbebee/plugin-album-ui-desktop': {},
  '@bbebee/plugin-local-scanner': {},
  '@bbebee/plugin-local-scanner-ui-desktop': {},
  '@bbebee/plugin-source-local': {},
  '@bbebee/plugin-source-runtime': {},
  // Covers and remote streams are served from disk, fetched only on a miss.
  '@bbebee/plugin-cache': {},
  // Car mode, headless on desktop: the state machine runs (trigger matching,
  // the settings seam), nothing auto-activates it here — no charging, no
  // docking. Both shells run the feature itself (shells.test.ts parity).
  '@bbebee/plugin-car-mode': {},
  // Hooks `player/before-resolve`: a file the user downloads is kept under
  // `ctx.paths.downloads`, and every later play opens it. Disabling it leaves
  // playback streaming, with no branch in the player either way.
  '@bbebee/plugin-download': {},
  '@bbebee/plugin-download-ui-desktop': {},
  // Curation: playlists, favorites, collections and smart playlists. Its
  // routes put Playlists and Favorites in the sidebar; the playlist detail
  // screen is reached from the list, so it has no placement (docs/08 §3).
  '@bbebee/plugin-library': {},
  '@bbebee/plugin-library-ui-desktop': {},
  '@bbebee/plugin-player': {
    config: {
      bufferMaxBytes: 500 * 1024 * 1024,
    },
  },
  // The "what is playing" surfaces and the up-next list, extracted from
  // `plugin-player`: the full-screen player, the bar that opens it, and the
  // queue screen. `plugin-player` itself is headless now — commands only.
  '@bbebee/plugin-now-playing': {},
  '@bbebee/plugin-now-playing-ui-desktop': {},
  '@bbebee/plugin-lyric-sources': {},
  '@bbebee/plugin-lyrics': {},
  '@bbebee/plugin-lyrics-ui-desktop': {},
  '@bbebee/plugin-desktop-lyrics': {},
  '@bbebee/plugin-desktop-lyrics-ui-desktop': {},
  '@bbebee/plugin-mini-player': {},
  '@bbebee/plugin-mini-player-ui-desktop': {},
  '@bbebee/plugin-queue': {},
  '@bbebee/plugin-queue-ui-desktop': {},
  '@bbebee/plugin-history': {},
  '@bbebee/plugin-history-ui-desktop': {},
  '@bbebee/plugin-settings': {},
  '@bbebee/plugin-settings-ui-desktop': {},
  '@bbebee/plugin-sleep-timer': {},
  '@bbebee/plugin-desktop-taskbar': {},
  '@bbebee/plugin-dsp': {},
  '@bbebee/plugin-dsp-ui-desktop': {},
  '@bbebee/plugin-visualizer': {},
  '@bbebee/plugin-visualizer-ui-desktop': {},
  '@bbebee/plugin-share': {},
  '@bbebee/plugin-share-ui-desktop': {},
  // The community content index — update checks and installs for sources,
  // lyric sources, themes and desktop plugins. Headless service; installs of
  // the plugin kind reach the dynamic host through the bridge wired in
  // boot.ts.
  '@bbebee/plugin-registry': {},
  // Lazy GitHub star/contributor counts for registry entries — fetched only
  // when the Discover page's sort controls ask, cached for 24h, degraded on
  // failure. Headless; both shells run it (the kernel's shells.test.ts pins
  // feature parity, and nothing reads the service unless that UI asks).
  '@bbebee/plugin-registry-metadata': {},
  // Its desktop views: the Discover (registry) screen and the sources-section
  // settings card. Deferred together with the service — neither is needed
  // for first paint, and the route lands in the sidebar when the pair loads.
  '@bbebee/plugin-registry-ui-desktop': {},
  // Audio format converter & compressor
  '@bbebee/plugin-audio-converter': {},
  '@bbebee/plugin-audio-converter-ui-desktop': {},
}

/**
 * Plugins deferred until after the first frame has rendered.
 * These are not needed for initial screen rendering and loading them
 * during idle reduces initial startup time without changing the feature set.
 */
export const DEFERRED_PLUGIN_IDS = [
  '@bbebee/plugin-local-scanner',
  '@bbebee/plugin-local-scanner-ui-desktop',
  '@bbebee/plugin-download',
  '@bbebee/plugin-download-ui-desktop',
  '@bbebee/plugin-audio-converter',
  '@bbebee/plugin-audio-converter-ui-desktop',
  '@bbebee/plugin-share',
  '@bbebee/plugin-share-ui-desktop',
  '@bbebee/plugin-visualizer',
  '@bbebee/plugin-visualizer-ui-desktop',
  '@bbebee/plugin-sleep-timer',
  '@bbebee/plugin-history',
  '@bbebee/plugin-history-ui-desktop',
  // A network-touching service nothing on the first screen reads — its
  // auto-check runs on its own timer, so it belongs with the other
  // post-first-frame plugins.
  '@bbebee/plugin-registry',
  // Repo stats are read only from the Discover screen's sort controls — never on
  // the first screen — so it defers with the rest of the registry trio.
  '@bbebee/plugin-registry-metadata',
  // The registry's desktop views ride along with the service: the route
  // contribution only exists once the service loads anyway, so deferring the
  // pair together changes nothing about when the sidebar entry appears.
  '@bbebee/plugin-registry-ui-desktop',
] as const

export const INITIAL_ENABLED: NonNullable<AppConfig['plugins']> = Object.fromEntries(
  Object.entries(ENABLED).filter(
    ([id]) => !DEFERRED_PLUGIN_IDS.includes(id as (typeof DEFERRED_PLUGIN_IDS)[number]),
  ),
)

