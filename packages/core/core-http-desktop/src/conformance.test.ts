/**
 * `httpConformance` against `core-http-desktop`.
 *
 * Separate from `index.test.ts`, which tests this implementation's own
 * concerns — the jar store, the `net:host` gate, the waterfall. This file runs
 * the *contract*: the same suite `core-http-mobile` runs on a device, so the two
 * implementations cannot drift into meaning different things by `Range` or by
 * `timeoutMs` (docs/04 §18).
 *
 * The subject is a real socket, from `tooling-fixtures`. A mock would prove
 * the wrapper calls `fetch`; what needs proving is what happens over a
 * connection that stalls (docs/11 §4.5).
 */

import { afterAll, beforeAll, describe, it } from 'vitest'
import { Context } from 'cordis'
import { httpConformance } from '@BBeBee/protocol/conformance'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { startByteServer, type ByteServer } from '@BBeBee/tooling-fixtures'
import plugin from './index.js'

let server: ByteServer

beforeAll(async () => {
  server = await startByteServer()
})
afterAll(async () => {
  await server.close()
})

describe(`${httpConformance.service} conformance — core-http-desktop`, () => {
  for (const check of httpConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = new Context()
      await ctx.plugin(PathsNode, { root: await tempDir('bbebee-http-conformance') })
      await ctx.plugin(FsNode)
      // Long enough that only the checks which set their own `timeoutMs` are
      // testing a timeout — otherwise the default would be what failed.
      await ctx.plugin(plugin, { defaultTimeoutMs: 10_000 })
      await tick()
      await check.run({ http: ctx.http, origin: server.origin, payload: server.payload })
    })
  }
})
