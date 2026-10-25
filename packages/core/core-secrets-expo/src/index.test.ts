/**
 * `core-secrets-expo` against the scoping the node twin carries.
 *
 * The twin of `core-secrets-node`'s scoping block, down to the comments:
 * both stores must confine a gated caller the same way, because a
 * `secrets:own` that holds on one platform and not the other is not a
 * grant. `expo-secure-store` is aliased to the working map stub under
 * Vitest — see `test/stubs/expo-secure-store.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
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

describe('core-secrets-expo', () => {
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
    // The scoped key exists in the index, and it carries no `/` or `@`.
    const raw = await (
      await import('expo-secure-store')
    ).getItemAsync('__BBeBee_index')
    expect(raw).toBeDefined()
    expect(JSON.parse(raw!)).toEqual(['_BBeBee_a.token'])
  })
})
