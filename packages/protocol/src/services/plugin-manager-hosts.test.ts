import { describe, expect, it } from 'vitest'
import {
  derivePluginManagerDownloadHosts,
  effectiveNpmRegistryBase,
  effectiveRegistryRawBase,
  KNOWN_HOST_COMPANIONS,
} from './plugin-manager-hosts.js'

/** The built-in set: both regions' endpoints + the hardcoded companions. */
const BUILT_IN_HOSTS = [
  'cdn.jsdelivr.net',
  'cdn.npmmirror.com',
  'fastly.jsdelivr.net',
  'raw.githubusercontent.com',
  'registry.npmjs.org',
  'registry.npmmirror.com',
]

describe('effective endpoint selection (mirrors the npm client)', () => {
  it('manual overrides always win over the region default', () => {
    expect(effectiveNpmRegistryBase({ npmRegistryUrl: 'https://npm.example.corp/' })).toBe(
      'https://npm.example.corp',
    )
    expect(
      effectiveNpmRegistryBase({ downloadRegion: 'mainland-china', npmRegistryUrl: 'https://npm.example.corp' }),
    ).toBe('https://npm.example.corp')
    expect(effectiveRegistryRawBase({ githubRawBaseUrl: 'https://raw.example.corp/base/' })).toBe(
      'https://raw.example.corp/base',
    )
  })

  it('region selects the built-in defaults when no override is set', () => {
    expect(effectiveNpmRegistryBase({ downloadRegion: 'mainland-china' })).toBe('https://registry.npmmirror.com')
    expect(effectiveNpmRegistryBase({ downloadRegion: 'global' })).toBe('https://registry.npmjs.org')
    expect(effectiveNpmRegistryBase()).toBe('https://registry.npmjs.org')
    expect(effectiveRegistryRawBase({ downloadRegion: 'mainland-china' })).toBe(
      'https://cdn.jsdelivr.net/gh/BBeBeeX/B_Be_Bee-registry@main',
    )
    expect(effectiveRegistryRawBase({})).toBe('https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main')
  })
})

describe('derivePluginManagerDownloadHosts', () => {
  it('absent settings derive exactly the built-in set (the manifest static fallback set)', () => {
    expect(derivePluginManagerDownloadHosts()).toEqual(BUILT_IN_HOSTS)
    expect(derivePluginManagerDownloadHosts({})).toEqual(BUILT_IN_HOSTS)
  })

  it('the built-in set is region-independent: region routes among built-ins, it does not untrust them', () => {
    expect(derivePluginManagerDownloadHosts({ downloadRegion: 'global' })).toEqual(BUILT_IN_HOSTS)
    expect(derivePluginManagerDownloadHosts({ downloadRegion: 'mainland-china' })).toEqual(BUILT_IN_HOSTS)
  })

  it('includes the npmmirror CDN redirect companion (the field failure)', () => {
    // registry.npmmirror.com 302-redirects tarball GETs here; the set
    // is incomplete without it under mainland defaults.
    expect(KNOWN_HOST_COMPANIONS['registry.npmmirror.com']).toContain('cdn.npmmirror.com')
    expect(derivePluginManagerDownloadHosts({ downloadRegion: 'mainland-china' })).toContain('cdn.npmmirror.com')
  })

  it('a custom npm registry contributes exactly its own host', () => {
    const hosts = derivePluginManagerDownloadHosts({ npmRegistryUrl: 'https://npm.example.corp' })
    expect(hosts).toEqual([...BUILT_IN_HOSTS, 'npm.example.corp'].sort())
  })

  it('a custom registry on a non-default port contributes the bare hostname (the gate matches hostnames)', () => {
    const hosts = derivePluginManagerDownloadHosts({ npmRegistryUrl: 'https://npm.example.corp:8443/verdaccio' })
    expect(hosts).toContain('npm.example.corp')
    expect(hosts.some((h) => h.includes(':'))).toBe(false)
  })

  it('a custom raw base contributes its host, including the gh-proxy embedded-URL form', () => {
    const proxied = derivePluginManagerDownloadHosts({
      githubRawBaseUrl: 'https://ghproxy.example.com/https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main',
    })
    expect(proxied).toContain('ghproxy.example.com')
    expect(proxied).toContain('raw.githubusercontent.com')
    const direct = derivePluginManagerDownloadHosts({ githubRawBaseUrl: 'https://raw.example.corp/base' })
    expect(direct).toContain('raw.example.corp')
  })

  it('a custom registry that IS a known mirror brings its companions along', () => {
    const hosts = derivePluginManagerDownloadHosts({ npmRegistryUrl: 'https://registry.npmmirror.com' })
    expect(hosts).toContain('cdn.npmmirror.com')
  })

  it('unparseable override URLs contribute nothing and never throw', () => {
    expect(
      derivePluginManagerDownloadHosts({ npmRegistryUrl: 'not a url', githubRawBaseUrl: '://junk' }),
    ).toEqual(BUILT_IN_HOSTS)
  })

  it('output is deduplicated and sorted', () => {
    const hosts = derivePluginManagerDownloadHosts({
      npmRegistryUrl: 'https://registry.npmjs.org',
      githubRawBaseUrl: 'https://raw.githubusercontent.com/x',
    })
    expect(hosts).toEqual([...new Set(hosts)].sort())
    expect(hosts).toEqual(BUILT_IN_HOSTS)
  })
})
