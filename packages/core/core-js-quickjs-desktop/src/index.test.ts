/**
 * The QuickJS realm, against the shared contract and then some.
 *
 * The conformance suite is the interchangeability check the mobile build will
 * run too. What follows it is specific to this embedding: memory limits and
 * handle hygiene, where a mistake is a leaked WASM allocation rather than a
 * wrong answer.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { jsConformance } from '@BBeBee/protocol/conformance'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(plugin, {})
  await tick()
  return ctx
}

describe('where the engine comes from', () => {
  it('starts with the network and the filesystem taken away', async () => {
  
    const fetched: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = (input: RequestInfo | URL) => {
      fetched.push(String(input))
      throw new Error('the sandbox must not fetch its own engine')
    }
    try {
      const ctx = await harness()
      const realm = await ctx.js.createRealm()
      expect(await realm.eval('1 + 41')).toBe(42)
      realm.dispose()
    } finally {
      globalThis.fetch = real
    }
    expect(fetched).toEqual([])
  }, 20_000)

  it('depends on a single-file variant, which is the part Node cannot show', () => {
  
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const deps = Object.keys(pkg.dependencies ?? {})

    expect(deps).toContain('quickjs-emscripten-core')
    expect(deps).not.toContain('quickjs-emscripten')
    expect(deps.filter((d) => d.startsWith('@jitl/quickjs-'))).toEqual([
      '@jitl/quickjs-singlefile-browser-release-sync',
    ])
  })
})

describe(`${jsConformance.service} conformance`, () => {
  for (const check of jsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = await harness()
      await check.run({ js: ctx.js })
    }, 20_000)
  }
})

describe('this embedding', () => {
  it('stops a script that exhausts its heap', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm({ memoryBytes: 1024 * 1024, timeoutMs: 5000 })
    await expect(
      realm.eval('const a = []; for (;;) a.push(new Array(10000).fill("x"))'),
    ).rejects.toThrow(/heap|memory|interrupt/i)
    realm.dispose()
  }, 20_000)

  it('survives unbounded recursion instead of taking the process with it', async () => {
    // The native stack, not the heap: without a stack cap this is a segfault
    // in the host rather than an error in the realm.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    await expect(realm.eval('(function f() { return f() })()')).rejects.toThrow()
    realm.dispose()
  }, 20_000)

  it('a host function that throws surfaces to the script, not to the host', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    realm.expose('bad', () => {
      throw new Error('host said no')
    })
    // Silently returning undefined would make a failed auth call look like an
    // empty token — the wrong answer, arrived at quietly.
    const seen = await realm.eval('(() => { try { bad(); return "no throw" } catch (e) { return String(e) } })()')
    expect(String(seen)).toMatch(/host said no/)
    realm.dispose()
  })

  it('an exposed function can be removed again', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    const remove = realm.expose('gone', () => 1)
    expect(await realm.eval('typeof gone')).toBe('function')
    remove()
    expect(await realm.eval('typeof gone')).toBe('undefined')
    realm.dispose()
  })

  it('refuses a value that cannot cross into the realm', async () => {
    // Narrowing a BigInt to a Number would corrupt an id past 2^53, which is
    // exactly what a backend uses them for.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    await expect(realm.eval('1', { n: 1n })).rejects.toThrow(/BigInt/)
    realm.dispose()
  })

  it('frees every realm when the service unloads', async () => {
    // A realm outliving the service is a WASM allocation nothing will free.
    const ctx = new Context()
    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    const realm = await ctx.js.createRealm()
    await realm.eval('1 + 1')

    await fiber.dispose()
    await tick()
    expect(diffSnapshots(before, snapshotContext(ctx))).toBeUndefined()
    // The realm went with it, and says so rather than crashing.
    await expect(realm.eval('1')).rejects.toThrow(/no longer usable/)
  })
})
