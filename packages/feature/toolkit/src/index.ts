/**
 * @BBeBee/toolkit — pure helpers over ids, text, time and collections.
 *
 * The charter (see README): pure logic, no Cordis, no platform, no I/O, no
 * dependencies — `source-rules`' contract, for the helpers that outgrew the
 * plugin they were first written in.
 */

export {
  albumId,
  artistId,
  artistKey,
  artworkId,
  normalise,
  stableId,
  trackId,
} from './id.js'
export { splitArtists } from './text.js'
export { formatDuration, formatTotalDuration } from './time.js'
export { formatBytes } from './bytes.js'
export { permute } from './shuffle.js'
export {
  parseLrc,
  findActiveLyricIndex,
  type LyricLine,
  type LyricWord,
  type ParsedLyrics,
} from './lyrics.js'
export {
  normalizePluginId,
  matchesPluginId,
  computeReverseDependents,
  flattenFiberNodes,
  filterPlugins,
  type PluginDependencyItem,
  type TreeFiberNode,
  type SearchablePlugin,
} from './plugins.js'
