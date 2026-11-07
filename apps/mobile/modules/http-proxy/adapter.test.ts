import { describe, expect, it, vi } from 'vitest'
import { buildProxyTransport, type NativeHttpProxy, type ProxyFetchRequest, type ProxyFetchResponse } from './adapter'

const PROXY = { protocol: 'http' as const, host: '127.0.0.1', port: 7890 }

function nativeAnswer(overrides: Partial<ProxyFetchResponse> = {}): ProxyFetchResponse {
  return {
    status: 200,
    statusText: 'OK',
    url: 'https://example.org/final',
    headers: [
      ['content-type', 'text/plain'],
      ['set-cookie', 'session=abc; Path=/'],
      ['set-cookie', 'csrf=tok; Path=/'],
    ],
    bodyBase64: btoa('proxied body'),
    ...overrides,
  }
}

function nativeSpy(answer: ProxyFetchResponse): { native: NativeHttpProxy; calls: ProxyFetchRequest[] } {
  const calls: ProxyFetchRequest[] = []
  const native = {
    proxyFetch: vi.fn(async (request: ProxyFetchRequest) => {
      calls.push(request)
      return answer
    }),
  }
  return { native, calls }
}

describe('buildProxyTransport', () => {
  it('maps a fetch call onto the stateless native request and back into a Response', async () => {
    const { native, calls } = nativeSpy(nativeAnswer())
    const transport = buildProxyTransport(native)

    const response = await transport('https://example.org/doc', {
      method: 'POST',
      headers: { 'x-echo': 'yes', 'Content-Type': 'application/json' },
      body: '{"a":1}',
      proxy: PROXY,
    } as RequestInit)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://example.org/doc',
      method: 'POST',
      headers: { 'x-echo': 'yes', 'content-type': 'application/json' },
      proxy: PROXY,
    })
    // The body crossed base64-encoded, like the desktop bridge's wire.
    expect(atob(calls[0]!.bodyBase64!)).toBe('{"a":1}')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('proxied body')
    // The native final URL shadows the constructed Response's empty one.
    expect(response.url).toBe('https://example.org/final')
  })

  it('keeps set-cookie entries separate through _rawHeaders, where listSetCookies reads them', async () => {
    const { native } = nativeSpy(nativeAnswer())
    const transport = buildProxyTransport(native)
    const response = await transport('https://example.org/doc', { proxy: PROXY } as RequestInit)
    const raw = (response as unknown as { _rawHeaders: [string, string][] })._rawHeaders
    expect(raw.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value)).toEqual([
      'session=abc; Path=/',
      'csrf=tok; Path=/',
    ])
  })

  it('refuses to run without a proxy config rather than dialling direct silently', async () => {
    const { native, calls } = nativeSpy(nativeAnswer())
    const transport = buildProxyTransport(native)
    await expect(transport('https://example.org/doc', {} as RequestInit)).rejects.toThrow(/proxy config/)
    expect(calls).toHaveLength(0)
  })

  it('honours an already-aborted signal instead of waiting on the native call', async () => {
    const { native } = nativeSpy(nativeAnswer())
    const transport = buildProxyTransport(native)
    const controller = new AbortController()
    controller.abort()
    await expect(
      transport('https://example.org/doc', { proxy: PROXY, signal: controller.signal } as RequestInit),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('encodes a FormData body through a Response, boundary content-type and all', async () => {
    const { native, calls } = nativeSpy(nativeAnswer())
    const transport = buildProxyTransport(native)
    const form = new FormData()
    form.append('q', 'hello')
    await transport('https://example.org/upload', { method: 'POST', body: form, proxy: PROXY } as RequestInit)
    expect(calls[0]?.headers['content-type']).toContain('multipart/form-data')
    expect(calls[0]?.bodyBase64).toBeTruthy()
  })

  it('sends no body for GET and HEAD even when the caller passed one', async () => {
    const { native, calls } = nativeSpy(nativeAnswer())
    const transport = buildProxyTransport(native)
    await transport('https://example.org/doc', { method: 'HEAD', body: 'ignored', proxy: PROXY } as RequestInit)
    expect(calls[0]?.bodyBase64).toBeUndefined()
  })
})
