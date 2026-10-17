import { existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))

export function findFfmpegPath(): string {
  if (process.env['FFMPEG_PATH'] && existsSync(process.env['FFMPEG_PATH'])) {
    return process.env['FFMPEG_PATH']
  }
  const isWin = process.platform === 'win32'
  const binaryName = isWin ? 'ffmpeg.exe' : 'ffmpeg'
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
  const candidates = [
    resourcesPath ? join(resourcesPath, 'bin', binaryName) : '',
    resourcesPath ? join(resourcesPath, binaryName) : '',
    join(here, '..', 'bin', binaryName),
    join(process.cwd(), 'apps', 'desktop', 'bin', binaryName),
    join(process.cwd(), 'bin', binaryName),
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return binaryName
}

export function buildProxyRules(config: { protocol?: string; host?: string; port?: number }): string {
  if (!config?.host || !config?.port) return ''
  const proto = (config.protocol || 'http').toLowerCase()
  const host = config.host.trim()
  const port = config.port
  if (proto === 'socks5' || proto === 'socks') {
    return `socks5://${host}:${port}`
  }
  if (proto === 'socks4') {
    return `socks4://${host}:${port}`
  }
  // For HTTP/HTTPS, explicitly forward both http and https via the proxy
  return `http=${host}:${port};https=${host}:${port}`
}

export function getFileMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.mp3': return 'audio/mpeg'
    case '.flac': return 'audio/flac'
    case '.wav': return 'audio/wav'
    case '.m4a': return 'audio/mp4'
    case '.aac': return 'audio/aac'
    case '.ogg': case '.oga': return 'audio/ogg'
    case '.opus': return 'audio/opus'
    case '.weba': return 'audio/webm'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

export function parseByteRange(rangeHeader: string, totalSize: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return undefined
  const [, startStr, endStr] = match
  if (!startStr && !endStr) return undefined
  if (!startStr) {
    const suffix = parseInt(endStr ?? '', 10)
    if (isNaN(suffix) || suffix <= 0) return undefined
    const start = Math.max(0, totalSize - suffix)
    return { start, end: totalSize - 1 }
  }
  const start = parseInt(startStr, 10)
  if (isNaN(start) || start >= totalSize) return undefined
  let end = endStr ? parseInt(endStr, 10) : totalSize - 1
  if (isNaN(end) || end >= totalSize) end = totalSize - 1
  if (start > end) return undefined
  return { start, end }
}
