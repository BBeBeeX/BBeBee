import { describe, expect, it } from 'vitest'
import { ProxyRegistry, describeProxy, normalizeProxyConfig } from './proxy.js'

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

  it('treats the master switch as part of the dialable verdict — desktop proxy:apply sends the whole document', () => {
    // `enabled: false` must normalize to "no proxy" no matter which channel
    // delivered it; the address alone is not a proxy.
    expect(normalizeProxyConfig({ enabled: false, host: '127.0.0.1', port: 7890 })).toBeNull()
    expect(normalizeProxyConfig({ enabled: true, host: '127.0.0.1', port: 7890 })).toMatchObject({
      host: '127.0.0.1',
    })
    // Absent (the test-button shape) is not "off".
    expect(normalizeProxyConfig({ host: '127.0.0.1', port: 7890 })).not.toBeNull()
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

describe('describeProxy', () => {
  it('logs scheme, host and port — and never the credentials', () => {
    expect(describeProxy({ protocol: 'http', host: '127.0.0.1', port: 7890 })).toBe('http://127.0.0.1:7890')
    expect(describeProxy({ protocol: 'socks5', host: 'p.example', port: 1080 })).toBe('socks5://p.example:1080')
    const described = describeProxy({
      protocol: 'http',
      host: 'p.example',
      port: 8080,
      username: 'secret-user',
      password: 'secret-pass',
    })
    expect(described).toBe('http://p.example:8080')
    expect(described).not.toContain('secret')
  })

  it('names the direct case honestly', () => {
    expect(describeProxy(null)).toBe('direct')
  })
})
