/**
 * The mobile realm, against the shared contract and then some.
 *
 * The conformance suite is the interchangeability check the desktop build
 * runs too. What follows it is specific to this embedding: where the pure-JS
 * interpreter stands in for what QuickJS does natively — the quota in place
 * of the engine deadline, the boundary clone in place of `dump`, and the
 * whitelist extensions the source model's own shim needs.
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
  })

  it('depends on a pure-JS interpreter, which is the part Hermes cannot show', () => {
    // No WebAssembly on Hermes: the engine must be an interpreter written in
    // JavaScript itself, and the single-file QuickJS build must stay a
    // desktop-only dependency.
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const deps = Object.keys(pkg.dependencies ?? {})

    expect(deps).toContain('@nyariv/sandboxjs')
    expect(deps.filter((d) => d.startsWith('@jitl/quickjs-'))).toEqual([])
    expect(deps).not.toContain('quickjs-emscripten-core')
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
  it('stops a script that burns memory instead of a heap ceiling', async () => {
    // There is no allocator to fail on Hermes, so the unbounded allocation
    // is stopped by the execution quota rather than a `JsMemoryError` — the
    // failure still arrives, as the timeout it is.
    const ctx = await harness()
    const realm = await ctx.js.createRealm({ timeoutMs: 5000 })
    await expect(
      realm.eval('const a = []; for (;;) a.push(new Array(10000).fill("x"))'),
    ).rejects.toThrow(/heap|memory|interrupt/i)
    realm.dispose()
  }, 20_000)

  it('survives unbounded recursion instead of taking the process with it', async () => {
    // The interpreter's own recursion runs on the host stack; the overflow
    // surfaces as a catchable error rather than a crash.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    await expect(realm.eval('(function f() { return f() })()')).rejects.toThrow()
    // And the realm is still usable afterwards.
    expect(await realm.eval('1 + 1')).toBe(2)
    realm.dispose()
  }, 20_000)

  it('a host function that throws surfaces to the script, not to the host', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    realm.expose('bad', () => {
      throw new Error('host said no')
    })
    // Silently returning undefined would make a failed auth call look like
    // an empty token — the wrong answer, arrived at quietly.
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

  it('a scope value crosses as data, not as a live host reference', async () => {
    // The desktop realm structured-clones on the way in; a script that
    // mutates its scope must not be able to reach back into the caller.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    const host: { nested: { n: number } } = { nested: { n: 1 } }
    await realm.eval('x.nested.n = 99; x.added = 1', { x: host })
    expect(host.nested.n).toBe(1)
    expect(Object.hasOwn(host, 'added')).toBe(false)
    realm.dispose()
  })

  it('a returned value crosses as data, not as a live realm reference', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    const first = (await realm.eval('globalThis.shared = { n: 1 }; shared')) as { n: number }
    first.n = 99
    expect(await realm.eval('shared.n')).toBe(1)
    realm.dispose()
  })

  it('frees every realm when the service unloads', async () => {
    // A realm outliving the service would keep its whole interpreter graph
    // alive; the disposer wiring is what makes unload actually release it.
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

describe('where the pure-JS interpreter shows', () => {
  it('reports the interpreter as its engine', async () => {
    const ctx = await harness()
    expect(ctx.js.engine.name).toBe('@nyariv/sandboxjs')
    expect(ctx.js.engine.version.length).toBeGreaterThan(0)
  })

  it('has no ambient console, like the desktop realm', async () => {
    // A script narrates through `src.log`; a stray `console.log` must not
    // write into the host's log stream.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    expect(await realm.eval('typeof console')).toBe('undefined')
    realm.dispose()
  })

  it('the source shim can freeze itself: Object.freeze is reachable', async () => {
    // `SRC_SHIM` opens with `globalThis.src = Object.freeze({...})` — without
    // the whitelist extension every scripted source fails at realm setup.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    expect(await realm.eval('Object.freeze({ a: 1 }).a')).toBe(1)
    realm.dispose()
  })

  it('iterates strings and Map entries (whitelist-extended iterators)', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    expect(await realm.eval('let s = ""; for (const c of "abc") s += c; s')).toBe('abc')
    expect(
      await realm.eval('const m = new Map([["a", 1]]); let t = 0; for (const [k, v] of m) t += v; t'),
    ).toBe(1)
    realm.dispose()
  })

  it('class syntax is a script error, not a crash — the documented gap', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    await expect(realm.eval('class A { m() { return 1 } }; new A().m()')).rejects.toThrow(
      /class|Unexpected/,
    )
    // And the realm survives to run the rest of the document's rules.
    expect(await realm.eval('1 + 1')).toBe(2)
    realm.dispose()
  })

  it('get/set accessors in object literals are a script error — the documented gap', async () => {
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    await expect(realm.eval('const o = { get x() { return 1 } }; o.x')).rejects.toThrow()
    realm.dispose()
  })

  it('the constructor chain reaches a sandboxed Function, not the host', async () => {
    // The escape that sank sval: `({}).constructor.constructor` is callable
    // here, but the call is interpreted inside the sandbox — host globals
    // stay invisible through it, via direct calls and via `.call`.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    expect(
      await realm.eval(
        'const F = ({}).constructor.constructor;' +
          '[F("return typeof process")(), F("return 1 + 1")(), F.call(null, "return typeof fetch")()].join("|")',
      ),
    ).toBe('undefined|2|undefined')
    realm.dispose()
  })

  it('async work the script drops does not block the eval — the documented gap', async () => {
    // Desktop pumps the realm's job queue and reports an unhandled
    // rejection through onJobError; here fire-and-forget work is never
    // linked to the caller, and the eval completes with its own value.
    // (A *rejected* drop surfaces on the host's unhandled-rejection
    // handler — see the header — which a test must not trigger.)
    const ctx = await harness()
    const realm = await ctx.js.createRealm({ budgetMs: 4000 })
    const result = await realm.eval(
      '(async () => { const drop = async () => 1; drop(); return "kept" })()',
    )
    expect(result).toBe('kept')
    realm.dispose()
  })

  it('serializes concurrent evals on one realm', async () => {
    // The tick counter and halt flag are shared per engine instance, so
    // overlapping evals would blur each other's limits.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    const results = await Promise.all([
      realm.eval('(async () => { await 1; return "a" })()'),
      realm.eval('(async () => { await 1; return "b" })()'),
      realm.eval('(async () => { await 1; return "c" })()'),
    ])
    expect(results).toEqual(['a', 'b', 'c'])
    realm.dispose()
  })

  it('async host calls settle through the interpreter, in the production shape', async () => {
    // plugin-source-runtime's shape: exposed host functions, a preloaded
    // library on globalThis, and every rule an async IIFE that awaits a
    // bridge call.
    const ctx = await harness()
    const realm = await ctx.js.createRealm()
    realm.expose('srcGet', async (path: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { items: [{ id: 1, title: `song for ${String(path)}` }], total: 1 }
    })
    await realm.preload('globalThis.lib = { pick: (r) => r.items.map((x) => ({ id: x.id, t: x.title })) }')
    await expect(
      realm.eval('(async () => { const r = await srcGet("/list"); return lib.pick(r) })()'),
    ).resolves.toEqual([{ id: 1, t: 'song for /list' }])
    realm.dispose()
  })
})
