/**
 * File picking for the mobile converter workbench.
 *
 * The protocol `fs` contract is gaining an optional `pickFiles` method
 * (`pickFiles(opts?: { multiple?: boolean }): Promise<Array<{ uri: string;
 * name?: string; size?: number }>>`, resolving `[]` on cancel). The mobile fs
 * implementation may or may not ship it yet, so every access goes through a
 * capability check and the screen renders an explicit "cannot pick files"
 * state when the build lacks it — never a thrown error from a missing method.
 *
 * Pure helpers only: no React, no native primitives.
 */

import { extractExtension } from '@bbebee/plugin-audio-converter'

/** The exact signature the protocol contract is gaining. */
export type PickedFile = { uri: string; name?: string; size?: number }
export type PickFilesFn = (opts?: { multiple?: boolean }) => Promise<PickedFile[]>

/**
 * Resolve the optional `pickFiles` capability off an fs service, or `undefined`
 * when this build cannot pick files.
 */
export function pickFilesCapability(fs: unknown): PickFilesFn | undefined {
  if (fs === null || typeof fs !== 'object') return undefined
  const candidate = (fs as { pickFiles?: unknown }).pickFiles
  return typeof candidate === 'function' ? (candidate as PickFilesFn) : undefined
}

/** A staged input file in the workbench — same shape as the desktop list. */
export interface StagedFile {
  id: string
  uri: string
  name: string
  format: string
  size: number
  durationMs?: number
}

const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3',
  'wav',
  'flac',
  'aac',
  'm4a',
  'ogg',
  'opus',
  'wma',
  'aiff',
  'alac',
  'webm',
  'pcm',
])

/** Keep the picker's filter honest and let the staging layer double-check. */
export function isAudioExtension(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase())
}

/**
 * Map picked files onto staged rows. Unpickable extensions are dropped rather
 * than enqueued — the codec would reject them later with a worse message.
 */
export function toStagedFiles(picked: readonly PickedFile[], startIndex = 0): StagedFile[] {
  const staged: StagedFile[] = []
  let index = startIndex
  for (const file of picked) {
    const uri = file.uri
    if (!uri) continue
    const ext = extractExtension(uri)
    if (!isAudioExtension(ext)) continue
    const lastSlash = uri.lastIndexOf('/')
    const name = file.name ?? (lastSlash >= 0 ? uri.slice(lastSlash + 1) : uri)
    staged.push({
      id: `file_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      uri,
      name,
      format: (ext || 'unknown').toUpperCase(),
      size: file.size ?? 0,
    })
    index++
  }
  return staged
}
