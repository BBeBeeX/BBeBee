/**
 * `core-secrets-mobile` against the scoping the node twin carries.
 *
 * The twin of `core-secrets-desktop`'s scoping block, down to the comments:
 * both stores must confine a gated caller the same way, because a
 * `secrets:own` that holds on one platform and not the other is not a
 * grant. `expo-secure-store` is aliased to the working map stub under
 * Vitest — see `test/stubs/expo-secure-store.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { secretsConformance } from '@BBeBee/protocol/conformance'
import { SecretsExpo } from './index.js'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SecretsExpo)
  return ctx
}

beforeEach(async () => {
  // Vitest aliases `expo-secure-store` to the working map stub; the reset
  // hook lives there, not on the real SDK, so it is reached through the
  // package name rather than a path that would cross this package's rootDir.
  const mod = (await import('expo-secure-store')) as unknown as {
    __resetForTests?: () => void
  }
  mod.__resetForTests?.()
})

describe('core-secrets-mobile', () => {
  it('stores and deletes values', async () => {
    const ctx = await harness()
    await ctx.secrets.set('token', 'a-token')
    expect(await ctx.secrets.get('token')).toBe('a-token')
    await ctx.secrets.delete('token')
    expect(await ctx.secrets.get('token')).toBeUndefined()
  })

  it('refuses a value over the platform cap', async () => {
    const ctx = await harness()
    await expect(ctx.secrets.set('big', 'x'.repeat(2049))).rejects.toThrow(/2048/)
  })
})

describe('scoping', () => {
  it('confines a gated caller to its own namespace', async () => {
    /*
     * ⚠️ Without this `secrets:own` and `secrets:all` are the same grant on
     * mobile: any plugin holding `ctx.secrets` could read — and overwrite —
     * another plugin's credentials just by naming their key.
     */
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    const b = scopeContext(ctx, { pluginId: '@BBeBee/b', requested: ['secrets:own'] as never })

    await a.secrets.set('token', 'a-token')
    await b.secrets.set('token', 'b-token')

    expect(await a.secrets.get('token')).toBe('a-token')
    expect(await b.secrets.get('token'), 'b cannot see a').toBe('b-token')
  })

  it('clearing one scope leaves another alone', async () => {
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    const b = scopeContext(ctx, { pluginId: '@BBeBee/b', requested: ['secrets:own'] as never })
    await a.secrets.set('token', 'a-token')
    await b.secrets.set('token', 'b-token')

    await a.secrets.clear()
    expect(await a.secrets.get('token')).toBeUndefined()
    expect(await b.secrets.get('token')).toBe('b-token')
  })

  it('leaves an ungated caller the whole store', async () => {
    // The kernel, a core service, a test. Without this `clear()` on the root
    // would clear nothing, and the store could never be reset.
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    await a.secrets.set('token', 'a-token')

    await ctx.secrets.clear()
    expect(await a.secrets.get('token')).toBeUndefined()
  })

  it('adopts a pre-scoping bare key on first read', async () => {
    // An install that signed in before caller scoping exists has its token
    // under the bare key; the first scoped read must not report "signed out".
    const ctx = await harness()
    await ctx.secrets.set('token', 'old-token')

    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    expect(await a.secrets.get('token')).toBe('old-token')

    // The adoption moved it: the bare key is gone, the scoped one persists.
    expect(await ctx.secrets.get('token')).toBeUndefined()
    expect(await a.secrets.get('token')).toBe('old-token')
  })

  it('shares explicit namespaces across different scoped callers', async () => {
    // The cookie jar's vocabulary: `namespace()` is deliberate cross-plugin
    // naming, not a way around the caller's own scope.
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    const b = scopeContext(ctx, { pluginId: '@BBeBee/b', requested: ['secrets:own'] as never })

    await a.secrets.namespace('source-123').set('user', 'admin')
    expect(await b.secrets.namespace('source-123').get('user')).toBe('admin')

    await a.secrets.namespace('source-123').clear()
    expect(await b.secrets.namespace('source-123').get('user')).toBeUndefined()
  })

  it('sanitises the caller scope into a SecureStore-legal key', async () => {
    // SecureStore rejects anything outside [A-Za-z0-9._-]; a plugin id like
    // `@BBeBee/a` must therefore not reach the store verbatim.
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    await a.secrets.set('token', 'a-token')
    // The scoped key exists in shard 0, and it carries no `/` or `@`.
    const store = (await import('expo-secure-store')) as unknown as {
      getItemAsync: (key: string) => Promise<string | null>
    }
    const raw = await store.getItemAsync('__BBeBee_idx_0')
    expect(raw).toBeDefined()
    expect(JSON.parse(raw!)).toEqual(['_BBeBee_a.token'])
  })

  it('enumerates and clears every key past the single-value index cap', async () => {
    // The index is itself a 2048-byte SecureStore value; the sharded layout
    // is what lets a store grow past ~50 keys without evicting entries —
    // and `clear()` without missing the evicted ones.
    const ctx = await harness()
    for (let i = 0; i < 200; i++) {
      await ctx.secrets.set(`source-${i}.refreshToken`, `v${i}`)
    }
    // All 200 are still enumerated (the old single index would have evicted
    // the oldest ~150 by this point).
    const seen = new Set<string>()
    const store = (await import('expo-secure-store')) as unknown as {
      getItemAsync: (key: string) => Promise<string | null>
    }
    for (let s = 0; ; s++) {
      const raw = await store.getItemAsync(`__BBeBee_idx_${s}`)
      if (!raw) break
      for (const key of JSON.parse(raw) as string[]) seen.add(key)
    }
    expect(seen.size).toBe(200)

    await ctx.secrets.clear()
    for (let i = 0; i < 200; i++) {
      expect(await ctx.secrets.get(`source-${i}.refreshToken`)).toBeUndefined()
    }
    expect(JSON.parse((await store.getItemAsync('__BBeBee_idx_0'))!)).toEqual([])
  })

  it('adopts the pre-sharding single index on first use', async () => {
    const store = (await import('expo-secure-store')) as unknown as {
      getItemAsync: (key: string) => Promise<string | null>
      setItemAsync: (key: string, value: string) => Promise<void>
    }
    await store.setItemAsync('legacy.token', 'legacy-value')
    await store.setItemAsync('__BBeBee_index', JSON.stringify(['legacy.token']))

    const ctx = await harness()
    await ctx.secrets.clear()
    // The legacy entry was enumerated and removed, and the legacy index key
    // itself is gone.
    expect(await ctx.secrets.get('legacy.token')).toBeUndefined()
    expect(await store.getItemAsync('__BBeBee_index')).toBeNull()
  })

  it('reports no hardware backing on an Android emulator', async () => {
    const rn = (await import('react-native')) as unknown as {
      __setModelForTests?: (model: string) => void
    }
    rn.__setModelForTests?.('sdk_gphone64_x86_64')
    const emulator = await harness()
    expect(emulator.secrets.isHardwareBacked).toBe(false)

    rn.__setModelForTests?.('Pixel 8')
    const device = await harness()
    expect(device.secrets.isHardwareBacked).toBe(true)
  })
})

/**
 * The shared contract, run against the Expo store — the twin of
 * `core-secrets-desktop`'s conformance block. A credential store whose answers
 * differ by platform is not a grant but an accident, so the 11 checks run here
 * exactly as they run there, against the same `expo-secure-store` stub the
 * scoping tests above use.
 */
describe(`${secretsConformance.service} conformance`, () => {
  for (const check of secretsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = await harness()
      await check.run({ secrets: ctx.secrets })
    })
  }
})
