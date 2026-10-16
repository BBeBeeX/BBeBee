import { existsSync, statSync, readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { pluginDirName } from '@BBeBee/protocol'
import { toNativePath } from './fs-path.js'
import { getFileMimeType, parseByteRange } from './helpers.js'

export interface ProtocolResponse {
  status: number
  statusText?: string
  headers: Record<string, string>
  body?: Uint8Array | string | null
  filePath?: string
}

export function parsePluginRequestUrl(rawUrl: string): { pluginId: string; subPath: string } | undefined {
  try {
    const url = new URL(rawUrl)
    // Handle bbebee-plugin://app/<pluginId>/<subPath> or bbebee-plugin://plugin/<pluginId>/<subPath>
    if (url.host === 'app' || url.host === 'plugin') {
      const parts = url.pathname.replace(/^\/+/, '').split('/')
      const rawId = parts[0]
      if (!rawId) return undefined
      const pluginId = decodeURIComponent(rawId)
      const subPath = parts.slice(1).join('/') || 'index.js'
      return { pluginId, subPath }
    }
    // Handle bbebee-plugin://<pluginId>/<subPath>
    const pluginId = decodeURIComponent(url.host)
    const subPath = url.pathname.replace(/^\/+/, '') || 'index.js'
    return { pluginId, subPath }
  } catch {
    return undefined
  }
}

export function resolvePluginDir(pluginId: string, installedPluginsDir: string): string | undefined {
  if (!existsSync(installedPluginsDir)) {
    mkdirSync(installedPluginsDir, { recursive: true })
  }
  // 1. Check pluginDirName(pluginId)
  const hashedName = pluginDirName(pluginId)
  const hashedPath = join(installedPluginsDir, hashedName)
  if (existsSync(hashedPath)) return hashedPath

  // 2. Check exact sanitized name
  const sanitized = pluginId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const directPath = join(installedPluginsDir, sanitized)
  if (existsSync(directPath)) return directPath

  // 3. Check versioned matches (e.g. pluginId@version)
  try {
    const entries = readdirSync(installedPluginsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name === pluginId ||
          entry.name.startsWith(`${pluginId}@`) ||
          entry.name.startsWith(`${hashedName}@`))
      ) {
        return join(installedPluginsDir, entry.name)
      }
    }
  } catch {
    // ignore
  }

  return undefined
}

export class ProtocolManager {
  private sandboxHtmlMap = new Map<string, string>()

  constructor(private getInstalledPluginsDir: () => string) {}

  setSandboxHtml(id: string, html: string): boolean {
    if (id && typeof html === 'string') {
      this.sandboxHtmlMap.set(id, html)
      return true
    }
    return false
  }

  handleBbebeeSandbox(rawUrl: string): ProtocolResponse {
    try {
      const u = new URL(rawUrl)
      const id = decodeURIComponent(u.pathname.replace(/^\/+/, '')) || u.hostname
      const html = this.sandboxHtmlMap.get(id)
      if (html) {
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
          body: html,
        }
      }
    } catch {
      // ignore
    }

    return {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Sandbox Template Not Found',
    }
  }

  handleBbebeePlugin(rawUrl: string): ProtocolResponse {
    try {
      const parsed = parsePluginRequestUrl(rawUrl)
      if (!parsed) {
        return { status: 400, headers: {}, body: 'Invalid plugin URL' }
      }

      const pluginDir = resolvePluginDir(parsed.pluginId, this.getInstalledPluginsDir())
      if (!pluginDir) {
        return { status: 404, headers: {}, body: `Plugin not found: ${parsed.pluginId}` }
      }

      const safePath = resolve(pluginDir, parsed.subPath)
      if (!safePath.startsWith(resolve(pluginDir))) {
        return { status: 403, headers: {}, body: 'Forbidden' }
      }

      if (existsSync(safePath) && statSync(safePath).isFile()) {
        const stats = statSync(safePath)
        const ext = extname(safePath).toLowerCase()
        let contentType = 'application/octet-stream'
        if (ext === '.js' || ext === '.mjs') contentType = 'text/javascript; charset=utf-8'
        else if (ext === '.json') contentType = 'application/json; charset=utf-8'
        else if (ext === '.css') contentType = 'text/css; charset=utf-8'
        else if (ext === '.wasm') contentType = 'application/wasm'
        else contentType = getFileMimeType(safePath)

        const content = readFileSync(safePath)
        return {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(stats.size),
            'Access-Control-Allow-Origin': '*',
          },
          body: content,
          filePath: safePath,
        }
      }
    } catch {
      // ignore
    }

    return {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Plugin File Not Found',
    }
  }

  handleBbebeeFile(rawUrl: string, rangeHeader?: string | null): ProtocolResponse {
    try {
      const filePath = toNativePath(rawUrl)
      if (existsSync(filePath)) {
        const stats = statSync(filePath)
        const contentType = getFileMimeType(filePath)
        const baseHeaders: Record<string, string> = {
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Content-Type': contentType,
        }

        if (rangeHeader) {
          const range = parseByteRange(rangeHeader, stats.size)
          if (!range) {
            return {
              status: 416,
              statusText: 'Range Not Satisfiable',
              headers: {
                ...baseHeaders,
                'Content-Range': `bytes */${stats.size}`,
              },
              body: null,
            }
          }

          const chunkSize = range.end - range.start + 1
          return {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              ...baseHeaders,
              'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
              'Content-Length': String(chunkSize),
            },
            filePath,
          }
        }

        return {
          status: 200,
          statusText: 'OK',
          headers: {
            ...baseHeaders,
            'Content-Length': String(stats.size),
          },
          filePath,
        }
      }
    } catch {
      // ignore
    }

    return {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'File Not Found',
    }
  }
}
