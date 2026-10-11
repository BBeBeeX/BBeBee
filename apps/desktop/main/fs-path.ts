/**
 * URI → on-disk path, the one decoder for local media locations.
 *
 * `bbebee-file://` is `file://` in disguise, and both schemes percent-encode
 * the on-disk name: a track ripped as `9. One Last Kiss - Édith Piaf.flac`
 * reaches the main process as `9.%20One%C2%A0Last%C2%A0Kiss%20-%C3%89dith…`.
 * Everything that opens the file — the protocol handler serving reads, and
 * ffmpeg spawned with a path argument — must decode it the same way, or the
 * two disagree about which file exists (ffmpeg answers "No such file or
 * directory" for a track the protocol handler plays fine).
 */

import { fileURLToPath } from 'node:url'

export function toNativePath(uriOrUrl: string): string {
  const fileUrl = uriOrUrl.replace(/^bbebee-file:\/*/, 'file:///')
  if (fileUrl.startsWith('file://')) {
    const p = fileURLToPath(fileUrl)
    if (/^\/[a-zA-Z]:[\\/]/.test(p)) {
      return decodeURIComponent(p.slice(1))
    }
    return p
  }
  return uriOrUrl
}
