import { describe, expect, it } from 'vitest'
import { ConfigError } from '@BBeBee/protocol'
import { isEnabled, resolveConfig } from './config.js'

describe('resolveConfig', () => {
  it('resolves a plugin to one activation keyed by its own id', () => {
    expect(
      resolveConfig({ plugins: { '@bbebee/plugin-player': { config: { crossfadeMs: 0 } } } }),
    ).toEqual([{ pluginId: '@bbebee/plugin-player', config: { crossfadeMs: 0 } }])
  })

  it('skips disabled plugins', () => {
    expect(resolveConfig({ plugins: { a: { enabled: false } } })).toEqual([])
  })

  it('defaults a plugin with no config to an empty one', () => {
    expect(resolveConfig({ plugins: { a: {} } })).toEqual([{ pluginId: 'a', config: {} }])
  })

  it('does not expand per-plugin instances', () => {
    // Multi-instance was only ever for music sources, and a source is now a
    // row in `sources`, imported in the app. An `instances` key left over in
    // an old config is inert extra data, not a second activation.
    const resolved = resolveConfig({
      plugins: {
        p: { config: { a: 1 }, instances: [{ id: 'one' }, { id: 'two' }] },
      } as never,
    })
    expect(resolved).toEqual([{ pluginId: 'p', config: { a: 1 } }])
  })

  it('rejects a null entry rather than skipping it', () => {
    // `plugins: { a: }` is valid YAML. Dropping it silently would be
    // indistinguishable from a plugin that failed to load.
    expect(() => resolveConfig({ plugins: { a: null } as never })).toThrow(ConfigError)
  })

  it('rejects a non-object config', () => {
    expect(() => resolveConfig({ plugins: { a: { config: 'nope' } } as never })).toThrow(
      ConfigError,
    )
  })

  it('handles an empty document', () => {
    expect(resolveConfig({})).toEqual([])
  })
})

describe('isEnabled', () => {
  it('is false for an unmentioned plugin', () => {
    // Configuration is the allowlist: presence in the registry is not enough.
    expect(isEnabled({ plugins: {} }, 'a')).toBe(false)
  })

  it('defaults to true when mentioned without an explicit flag', () => {
    expect(isEnabled({ plugins: { a: {} } }, 'a')).toBe(true)
  })

  it('honours an explicit false', () => {
    expect(isEnabled({ plugins: { a: { enabled: false } } }, 'a')).toBe(false)
  })
})
