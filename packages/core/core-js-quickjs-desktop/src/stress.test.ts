/**
 * `JS_FreeRuntime` leak hunting: regression tests plus a stress harness.
 *
 * The regression describes run always. They assert on the process's stderr
 * because that is where the engine's abort lands: `Aborted(Assertion
 * failed: list_empty(&rt->gc_obj_list), ..., JS_FreeRuntime)` is printed by
 * the WASM module as a side effect of the failed assertion, and the
 * wrapper's `dispose()` catch cannot un-print it. A dispose that reaches
 * the assertion is a leak, whatever the surrounding test outcome says.
 *
 * The stress describes are gated behind `BBEBEE_QUICKJS_STRESS=1` and are
 * driven one class per process by `scripts/repro-free-runtime.mjs` — an
 * abort poisons the WASM instance, so classes never share a process.
 * Handle tracing (`BBEBEE_QUICKJS_TRACE_HANDLES`) is switched on for this
 * whole file, before the plugin module is imported, so a leaking class
 * also names the handles it leaked.
 */

process.env['BBEBEE_QUICKJS_TRACE_HANDLES'] = '1'

import { beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { tick } from '@BBeBee/kernel/testing'
import type { JsLimits } from '@BBeBee/protocol'

import type JsQuickJsNode from './index.js'

let plugin: typeof JsQuickJsNode

beforeAll(async () => {
  plugin = (await import('./index.js')).default
})

async function harness() {
  const ctx = new Context()
  await ctx.plugin(plugin, {})
  await tick()
  return ctx
}

/**
 * A realm whose leak reports land on this process's stderr.
 *
 * The service wires reports to `ctx.logger`, which the real app backs with
 * a log transport — but a bare test `Context` has no logger service, and
 * its default logger drops everything. Pointing the realm's reporter at
 * stderr keeps the report (and this file's assertions on it) real.
 */
async function tracedRealm(ctx: Context, limits?: Partial<JsLimits>) {
  const realm = await ctx.js.createRealm(limits)
  ;(realm as unknown as { onLeakReport: (text: string) => void }).onLeakReport = (text) => {
    process.stderr.write(`${text}\n`)
  }
  return realm
}

const ABORT_RE = /Aborted\(Assertion failed|gc_obj_list/
const LEAK_RE = /unreleased handle/

/** Collect everything the engine or the leak reporter prints while `fn` runs. */
async function capturingOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const stderrWrite = process.stderr.write.bind(process.stderr)
  const consoleError = console.error
  const consoleWarn = console.warn
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk))
    return (stderrWrite as (...args: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof process.stderr.write
  console.error = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '))
    consoleError(...args)
  }
  console.warn = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '))
    consoleWarn(...args)
  }
  try {
    await fn()
  } finally {
    process.stderr.write = stderrWrite
    console.error = consoleError
    console.warn = consoleWarn
  }
  return chunks.join('\n')
}

function expectClean(output: string) {
  expect(output).not.toMatch(ABORT_RE)
  expect(output).not.toMatch(LEAK_RE)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('freeruntime regression', () => {
  it('an already-fulfilled promise result does not reach the assertion', async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      const realm = await tracedRealm(ctx)
      await expect(realm.eval('(async () => ({ a: 1 }))()')).resolves.toEqual({ a: 1 })
      realm.dispose()
    })
    expectClean(output)
  }, 20_000)

  it('an already-rejected promise does not reach the assertion', async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      const realm = await tracedRealm(ctx)
      await expect(realm.eval('(async () => { throw new Error("boom") })()')).rejects.toThrow(/boom/)
      realm.dispose()
    })
    expectClean(output)
  }, 20_000)

  it('a host bridge that settles normally does not reach the assertion', async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      const realm = await tracedRealm(ctx)
      realm.expose('fetchObj', async () => {
        await delay(20)
        return { items: [1, 2, 3] }
      })
      await expect(
        realm.eval('(async () => { const r = await fetchObj(); return r })()'),
      ).resolves.toEqual({ items: [1, 2, 3] })
      realm.dispose()
    })
    expectClean(output)
  }, 20_000)

  it('disposing a realm parked on a host promise does not reach the assertion', async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      const realm = await tracedRealm(ctx)
      let release!: (value: unknown) => void
      realm.expose('hang', () => new Promise((resolve) => (release = resolve)))
      const parked = realm.eval('(async () => { const r = await hang(); return r })()')
      parked.catch(() => undefined)
      await delay(50) // let the eval park on the bridge
      realm.dispose()
      release({ late: true }) // the host side settles after teardown
      await delay(50)
    })
    expectClean(output)
  }, 20_000)
})

/* ── stress classes (BBEBEE_QUICKJS_STRESS=1, one class per process) ──── */

const STRESS = process.env['BBEBEE_QUICKJS_STRESS'] === '1'
const N = Number(process.env['BBEBEE_QUICKJS_STRESS_N'] ?? 200)
const STRESS_TIMEOUT = 600_000

describe.skipIf(!STRESS)('stress class-a: sync eval + dispose', () => {
  it(`loops ${N} realms of synchronous evals`, async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      for (let i = 0; i < N; i++) {
        const realm = await tracedRealm(ctx)
        await expect(realm.eval('({ items: [1, 2, 3], total: 6 })')).resolves.toEqual({
          items: [1, 2, 3],
          total: 6,
        })
        await expect(realm.eval('seed.n * 2', { seed: { n: i } })).resolves.toBe(i * 2)
        realm.dispose()
      }
    })
    expectClean(output)
  }, STRESS_TIMEOUT)
})

describe.skipIf(!STRESS)('stress class-b: async settle + dispose', () => {
  it(`loops ${N} realms whose scripts settle asynchronously`, async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      for (let i = 0; i < N; i++) {
        const realm = await tracedRealm(ctx)
        // Settles during evalCode itself: an async function that never
        // actually awaits anything host-side.
        await expect(realm.eval('(async () => ({ a: 1, i: 0 }))()')).resolves.toEqual({ a: 1, i: 0 })
        // Settles later, parked in the settle loop on a host bridge.
        realm.expose('fetchObj', async () => {
          await delay(5)
          return { items: [1, 2, 3] }
        })
        await expect(
          realm.eval('(async () => { const r = await fetchObj(); return { n: r.items.length } })()'),
        ).resolves.toEqual({ n: 3 })
        realm.dispose()
      }
    })
    expectClean(output)
  }, STRESS_TIMEOUT)
})

describe.skipIf(!STRESS)('stress class-c: dispose while parked on a host promise', () => {
  it(`loops ${N} mid-flight teardowns`, async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      for (let i = 0; i < N; i++) {
        const realm = await tracedRealm(ctx)
        let release!: (value: unknown) => void
        realm.expose('hang', () => new Promise((resolve) => (release = resolve)))
        const parked = realm.eval('(async () => { const r = await hang(); return r })()')
        parked.catch(() => undefined)
        await delay(10) // park
        realm.dispose()
        if (i % 2 === 0) release({ late: i }) // half settle after teardown, half never do
        await delay(5)
      }
    })
    expectClean(output)
  }, STRESS_TIMEOUT)
})

describe.skipIf(!STRESS)('stress class-d: throwing scripts + dispose', () => {
  it(`loops ${N} realms of throwing scripts`, async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      for (let i = 0; i < N; i++) {
        const realm = await tracedRealm(ctx)
        await expect(realm.eval('(() => { throw new Error("sync rule bug") })()')).rejects.toThrow(
          /sync rule bug/,
        )
        await expect(
          realm.eval('(async () => { throw new Error("async rule bug") })()'),
        ).rejects.toThrow(/async rule bug/)
        realm.dispose()
      }
    })
    expectClean(output)
  }, STRESS_TIMEOUT)
})

describe.skipIf(!STRESS)('stress class-e: production shapes', () => {
  it(`runs ${N} source-rule evals on one long-lived realm, then disposes`, async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      // plugin-source-runtime's shape: one realm per source, a preloaded
      // library, host bridges, and every rule an async IIFE whose result
      // is an object built from the bridge's answer.
      const realm = await tracedRealm(ctx)
      realm.expose('srcFetch', async (path: unknown) => {
        await delay(2)
        return { items: [{ id: 1, title: `song for ${String(path)}` }], total: 1 }
      })
      await realm.preload(
        'const lib = { pick: (r) => r.items.map((x) => ({ id: x.id, t: x.title })) }',
      )
      for (let i = 0; i < N; i++) {
        await expect(
          realm.eval(
            `(async () => { const r = await srcFetch('/list?p=${i}'); return lib.pick(r) })()`,
          ),
        ).resolves.toEqual([{ id: 1, t: 'song for /list?p=' + i }])
      }
      realm.dispose()
    })
    expectClean(output)
  }, STRESS_TIMEOUT)

  it(`runs ${N} lyric-sandbox searches, realm per search`, async () => {
    const output = await capturingOutput(async () => {
      const ctx = await harness()
      // plugin-lyric-sources' shape: a realm per search, disposed in a
      // finally right after the eval settles.
      for (let i = 0; i < N; i++) {
        const realm = await tracedRealm(ctx, {
          timeoutMs: 4000,
          budgetMs: 12_000,
          memoryBytes: 16 * 1024 * 1024,
        })
        try {
          realm.expose('httpFetch', async () => {
            await delay(2)
            return { status: 200, body: '{"lyric":"la"}' }
          })
          await expect(
            realm.eval(
              '(async () => { const r = await httpFetch("https://example.invalid"); const j = JSON.parse(r.body); return { lines: [j.lyric] } })()',
              { __query__: { title: `t${i}` } },
            ),
          ).resolves.toEqual({ lines: ['la'] })
        } finally {
          realm.dispose()
        }
      }
    })
    expectClean(output)
  }, STRESS_TIMEOUT)
})
