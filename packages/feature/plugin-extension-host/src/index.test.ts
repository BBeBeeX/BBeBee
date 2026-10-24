/**
 * The extension host's contract tests, against the real sandbox: QuickJS
 * realms, real HTTP to a local server, real store isolation. The point of
 * every case is the boundary — what the bridge lets across and what it
 * refuses — because the bridge *is* the capability gate here.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { StoreFs } from '@bbebee/core-store-fs'
import httpPlugin from '@bbebee/core-http-node'
import jsPlugin from '@bbebee/core-js-quickjs-node'
import type { ExtensionRecord, PluginManifest, TransportState } from '@BBeBee/protocol'
import { tempDir } from '@BBeBee/kernel/testing'
import plugin, { type ExtensionHostConfig } from './index.js'

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('pong')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@example/scrobbler',
    version: '0.1.0',
    displayName: 'Scrobbler',
    engines: { BBeBee: '^0.1.0' },
    entry: { main: './main.js' },
    capabilities: ['net:host/127.0.0.1'],
    ...over,
  }
}

async function app(config: ExtensionHostConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-ext-host') })
  await ctx.plugin(FsNode)
  await ctx.plugin(StoreFs)
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(jsPlugin, {})
  await ctx.plugin(plugin, config)
  return ctx
}

const PLAYING = {
  status: 'playing',
  positionMs: 0,
  durationMs: 100,
  bufferedMs: 100,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
} as unknown as TransportState

async function waitFor<T>(probe: () => Promise<T | undefined>, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function recordOf(ctx: Context, id: string): Promise<ExtensionRecord> {
  const all = await ctx.extensions.list()
  const found = all.find((r) => r.id === id)
  if (!found) throw new Error(`no record for ${id}`)
  return found
}

describe('the ext bridge', () => {
  it('delivers an allowlisted canon event into the realm and back out through storage', async () => {
    const ctx = await app()
    await ctx.extensions.install({
      manifest: manifest(),
      main: `ext.on('player/state-changed', (p) => { ext.storage.put('status', p.state.status) })`,
    })
    expect((await recordOf(ctx, '@example/scrobbler')).active).toBe(true)

    ctx.emit('player/state-changed', PLAYING)
    const stored = await waitFor(() =>
      ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('status'),
    )
    expect(stored).toBe('playing')
  }, 20_000)

  it('lets http reach a host the manifest declared', async () => {
    const ctx = await app()
    await ctx.extensions.install({
      manifest: manifest(),
      main: [
        "ext.on('player/state-changed', async () => {",
        `  try { const r = await ext.http.get(${JSON.stringify(`${origin}/ping`)})`,
        '    ext.storage.put("body", r.body)',
        '  } catch (e) { ext.storage.put("body", "ERR:" + e.message) }',
        '})',
      ].join('\n'),
    })

    ctx.emit('player/state-changed', PLAYING)
    const stored = await waitFor(() =>
      ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('body'),
    )
    expect(stored).toBe('pong')
  }, 20_000)

  it('refuses egress to a host the manifest did not declare — before anything is sent', async () => {
    const ctx = await app()
    await ctx.extensions.install({
      manifest: manifest({ capabilities: [] }),
      main: [
        "ext.on('player/state-changed', async () => {",
        '  try { await ext.http.get("https://example.org/x")',
        '    ext.storage.put("gate", "SENT")',
        '  } catch (e) { ext.storage.put("gate", e.name + ":" + e.message) }',
        '})',
      ].join('\n'),
    })

    ctx.emit('player/state-changed', PLAYING)
    const stored = await waitFor(() =>
      ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('gate'),
    )
    expect(stored).toContain('CapabilityError')
    expect(stored).toContain('not granted egress to example.org')
  }, 20_000)

  it('keeps two extensions on the same key in separate namespaces', async () => {
    const ctx = await app()
    const body = (name: string) =>
      [
        `ext.on('player/state-changed', () => {`,
        `  ext.storage.put('who', ${JSON.stringify(name)})`,
        '})',
      ].join('\n')
    await ctx.extensions.install({ manifest: manifest({ id: '@a/one' }), main: body('one') })
    await ctx.extensions.install({ manifest: manifest({ id: '@a/two' }), main: body('two') })

    ctx.emit('player/state-changed', PLAYING)
    expect(
      await waitFor(() => ctx.store.namespace('ext:storage:@a/one').get<string>('who')),
    ).toBe('one')
    expect(
      await waitFor(() => ctx.store.namespace('ext:storage:@a/two').get<string>('who')),
    ).toBe('two')
  }, 20_000)
})

describe('lifecycle and quarantine', () => {
  it('quarantines an extension whose code fails to load twice, and refuses further activation', async () => {
    const ctx = await app()
    const boom = `throw new Error('boom')`
    const first = await ctx.extensions.install({ manifest: manifest(), main: boom })
    expect(first.failures).toBe(1)
    expect(first.quarantined).toBe(false)

    /*
     * A reinstall is *new bytes* and resets the counter — deliberately: new
     * code deserves a fresh pair of failures. The second failure therefore
     * comes from an explicit activation, which is exactly the boot path
     * (boot activates what is installed; it does not reinstall).
     */
    await expect(ctx.extensions.activate('@example/scrobbler')).rejects.toThrow(/failed to load/)
    const second = await recordOf(ctx, '@example/scrobbler')
    expect(second.failures).toBe(2)
    expect(second.quarantined).toBe(true)

    await expect(ctx.extensions.activate('@example/scrobbler')).rejects.toThrow(
      /quarantined/,
    )
  }, 20_000)

  it('rejects a subscription to an event outside the allowlist at load time', async () => {
    const ctx = await app()
    const record = await ctx.extensions.install({
      manifest: manifest(),
      main: `ext.on('settings/changed', () => {})`,
    })
    expect(record.failures).toBe(1)
    expect(record.active).toBe(false)
  }, 20_000)

  it('deactivates an extension whose handler breaches the realm time limit', async () => {
    const ctx = await app({ limits: { timeoutMs: 250 } })
    await ctx.extensions.install({
      manifest: manifest(),
      main: `ext.on('player/state-changed', () => { while (true) {} })`,
    })
    ctx.emit('player/state-changed', PLAYING)
    await waitFor(async () =>
      (await recordOf(ctx, '@example/scrobbler')).active ? undefined : 'gone',
    )
  }, 20_000)

  it('uninstall disposes first, removes files, and drops data unless told to keep it', async () => {
    const ctx = await app()
    await ctx.extensions.install({
      manifest: manifest(),
      main: `ext.on('player/state-changed', () => { ext.storage.put('k', 'v') })`,
    })
    ctx.emit('player/state-changed', PLAYING)
    await waitFor(() => ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('k'))

    await ctx.extensions.uninstall('@example/scrobbler')
    await expect(ctx.extensions.list()).resolves.toHaveLength(0)
    await expect(
      ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('k'),
    ).resolves.toBeUndefined()
    await expect(
      ctx.extensions.activate('@example/scrobbler'),
    ).rejects.toThrow(/no extension named/)

    // keepData preserves the namespace for a reinstall.
    await ctx.extensions.install({
      manifest: manifest(),
      main: `ext.on('player/state-changed', () => { ext.storage.put('k', 'v') })`,
    })
    ctx.emit('player/state-changed', PLAYING)
    await waitFor(() => ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('k'))
    await ctx.extensions.uninstall('@example/scrobbler', { keepData: true })
    expect(await ctx.store.namespace('ext:storage:@example/scrobbler').get<string>('k')).toBe('v')
  }, 20_000)

  it('refuses an id that would spoof a first-party plugin', async () => {
    const ctx = await app()
    await expect(
      ctx.extensions.install({
        manifest: manifest({ id: '@bbebee/plugin-player' }),
        main: '',
      }),
    ).rejects.toThrow(/@bbebee\/ scope/)
  }, 20_000)
})
