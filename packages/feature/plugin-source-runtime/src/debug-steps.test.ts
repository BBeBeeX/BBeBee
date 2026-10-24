/**
 * The test screen's two steps: one raw request through the source's scoped
 * HTTP, and one script in its sandbox. Neither is a rule — they are how a
 * source author pokes a backend by hand — so their contracts are their own:
 * the allowlist still holds, the body and return value come back whole, and
 * `src.log` lines narrate the run in the trace itself.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@bbebee/core-http-node'
import jsPlugin from '@bbebee/core-js-quickjs-node'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { TraceEvent } from '@BBeBee/protocol'
import plugin from './index.js'

let server: Server
let origin: string
let lastMethod = ''
let lastBody = ''

const JS_LIB = 'function add(a, b) { return a + b }'

function document() {
  return {
    sourceUrl: origin,
    sourceName: 'Debug steps',
    jsLib: JS_LIB,
    searchUrl: '{{source.url}}/search?q={{key}}',
    ruleSearch: {
      trackList: '$.items[*]',
      trackId: '$.id',
      title: '$.title',
    },
    ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
  }
}

async function app(opts: { sandbox?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-debug-steps') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(httpPlugin, {})
  if (opts.sandbox !== false) await ctx.plugin(jsPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  await ctx.sources.import(JSON.stringify(document()))
  await ctx.plugin(plugin, {})
  await tick()
  await tick()
  return ctx
}

async function traceOf(ctx: Context, step: Parameters<Context['sources']['debug']>[1]): Promise<TraceEvent[]> {
  const events: TraceEvent[] = []
  for await (const event of ctx.sources.debug(ctx.sources.sources[0]!.id, step)) {
    events.push(event)
  }
  return events
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => void (raw += chunk))
    req.on('end', () => {
      lastMethod = req.method ?? 'GET'
      lastBody = raw
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, echo: raw || undefined }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

describe('the http debug step', () => {
  it('returns the body whole, over the source\'s own client', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, { kind: 'http', method: 'GET', url: `${origin}/probe` })

    const http = events.find((e) => e.kind === 'http')
    expect(http && http.kind === 'http' && http.status).toBe(200)
    const value = events.find((e) => e.kind === 'value')
    expect(value && value.kind === 'value' && value.value).toBe(JSON.stringify({ ok: true }))
  }, 30_000)

  it('sends the method, headers and body it was given', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, {
      kind: 'http',
      method: 'POST',
      url: `${origin}/submit`,
      headers: { 'X-Probe': 'yes' },
      body: 'a=1&b=2',
    })

    expect(lastMethod).toBe('POST')
    expect(lastBody).toBe('a=1&b=2')
    const http = events.find((e) => e.kind === 'http')
    expect(http && http.kind === 'http' && http.status).toBe(200)
  }, 30_000)

  it('refuses a host the source never declared', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, { kind: 'http', method: 'GET', url: 'http://elsewhere.example.org/' })

    // The error is the diagnosis, not a throw: the screen shows it inline.
    const error = events.find((e) => e.kind === 'error')
    expect(error && error.kind === 'error' && error.message).toContain('did not declare')
  }, 30_000)
})

describe('the js debug step', () => {
  it('runs a script with the document\'s functions in scope', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, { kind: 'js', code: 'return add(2, 3)' })

    const value = events.find((e) => e.kind === 'value')
    expect(value && value.kind === 'value' && value.value).toBe('5')
  }, 30_000)

  it('exposes the arguments as variables', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, {
      kind: 'js',
      code: 'return key + ":" + page',
      argsJson: '{ "key": "aurora", "page": 2 }',
    })

    const value = events.find((e) => e.kind === 'value')
    expect(value && value.kind === 'value' && value.value).toBe('aurora:2')
  }, 30_000)

  it('carries src.log lines into the trace', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, {
      kind: 'js',
      code: "src.log('about to answer'); return 1",
    })

    const log = events.find((e) => e.kind === 'log')
    expect(log && log.kind === 'log' && log.message).toContain('about to answer')
    const value = events.find((e) => e.kind === 'value')
    expect(value && value.kind === 'value' && value.value).toBe('1')
  }, 30_000)

  it('keeps a large return value parseable — the tree depends on it', async () => {
    /*
     * ⚠️ The per-field redactor cap (2 KB) must not apply here. A return
     * value truncated mid-JSON is a string the test screen can never parse,
     * so every big output renders as text instead of a tree — which is the
     * one thing the value event exists to prevent.
     */
    const ctx = await app()
    // Large enough to exceed every cap the trace has ever had (2 KB, 20 KB):
    // a value cut anywhere is a string the tree can never parse.
    const code = 'return { items: Array.from({ length: 300 }, (_, i) => ({ id: i, title: "track " + i, url: "https://music.example.org/stream/" + i })) }'
    const events = await traceOf(ctx, { kind: 'js', code })

    const value = events.find((e) => e.kind === 'value')
    expect(value && value.kind === 'value').toBe(true)
    const text = value && value.kind === 'value' ? value.value : ''
    expect(text.length).toBeGreaterThan(20_000)
    expect(text).not.toContain('truncated')
    const parsed = JSON.parse(text) as { items: { title: string }[] }
    expect(parsed.items).toHaveLength(300)
  }, 30_000)

  it('reports malformed arguments as a trace error, not a throw', async () => {
    const ctx = await app()
    const events = await traceOf(ctx, { kind: 'js', code: 'return 1', argsJson: '{ not json' })

    const error = events.find((e) => e.kind === 'error')
    expect(error && error.kind === 'error' && error.message).toContain('not valid JSON')
  }, 30_000)

  it('says so plainly when the build has no sandbox', async () => {
    const ctx = await app({ sandbox: false })
    const events = await traceOf(ctx, { kind: 'js', code: 'return 1' })

    const error = events.find((e) => e.kind === 'error')
    expect(error && error.kind === 'error' && error.message).toContain('no JavaScript sandbox')
  }, 30_000)
})
