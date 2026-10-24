/**
 * What the mobile shell runs — as data, importing nothing.
 *
 * Separate from `boot.ts` because `boot.ts` reaches for `react-native` and
 * every Expo module, and this has to be readable by a test that does neither.
 * The registry is generated from the manifests; *this* is the allowlist, and
 * configuration is the allowlist: a package being bundled is not on its own
 * enough to run it (docs/03 §6.4).
 *
 * The list below is deliberately the same as the desktop shell's, minus the
 * per-target view packages. If the two ever diverge in *features* rather than
 * in views, that is ADR-2's split UI having become a split product — the last
 * entry in docs/10's "what would make this design wrong".
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
  'secrets',
  'device',
  'background',
  'mediaSession',
  // Same position as the desktop shell's list: the realms the source runtime
  // (and, later, the extension host) evaluate in. Bootstrap-wired because a
  // required `js` reachable through the config allowlist could be switched
  // off from the wrong end, like `http` and `audio` below.
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
  '@bbebee/plugin-theme': {},
  '@bbebee/plugin-ui': {},
  /*
   * No `plugin-log-*` here, deliberately. The logs layer loads from the
   * `bootstrap:` array in `boot.ts`, which is what puts it between the core
   * services and the feature plugins — a transport in this list would start
   * alongside the features it is meant to be recording (docs/09 §1).
   */
  '@bbebee/plugin-inspector': {},
  '@bbebee/plugin-manager': { config: { platform: 'mobile' } },

  // ctx.i18n — interface language from settings.language + ctx.device.locale
  // (see docs/services/i18n.md). Same allowlist position as desktop.
  '@bbebee/plugin-i18n': {},

  // M1's feature set, identical to desktop's. Load order is derived from
  // `inject`, never declared here (docs/02 §3).
  '@bbebee/plugin-sources': {},
  '@bbebee/plugin-sources-ui-mobile': {},
  // The album page, extracted from `plugin-sources`: route and view only, with
  // the reads still on `ctx.sources` (MD-3).
  '@bbebee/plugin-album': {},
  '@bbebee/plugin-album-ui-mobile': {},
  '@bbebee/plugin-local-scanner': {},
  '@bbebee/plugin-local-scanner-ui-mobile': {},
  '@bbebee/plugin-source-local': {},
  '@bbebee/plugin-source-runtime': {},
  // The M5 extension host: third-party extensions in a ctx.js realm, gated at
  // the ext bridge. Same allowlist position as desktop — the feature-parity
  // gate counts headless features on both shells.
  '@bbebee/plugin-extension-host': {},
  // Covers and remote streams are served from disk, fetched only on a miss.
  // The budgets are the mobile half of docs/07 §4.11's defaults: a phone
  // should hold 128 MB of artwork and 256 MB of streams, not a desktop's.
  '@bbebee/plugin-cache': {
    config: {
      maxArtworkBytes: 128 * 1024 * 1024,
      maxStreamBytes: 256 * 1024 * 1024,
    },
  },
  // Hooks `player/before-resolve`: a file the user downloads is kept under
  // `ctx.paths.downloads`, and every later play opens it. Disabling it leaves
  // playback streaming, with no branch in the player either way.
  '@bbebee/plugin-download': {},
  '@bbebee/plugin-download-ui-mobile': {},
  // Curation: playlists, favorites, collections and smart playlists. Mobile
  // shows Playlists as a tab; Favorites is reached from that screen, because
  // the tab bar is full and a fourth tab is a product decision, not a wiring
  // one (docs/08 §7).
  '@bbebee/plugin-library': {},
  '@bbebee/plugin-library-ui-mobile': {},
  '@bbebee/plugin-player': {},
  // The "what is playing" surfaces and the up-next list, extracted from
  // `plugin-player`: the full-screen player, the mini-player that opens it,
  // and the queue screen. `plugin-player` itself is headless now.
  '@bbebee/plugin-now-playing': {},
  '@bbebee/plugin-now-playing-ui-mobile': {},
  '@bbebee/plugin-lyric-sources': {},
  '@bbebee/plugin-lyrics': {},
  '@bbebee/plugin-desktop-lyrics': {},
  '@bbebee/plugin-mini-player': {},
  '@bbebee/plugin-queue': {},
  '@bbebee/plugin-queue-ui-mobile': {},
  '@bbebee/plugin-history': {},
  '@bbebee/plugin-history-ui-mobile': {},
  '@bbebee/plugin-settings': {},
  '@bbebee/plugin-settings-ui-mobile': {},
  // Share runs on both shells — the feature-parity gate (shells.test.ts)
  // treats a one-sided feature as a split product. The service is headless;
  // the mobile views are share codes, the desktop's are image cards.
  '@bbebee/plugin-share': {},
  '@bbebee/plugin-share-ui-mobile': {},
  '@bbebee/plugin-sleep-timer': {},
  '@bbebee/plugin-desktop-taskbar': {},
  '@bbebee/plugin-dsp': {},
  '@bbebee/plugin-dsp-ui-mobile': {},
  '@bbebee/plugin-visualizer': {},
  // The community content index — update checks and installs for sources,
  // lyric sources and themes. Headless on mobile: no plugin installer is
  // set, so plugin-kind installs refuse with a clear error.
  '@bbebee/plugin-registry': {},
  // Lazy GitHub star/contributor counts for registry entries. Headless and
  // inert on mobile — nothing reads it here — but the feature-parity gate
  // (shells.test.ts) counts headless features, so both shells run it.
  '@bbebee/plugin-registry-metadata': {},
  // Headless audio format converter & compressor
  '@bbebee/plugin-audio-converter': {},
}
