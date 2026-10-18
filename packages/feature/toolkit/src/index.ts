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
export { formatDuration, formatTotalDuration, formatAddedDate, formatPlayedDate } from './time.js'
export { formatBytes } from './bytes.js'
export { toServableFileUrl } from './file-url.js'
export { compareVersions, normalizeVersion } from './semver.js'
export { getPath, setPath } from './record-path.js'
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
export { scanCode } from './security.js'
export {
  sanitizeFileName,
  embedAudioTags,
  embedMp3Tags,
  embedFlacTags,
  embedMp4Tags,
  buildId3v2Tag,
  detectAudioFormat,
  detectImageDimensions,
  detectImageMime,
  type AudioTagMetadata,
  type ImageDimensions,
} from './audio-tags.js'
