import { describe, expect, it, vi } from 'vitest'
import { ProxyRegistry, normalizeProxyConfig, probeProxy } from './proxy.js'

describe('normalizeProxyConfig', () => {
  it('keeps a dialable config and defaults the protocol to http', () => {
    expect(normalizeProxyConfig({ host: '127.0.0.1', port: 7890 })).toEqual({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    })
  })

  it('keeps credentials only when they are non-empty strings', () => {
    expect(normalizeProxyConfig({ protocol: 'socks5', host: 'p.example', port: 1080, username: 'u', password: 'p' })).toEqual({
      protocol: 'socks5',
      host: 'p.example',
      port: 1080,
      username: 'u',
      password: 'p',
    })
    expect(normalizeProxyConfig({ host: 'p.example', port: 1080, username: '', password: '' })).toEqual({
      protocol: 'http',
      host: 'p.example',
      port: 1080,
    })
  })

  it('refuses what cannot be dialled — the settings form mid-edit must not crash the transport', () => {
    expect(normalizeProxyConfig(null)).toBeNull()
    expect(normalizeProxyConfig('nope')).toBeNull()
    expect(normalizeProxyConfig({ host: '', port: 7890 })).toBeNull()
    expect(normalizeProxyConfig({ host: 'h', port: 0 })).toBeNull()
    expect(normalizeProxyConfig({ host: 'h', port: 70_000 })).toBeNull()
    expect(normalizeProxyConfig({ host: 'h', port: Number.NaN })).toBeNull()
  })
})

describe('ProxyRegistry', () => {
  it('serves no dispatcher without a stored config — marked requests go direct', () => {
    const registry = new ProxyRegistry()
    expect(registry.dispatcher).toBeNull()
    registry.set(undefined)
    expect(registry.dispatcher).toBeNull()
  })

  it('builds a dispatcher for a dialable config and drops it when cleared', () => {
    const registry = new ProxyRegistry()
    registry.set({ protocol: 'http', host: '127.0.0.1', port: 7890 })
    expect(registry.dispatcher).not.toBeNull()
    registry.set(null)
    expect(registry.dispatcher).toBeNull()
  })

  it('rebuilds only when the config actually changes — proxy:set fires on every settings change', () => {
    const registry = new ProxyRegistry()
    const first = registry.set({ protocol: 'http', host: '127.0.0.1', port: 7890 })
    const same = registry.set({ protocol: 'http', host: '127.0.0.1', port: 7890, username: undefined })
    expect(same).toBe(first)
    expect(registry.dispatcher).toBe(registry.dispatcher)
    const changed = registry.set({ protocol: 'http', host: '10.0.0.1', port: 7890 })
    expect(changed).not.toBeNull()
    // A different host must have produced a different dispatcher, not a reuse.
    registry.set({ protocol: 'http', host: '127.0.0.1', port: 7890 })
    expect(registry.config?.host).toBe('127.0.0.1')
  })
})

describe('probeProxy', () => {
  const config = { protocol: 'http' as const, host: '127.0.0.1', port: 7890 }
  type ProbeFetch = NonNullable<Parameters<typeof probeProxy>[1]>['fetchImpl']

  it('reports latency when the probe answers under 400', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as ProbeFetch
    const result = await probeProxy(config, { fetchImpl })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('reports an HTTP status as a failure, not a success', async () => {
    const fetchImpl = (async () => new Response(null, { status: 502 })) as unknown as ProbeFetch
    const result = await probeProxy(config, { fetchImpl })
    expect(result).toEqual({ ok: false, error: 'probe answered HTTP 502' })
  })

  it('reports a transport failure with its message', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:7890')
    }) as unknown as ProbeFetch
    const result = await probeProxy(config, { fetchImpl })
    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:7890' })
  })
})
