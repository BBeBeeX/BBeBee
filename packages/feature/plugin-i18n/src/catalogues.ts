/**
 * Built-in catalogues as data, for renderers that cannot reach `ctx.i18n`.
 *
 * The desktop-lyrics and mini-player windows never boot the Cordis app, so
 * they have no `ctx` and no i18n service. They still need translated UI: the
 * preload `locale` bridge tells them *which* locale is active, and this
 * module gives them *what* to render for it. Same JSON the service
 * registers, flattened to the same dotted keys — one source of truth,
 * two ways to read it.
 *
 * This is intentionally data-only (no `Service`, no cordis): a ctx-less
 * renderer must not pull the DI graph in through a catalogue import.
 *
 * Third-party `register()` contributions are NOT included here — only what
 * plugin-i18n ships. The ctx-less windows only ever read built-in keys
 * (`app:*`, `miniPlayer:*`), so nothing is lost; document it if that
 * changes.
 */

import enApp from './locales/en.json'
import zhApp from './locales/zh.json'
import albumLocales from './locales/album.json'
import downloadLocales from './locales/download.json'
import dspLocales from './locales/dsp.json'
import historyLocales from './locales/history.json'
import inspectorLocales from './locales/inspector.json'
import libraryLocales from './locales/library.json'
import localScannerLocales from './locales/localScanner.json'
import lyricsLocales from './locales/lyrics.json'
import miniPlayerLocales from './locales/miniPlayer.json'
import nowPlayingLocales from './locales/nowPlaying.json'
import queueLocales from './locales/queue.json'
import registryLocales from './locales/registry.json'
import settingsLocales from './locales/settings.json'
import shareLocales from './locales/share.json'
import sourcesLocales from './locales/sources.json'
import themeLocales from './locales/theme.json'
import visualizerLocales from './locales/visualizer.json'

/** Namespace → locale tag → dotted-key → translated string. */
export type BuiltInCatalogues = Record<string, Record<string, Record<string, string>>>

function flatten(nested: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof nested !== 'object' || nested === null) return out
  for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else flatten(value, path, out)
  }
  return out
}

/** `{ en: nested, zh: nested }` → `{ en: dotted, zh: dotted }`. */
function perLocale(catalogues: Record<string, unknown>): Record<string, Record<string, string>> {
  const flat: Record<string, Record<string, string>> = {}
  for (const [locale, nested] of Object.entries(catalogues)) {
    flat[locale] = flatten(nested)
  }
  return flat
}

/**
 * Every catalogue plugin-i18n ships, keyed exactly as the service registers
 * them (`I18nPlugin[Service.init]`). Keep this list in sync with the
 * `register()` calls there — `check-locales.mjs` guards the JSON, nothing
 * guards this list, so review it when a namespace is added.
 */
export const BUILT_IN_CATALOGUES: BuiltInCatalogues = {
  app: { en: flatten(enApp), zh: flatten(zhApp) },
  album: perLocale(albumLocales),
  download: perLocale(downloadLocales),
  dsp: perLocale(dspLocales),
  history: perLocale(historyLocales),
  inspector: perLocale(inspectorLocales),
  library: perLocale(libraryLocales),
  localScanner: perLocale(localScannerLocales),
  lyrics: perLocale(lyricsLocales),
  miniPlayer: perLocale(miniPlayerLocales),
  nowPlaying: perLocale(nowPlayingLocales),
  queue: perLocale(queueLocales),
  registry: perLocale(registryLocales),
  settings: perLocale(settingsLocales),
  share: perLocale(shareLocales),
  sources: perLocale(sourcesLocales),
  theme: perLocale(themeLocales),
  visualizer: perLocale(visualizerLocales),
}
