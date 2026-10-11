/**
 * What the desktop shell runs — as data, importing nothing.
 *
 * Separate from `boot.ts` because `boot.ts` reaches for Electron and the
 * preload bridge, and this has to be readable by a test that does neither.
 * The registry is generated from the manifests; *this* is the allowlist, and
 * configuration is the allowlist: a package being bundled is not on its own
 * enough to run it (docs/03 §6.4).
 */

import type { AppConfig } from '@BBeBee/kernel'

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

export const ENABLED: NonNullable<AppConfig['plugins']> = {
  '@BBeBee/plugin-theme': {},
  '@BBeBee/plugin-theme-ui-desktop': {},
  '@BBeBee/plugin-ui': {},
  /*
   * No `plugin-log-*` here, deliberately. The logs layer loads from the
   * `bootstrap:` array in `boot.ts`, which is what puts it between the core
   * services and the feature plugins — a transport in this list would start
   * alongside the features it is meant to be recording (docs/09 §1).
   */
  '@BBeBee/plugin-inspector': {},
  '@BBeBee/plugin-inspector-ui-desktop': {},
  '@BBeBee/plugin-manager': {},

  // M1's feature set. Load order is derived from `inject`, never declared
  // here: `plugin-player` waits for ctx.audio and ctx.sources, `plugin-source-*`
  // wait for ctx.sources, and none of them is sequenced (docs/02 §3).
  '@BBeBee/plugin-sources': {},
  '@BBeBee/plugin-sources-ui-desktop': {},
  // The album page, extracted from `plugin-sources`: route and view only, with
  // the reads still on `ctx.sources` (MD-3).
  '@BBeBee/plugin-album': {},
  '@BBeBee/plugin-album-ui-desktop': {},
  '@BBeBee/plugin-local-scanner': {},
  '@BBeBee/plugin-local-scanner-ui-desktop': {},
  '@BBeBee/plugin-source-local': {},
  '@BBeBee/plugin-source-runtime': {},
  // Covers and remote streams are served from disk, fetched only on a miss.
  '@BBeBee/plugin-cache': {},
  // Hooks `player/before-resolve`: a file the user downloads is kept under
  // `ctx.paths.downloads`, and every later play opens it. Disabling it leaves
  // playback streaming, with no branch in the player either way.
  '@BBeBee/plugin-download': {},
  '@BBeBee/plugin-download-ui-desktop': {},
  // Curation: playlists, favourites, collections and smart playlists. Its
  // routes put Playlists and Favourites in the sidebar; the playlist detail
  // screen is reached from the list, so it has no placement (docs/08 §3).
  '@BBeBee/plugin-library': {},
  '@BBeBee/plugin-library-ui-desktop': {},
  '@BBeBee/plugin-player': {
    config: {
      bufferMaxBytes: 500 * 1024 * 1024,
    },
  },
  // The "what is playing" surfaces and the up-next list, extracted from
  // `plugin-player`: the full-screen player, the bar that opens it, and the
  // queue screen. `plugin-player` itself is headless now — commands only.
  '@BBeBee/plugin-now-playing': {},
  '@BBeBee/plugin-now-playing-ui-desktop': {},
  '@BBeBee/plugin-lyric-sources': {},
  '@BBeBee/plugin-lyrics': {},
  '@BBeBee/plugin-lyrics-ui-desktop': {},
  '@BBeBee/plugin-desktop-lyrics': {},
  '@BBeBee/plugin-desktop-lyrics-ui-desktop': {},
  '@BBeBee/plugin-mini-player': {},
  '@BBeBee/plugin-mini-player-ui-desktop': {},
  '@BBeBee/plugin-queue': {},
  '@BBeBee/plugin-queue-ui-desktop': {},
  '@BBeBee/plugin-history': {},
  '@BBeBee/plugin-history-ui-desktop': {},
  '@BBeBee/plugin-settings': {},
  '@BBeBee/plugin-settings-ui-desktop': {},
  '@BBeBee/plugin-sleep-timer': {},
  '@BBeBee/plugin-desktop-taskbar': {},
  '@BBeBee/plugin-dsp': {},
  '@BBeBee/plugin-dsp-ui-desktop': {},
  '@BBeBee/plugin-visualizer': {},
  '@BBeBee/plugin-visualizer-ui-desktop': {},
  '@BBeBee/plugin-share': {},
  '@BBeBee/plugin-share-ui-desktop': {},
  // The community content index — update checks and installs for sources,
  // lyric sources, themes and desktop plugins. Headless service; installs of
  // the plugin kind reach the dynamic host through the bridge wired in
  // boot.ts.
  '@BBeBee/plugin-registry': {},
  // Lazy GitHub star/contributor counts for registry entries — fetched only
  // when the 发现 page's sort controls ask, cached for 24h, degraded on
  // failure. Headless; both shells run it (the kernel's shells.test.ts pins
  // feature parity, and nothing reads the service unless that UI asks).
  '@BBeBee/plugin-registry-metadata': {},
  // Its desktop views: the 发现 (registry) screen and the sources-section
  // settings card. Deferred together with the service — neither is needed
  // for first paint, and the route lands in the sidebar when the pair loads.
  '@BBeBee/plugin-registry-ui-desktop': {},
}

/**
 * Plugins deferred until after the first frame has rendered.
 * These are not needed for initial screen rendering and loading them
 * during idle reduces initial startup time without changing the feature set.
 */
export const DEFERRED_PLUGIN_IDS = [
  '@BBeBee/plugin-local-scanner',
  '@BBeBee/plugin-local-scanner-ui-desktop',
  '@BBeBee/plugin-download',
  '@BBeBee/plugin-download-ui-desktop',
  '@BBeBee/plugin-share',
  '@BBeBee/plugin-share-ui-desktop',
  '@BBeBee/plugin-visualizer',
  '@BBeBee/plugin-visualizer-ui-desktop',
  '@BBeBee/plugin-sleep-timer',
  '@BBeBee/plugin-history',
  '@BBeBee/plugin-history-ui-desktop',
  // A network-touching service nothing on the first screen reads — its
  // auto-check runs on its own timer, so it belongs with the other
  // post-first-frame plugins.
  '@BBeBee/plugin-registry',
  // Repo stats are read only from the 发现 screen's sort controls — never on
  // the first screen — so it defers with the rest of the registry trio.
  '@BBeBee/plugin-registry-metadata',
  // The registry's desktop views ride along with the service: the route
  // contribution only exists once the service loads anyway, so deferring the
  // pair together changes nothing about when the sidebar entry appears.
  '@BBeBee/plugin-registry-ui-desktop',
] as const

export const INITIAL_ENABLED: NonNullable<AppConfig['plugins']> = Object.fromEntries(
  Object.entries(ENABLED).filter(
    ([id]) => !DEFERRED_PLUGIN_IDS.includes(id as (typeof DEFERRED_PLUGIN_IDS)[number]),
  ),
)

