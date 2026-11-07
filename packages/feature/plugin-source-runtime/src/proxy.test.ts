import { describe, expect, it, vi } from 'vitest'
import type { HttpRequest, HttpResponse, HttpService } from '@BBeBee/protocol'
import { proxyMarkedHttp } from './proxy.js'

function responseOf(): HttpResponse {
  return {
    status: 200,
    headers: {},
    url: 'https://example.org/',
    text: async () => '',
    json: <T = unknown>() => Promise.resolve({} as T),
    bytes: async () => new Uint8Array(),
    stream: () => new ReadableStream<Uint8Array>(),
  }
}

function recordingHttp(declare: Partial<HttpService> = {}): { http: HttpService; requests: HttpRequest[] } {
  const requests: HttpRequest[] = []
  const http = Object.assign(
    (req: HttpRequest) => {
      requests.push(req)
      return Promise.resolve(responseOf())
    },
    {
      cookies: {
        jar: vi.fn(),
        destroy: vi.fn(),
        list: vi.fn(async () => []),
      },
      get: async (url: string) => {
        await http({ url, method: 'GET' })
        return {}
      },
      post: async (url: string) => {
        await http({ url, method: 'POST' })
        return {}
      },
      download: vi.fn(),
      ...declare,
    },
  ) as unknown as HttpService
  return { http, requests }
}

describe('proxyMarkedHttp', () => {
  it('marks every request while the source is opted in', async () => {
    const { http, requests } = recordingHttp()
    const wrapped = proxyMarkedHttp(http, () => true)
    await wrapped({ url: 'https://example.org/a' })
    await wrapped({ url: 'https://example.org/b', method: 'POST' })
    expect(requests.map((r) => r.useProxy)).toEqual([true, true])
    expect(requests.map((r) => r.url)).toEqual(['https://example.org/a', 'https://example.org/b'])
  })

  it('marks nothing when the source is not opted in', async () => {
    const { http, requests } = recordingHttp()
    const wrapped = proxyMarkedHttp(http, () => false)
    await wrapped({ url: 'https://example.org/a' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.useProxy).toBeUndefined()
  })

  it('reads the decision live — a settings flip lands on the next request', async () => {
    const { http, requests } = recordingHttp()
    let enabled = false
    const wrapped = proxyMarkedHttp(http, () => enabled)
    await wrapped({ url: 'https://example.org/a' })
    enabled = true
    await wrapped({ url: 'https://example.org/b' })
    expect(requests[0]?.useProxy).toBeUndefined()
    expect(requests[1]?.useProxy).toBe(true)
  })

  it('respects a flag the caller already set instead of overwriting it', async () => {
    const { http, requests } = recordingHttp()
    const wrapped = proxyMarkedHttp(http, () => true)
    await wrapped({ url: 'https://example.org/a', useProxy: false })
    expect(requests[0]?.useProxy).toBe(false)
  })

  it('passes the rest of the service surface through — the jar is the inner scope jar', async () => {
    const { http } = recordingHttp()
    const wrapped = proxyMarkedHttp(http, () => false)
    expect(wrapped.cookies).toBe(http.cookies)
    await wrapped.get('https://example.org/x')
    await wrapped.post('https://example.org/x', { a: 1 })
  })
})
