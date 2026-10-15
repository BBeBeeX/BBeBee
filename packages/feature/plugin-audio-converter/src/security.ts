/**
 * Security, path validation, and temporary file management for audio conversion.
 */

import { sanitizeFileName } from '@BBeBee/toolkit'
import type { AudioFormat } from '@BBeBee/protocol'

const SUPPORTED_FORMATS: ReadonlySet<string> = new Set([
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

/**
 * Normalizes and validates a file URI or native path.
 * Rejects path traversal attempts (`..`, null bytes).
 */
export function validateAndNormalizePath(uriOrPath: string): string {
  if (!uriOrPath || typeof uriOrPath !== 'string') {
    throw new Error('Invalid path: path cannot be empty')
  }

  // Reject null bytes and control characters
  for (let i = 0; i < uriOrPath.length; i++) {
    if (uriOrPath.charCodeAt(i) <= 31) {
      throw new Error('Security violation: path contains forbidden control characters or null bytes')
    }
  }

  // Normalize slashes
  const normalized = uriOrPath.replace(/\\/g, '/')

  // Reject directory traversal segments
  const segments = normalized.split('/')
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error('Security violation: path traversal (..) is not permitted')
    }
  }

  return uriOrPath
}

/**
 * Extract audio format extension from file path.
 */
export function extractExtension(pathOrUri: string): string {
  const clean = pathOrUri.split('?')[0]!.split('#')[0]!
  const lastDot = clean.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return clean.slice(lastDot + 1).toLowerCase()
}

/**
 * Validates target format against allowed set.
 */
export function validateFormat(fmt: string): AudioFormat {
  const lower = fmt.toLowerCase()
  if (!SUPPORTED_FORMATS.has(lower)) {
    throw new Error(`Unsupported audio format: "${fmt}". Supported formats: ${Array.from(SUPPORTED_FORMATS).join(', ')}`)
  }
  return lower as AudioFormat
}

/**
 * Ensures output path does not collide with source path unless overwrite is explicitly true.
 */
export function ensureSafeTarget(sourceUri: string, targetUri: string, allowOverwrite = false): void {
  const normSource = validateAndNormalizePath(sourceUri)
  const normTarget = validateAndNormalizePath(targetUri)

  if (normSource === normTarget && !allowOverwrite) {
    throw new Error('Overwriting the source file is forbidden. Please specify a different output path or file name.')
  }
}

/**
 * Computes a secure temporary output path in an application directory or target parent directory.
 */
export function computeTempPath(targetUri: string, tempBaseDir?: string): string {
  const clean = validateAndNormalizePath(targetUri)
  const lastSlash = clean.lastIndexOf('/')
  const targetParent = lastSlash >= 0 ? clean.slice(0, lastSlash) : ''
  const dir = (targetParent && targetParent !== '.')
    ? targetParent
    : (tempBaseDir ? validateAndNormalizePath(tempBaseDir) : '/tmp')
  const baseName = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean
  const lastDot = baseName.lastIndexOf('.')
  const stem = lastDot > 0 ? baseName.slice(0, lastDot) : baseName
  const ext = lastDot > 0 ? baseName.slice(lastDot) : ''
  const rand = Math.random().toString(36).slice(2, 10)
  return `${dir}/.${sanitizeFileName(stem)}.tmp_${rand}${ext}`
}
