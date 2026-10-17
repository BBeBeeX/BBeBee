/**
 * Self-test for the conformance harness.
 *
 * Runs the `store` suite against a straightforward in-memory implementation.
 * This proves two things: the suite is actually runnable, and its checks pass
 * against a correct implementation rather than being unsatisfiable. When
 * `core-store-fs` and `core-store-expo` exist, they run the same suite.
 */

import { describe, expect, it } from 'vitest'
import type { StoreService } from '../index.js'
import { runSuite, storeConformance } from './index.js'

/** A reference `StoreService`. Deliberately the simplest correct thing. */
function createMemoryStore(prefix = ''): StoreService {
  const data = new Map<string, string>()

  const make = (ns: string): StoreService => ({
    async get<T>(key: string) {
      const raw = data.get(ns + key)
      return raw === undefined ? undefined : (JSON.parse(raw) as T)
    },
    async set<T>(key: string, value: T) {
      data.set(ns + key, JSON.stringify(value))
    },
    async delete(key: string) {
      data.delete(ns + key)
    },
    async keys(keyPrefix?: string) {
      return [...data.keys()]
        .filter((k) => k.startsWith(ns))
        .map((k) => k.slice(ns.length))
        .filter((k) => !keyPrefix || k.startsWith(keyPrefix))
    },
    namespace(sub: string) {
      return make(`${ns}${sub}:`)
    },
  })

  return make(prefix)
}

describe('store conformance', () => {
  for (const check of storeConformance.checks) {
    it(`${check.name} (${check.because})`, async () => {
      await check.run({ store: createMemoryStore() })
    })
  }
})

describe('harness', () => {
  it('reports failures rather than throwing out of runSuite', async () => {
    const broken: StoreService = {
      ...createMemoryStore(),
      // A plausible bug: namespaces that are not actually isolated.
      namespace() {
        return broken
      },
    }
    const { failed } = await runSuite(storeConformance, { store: broken })
    expect(failed.map((f) => f.name)).toContain('namespaces are isolated')
  })

  it('passes everything for a correct implementation', async () => {
    const { passed, failed } = await runSuite(storeConformance, { store: createMemoryStore() })
    expect(failed).toEqual([])
    expect(passed).toHaveLength(storeConformance.checks.length)
  })
})
