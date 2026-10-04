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
  '@BBeBee/plugin-ui': {},
  /*
   * No `plugin-log-*` here, deliberately. The logs layer loads from the
   * `bootstrap:` array in `boot.ts`, which is what puts it between the core
   * services and the feature plugins — a transport in this list would start
   * alongside the features it is meant to be recording (docs/09 §1).
   */
  '@BBeBee/plugin-inspector': {},
  '@BBeBee/plugin-manager': {},

  // M1's feature set, identical to desktop's. Load order is derived from
  // `inject`, never declared here (docs/02 §3).
  '@BBeBee/plugin-sources': {},
  '@BBeBee/plugin-sources-ui-mobile': {},
  // The album page, extracted from `plugin-sources`: route and view only, with
  // the reads still on `ctx.sources` (MD-3).
  '@BBeBee/plugin-album': {},
  '@BBeBee/plugin-album-ui-mobile': {},
  '@BBeBee/plugin-local-scanner': {},
  '@BBeBee/plugin-local-scanner-ui-mobile': {},
  '@BBeBee/plugin-source-local': {},
  '@BBeBee/plugin-source-runtime': {},
  // Covers and remote streams are served from disk, fetched only on a miss.
  // The budgets are the mobile half of docs/07 §4.11's defaults: a phone
  // should hold 128 MB of artwork and 256 MB of streams, not a desktop's.
  '@BBeBee/plugin-cache': {
    config: {
      maxArtworkBytes: 128 * 1024 * 1024,
      maxStreamBytes: 256 * 1024 * 1024,
    },
  },
  // Hooks `player/before-resolve`: a file the user downloads is kept under
  // `ctx.paths.downloads`, and every later play opens it. Disabling it leaves
  // playback streaming, with no branch in the player either way.
  '@BBeBee/plugin-download': {},
  '@BBeBee/plugin-download-ui-mobile': {},
  // Curation: playlists, favourites, collections and smart playlists. Mobile
  // shows Playlists as a tab; Favourites is reached from that screen, because
  // the tab bar is full and a fourth tab is a product decision, not a wiring
  // one (docs/08 §7).
  '@BBeBee/plugin-library': {},
  '@BBeBee/plugin-library-ui-mobile': {},
  '@BBeBee/plugin-player': {},
  // The "what is playing" surfaces and the up-next list, extracted from
  // `plugin-player`: the full-screen player, the mini-player that opens it,
  // and the queue screen. `plugin-player` itself is headless now.
  '@BBeBee/plugin-now-playing': {},
  '@BBeBee/plugin-now-playing-ui-mobile': {},
  '@BBeBee/plugin-lyric-sources': {},
  '@BBeBee/plugin-lyrics': {},
  '@BBeBee/plugin-desktop-lyrics': {},
  '@BBeBee/plugin-mini-player': {},
  '@BBeBee/plugin-queue': {},
  '@BBeBee/plugin-queue-ui-mobile': {},
  '@BBeBee/plugin-history': {},
  '@BBeBee/plugin-history-ui-mobile': {},
  '@BBeBee/plugin-settings': {},
  '@BBeBee/plugin-settings-ui-mobile': {},
  // Share runs on both shells — the feature-parity gate (shells.test.ts)
  // treats a one-sided feature as a split product. The service is headless;
  // the mobile views are share codes, the desktop's are image cards.
  '@BBeBee/plugin-share': {},
  '@BBeBee/plugin-share-ui-mobile': {},
  '@BBeBee/plugin-sleep-timer': {},
  '@BBeBee/plugin-desktop-taskbar': {},
  '@BBeBee/plugin-dsp': {},
  '@BBeBee/plugin-dsp-ui-mobile': {},
  '@BBeBee/plugin-visualizer': {},
}
