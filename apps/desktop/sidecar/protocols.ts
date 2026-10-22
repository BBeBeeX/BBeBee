import { existsSync, statSync } from 'node:fs'

import { toNativePath } from './fs-path.js'
import { getFileMimeType, parseByteRange } from './helpers.js'

export interface ProtocolResponse {
  status: number
  statusText?: string
  headers: Record<string, string>
  body?: Uint8Array | string | null
  filePath?: string
}

export class ProtocolManager {
  private sandboxHtmlMap = new Map<string, string>()

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
